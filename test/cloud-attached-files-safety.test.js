'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const { normalizeResult } = require('../server/util');

const ROOT = path.resolve(__dirname, '..');

const getFreePort = () =>
  new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });

async function waitForServerReady(baseUrl, serverProcess) {
  for (let i = 0; i < 80; i++) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Server exited early with code ${serverProcess.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server start timed out for ${baseUrl}`);
}

function collectResearchResult(baseUrl, jobId, subToken) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Research job timed out')), 15000);
    const url = subToken
      ? `${baseUrl}/api/research/${jobId}/events?token=${encodeURIComponent(subToken)}`
      : `${baseUrl}/api/research/${jobId}/events`;
    const req = http.get(url, (res) => {
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'result') {
                clearTimeout(timeout);
                req.destroy();
                resolve(evt.data);
              } else if (evt.type === 'error') {
                clearTimeout(timeout);
                req.destroy();
                reject(new Error(evt.message));
              }
            } catch {}
          }
        }
      });
    });
    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

test('B-10: normalizeResult sanitizes attachedFiles and excludes referenceContext', () => {
  const dirtyData = {
    title: 'テストレポート',
    referenceContext: '機密の内部資料テキスト：社外秘パスワードや計画',
    attachedFiles: [
      {
        name: 'secret-spec.pdf',
        size: 2048,
        type: 'application/pdf',
        base64: 'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoK...',
        text: '社外秘の本文データテキスト',
      },
    ],
  };

  const meta = {
    id: 'test-id-1',
    theme: 'AI開発',
    referenceContext: 'meta側の機密テキスト',
    attachedFiles: dirtyData.attachedFiles,
  };

  const normalized = normalizeResult(dirtyData, meta);
  const jsonStr = JSON.stringify(normalized);

  assert.ok(!jsonStr.includes('base64'), 'JSON output must not contain "base64"');
  assert.strictEqual(normalized.attachedFiles.length, 1);
  const file = normalized.attachedFiles[0];
  assert.strictEqual(file.name, 'secret-spec.pdf');
  assert.strictEqual(file.size, 2048);
  assert.strictEqual(file.type, 'application/pdf');
  assert.strictEqual(file.base64, undefined);
  assert.strictEqual(file.text, undefined);
  assert.strictEqual(normalized.referenceContext, undefined);
});

test('B-10 (Local): research execution accepts attachments locally while excluding base64 and referenceContext from saved report', async () => {
  const testPort = await getFreePort();
  const childEnv = {
    ...process.env,
    PORT: String(testPort),
    NODE_ENV: 'test',
  };
  delete childEnv.SUPABASE_URL;
  delete childEnv.SUPABASE_ANON_KEY;
  delete childEnv.SUPABASE_SERVICE_ROLE_KEY;

  const serverProcess = fork(path.join(ROOT, 'server', 'index.js'), [], {
    env: childEnv,
    stdio: 'pipe',
  });

  try {
    const baseUrl = `http://127.0.0.1:${testPort}`;
    await waitForServerReady(baseUrl, serverProcess);

    const createRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'ローカル添付資料を含むリサーチテスト',
        scope: 'web',
        depth: 'quick',
        purpose: 'business',
        referenceContext: '社内極秘計画書の内容テキスト（保存禁止）',
        attachedFiles: [
          {
            name: 'confidential-blueprint.pdf',
            size: 4096,
            type: 'application/pdf',
            base64: 'SGVsbG8gd29ybGQgdGhpcyBpcyBiYXNlNjQgZW5jb2RlZCBmaWxlIGRhdGE=',
            text: '添付テキスト本文（保存禁止）',
          },
        ],
        forceMock: true,
      }),
    });

    assert.strictEqual(createRes.status, 202);
    const { jobId, token: subToken } = await createRes.json();
    const completedResult = await collectResearchResult(baseUrl, jobId, subToken);

    const resultJson = JSON.stringify(completedResult);
    assert.ok(!resultJson.includes('base64'), 'Result JSON must NOT contain "base64"');
    assert.ok(!resultJson.includes('社内極秘計画書'), 'Result JSON must NOT contain referenceContext');
    assert.strictEqual(completedResult.attachedFiles.length, 1);
    assert.strictEqual(completedResult.attachedFiles[0].name, 'confidential-blueprint.pdf');
    assert.strictEqual(completedResult.attachedFiles[0].size, 4096);
    assert.strictEqual(completedResult.attachedFiles[0].base64, undefined);
    assert.strictEqual(completedResult.attachedFiles[0].text, undefined);
    assert.strictEqual(completedResult.referenceContext, undefined);
  } finally {
    serverProcess.kill();
    await new Promise((r) => serverProcess.once('exit', r));
  }
});

test('D-4 (Cloud): server ignores attachedFiles, referenceContext, and presentation files in cloud mode', async () => {
  const mockSupabase = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/rest/v1/rpc/usage_cost_since') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('0');
    }
    if (url.pathname === '/rest/v1/rpc/consume_credits') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('true');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
  const sbPort = await new Promise((resolve) =>
    mockSupabase.listen(0, '127.0.0.1', () => resolve(mockSupabase.address().port))
  );
  const testPort = await getFreePort();
  const serverProcess = fork(path.join(ROOT, 'server', 'index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: `http://127.0.0.1:${sbPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_d4',
      TAVILY_API_KEY: 'dummy-tavily',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  try {
    const baseUrl = `http://127.0.0.1:${testPort}`;
    await waitForServerReady(baseUrl, serverProcess);

    const token = 'Bearer test-token-user-a';

    // 1. /api/research: attachedFiles と referenceContext はクラウド版では無視される
    const createRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        theme: 'クラウド版添付無効化テスト',
        scope: 'web',
        depth: 'quick',
        purpose: 'business',
        referenceContext: 'クラウド送信禁止の手持ち社内メモ',
        attachedFiles: [
          {
            name: 'cloud-secret.pdf',
            size: 4096,
            type: 'application/pdf',
            base64: 'SGVsbG8gd29ybGQ=',
            text: 'クラウド送信禁止の本文',
          },
        ],
        forceMock: true,
      }),
    });

    assert.strictEqual(createRes.status, 202);
    const { jobId, token: subToken } = await createRes.json();
    const completedResult = await collectResearchResult(baseUrl, jobId, subToken);
    const resultJson = JSON.stringify(completedResult);

    assert.ok(!resultJson.includes('base64'), 'Cloud result must NOT contain base64');
    assert.ok(!resultJson.includes('cloud-secret.pdf'), 'Cloud result must ignore attachedFiles');
    assert.ok(!resultJson.includes('クラウド送信禁止'), 'Cloud result must ignore referenceContext');
    assert.deepStrictEqual(completedResult.attachedFiles, []);
    assert.strictEqual(completedResult.referenceContext, undefined);

    // 2. /api/presentation/prompt: files は無視される
    const promptRes = await fetch(`${baseUrl}/api/presentation/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        document: '公開可能な企画書テキスト',
        audience: '開発チーム',
        files: [{ name: 'cloud-ignored-file.pdf', mimeType: 'application/pdf' }],
      }),
    });
    assert.strictEqual(promptRes.status, 200);
    const promptData = await promptRes.json();
    assert.ok(!promptData.prompt.includes('cloud-ignored-file.pdf'), 'Cloud presentation prompt must ignore files');

    // 3. /api/presentation/generate: document 空で files のみ送った場合は無視されて 400 (スライド実行権限のあるテストユーザーで検証)
    const genRes = await fetch(`${baseUrl}/api/presentation/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-admin-user',
      },
      body: JSON.stringify({
        document: '',
        audience: '開発チーム',
        files: [{ name: 'cloud-ignored.pdf', mimeType: 'application/pdf', base64: 'SGVsbG8=' }],
      }),
    });
    assert.strictEqual(genRes.status, 400);
    const genErr = await genRes.json();
    assert.ok(genErr.error.includes('ファイル添付は無効'), 'Cloud presentation generate must reject file-only payload');
  } finally {
    serverProcess.kill();
    await new Promise((r) => serverProcess.once('exit', r));
    await new Promise((r) => mockSupabase.close(r));
  }
});

test('D-4 (UI consistency): cloud mode hides attachment and reference context controls', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const authJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'auth.js'), 'utf8');
  const researchJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'research.js'), 'utf8');
  const presJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'presentation-modal.js'), 'utf8');

  assert.ok(html.includes('id="byod-dropzone" data-local-only="attachment"'), 'index.html must tag BYOD dropzone');
  assert.ok(html.includes('id="byod-memo-wrap" data-local-only="attachment"'), 'index.html must tag referenceContext wrap');
  assert.ok(html.includes('id="pres-file-dropzone" data-local-only="attachment"'), 'index.html must tag presentation dropzone');
  assert.ok(authJs.includes('[data-local-only="attachment"]'), 'auth.js must hide local-only attachment UI in cloud mode');
  assert.ok(researchJs.includes('if (!authState.isLocal) return;'), 'research.js must guard file processing in cloud mode');
  assert.ok(presJs.includes('if (!authState.isLocal) return;'), 'presentation-modal.js must guard file handling in cloud mode');
});

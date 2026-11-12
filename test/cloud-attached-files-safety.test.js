'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const { normalizeResult } = require('../server/util');
const { runResearch } = require('../server/pipeline');

const getFreePort = () =>
  new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });

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

  // 1. JSON文字列全体に "base64" が含まれていないこと
  assert.ok(!jsonStr.includes('base64'), 'JSON output must not contain "base64"');

  // 2. attachedFiles には name, size, type のみ含まれ、text や base64 は除外されていること
  assert.strictEqual(normalized.attachedFiles.length, 1);
  const file = normalized.attachedFiles[0];
  assert.strictEqual(file.name, 'secret-spec.pdf');
  assert.strictEqual(file.size, 2048);
  assert.strictEqual(file.type, 'application/pdf');
  assert.strictEqual(file.base64, undefined);
  assert.strictEqual(file.text, undefined);

  // 3. referenceContext はレポート保存オブジェクトから除外されていること
  assert.strictEqual(normalized.referenceContext, undefined);
});

test('B-10: End-to-end research execution with attachments excludes base64 and referenceContext from saved report', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-attached-safety.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b10',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const baseUrl = `http://127.0.0.1:${testPort}`;
  const token = 'Bearer test-token-user-a';

  try {
    // 添付ファイル（base64, text含む）と手持ち資料（referenceContext）を付けてリサーチ開始
    const createRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify({
        theme: '機密添付資料を含むリサーチテスト',
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
    const createData = await createRes.json();
    const jobId = createData.jobId;
    const subToken = createData.token;

    // SSE イベントを購読して完了まで待機
    const completedResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Research job timed out')), 15000);
      const req = http.get(`${baseUrl}/api/research/${jobId}/events?token=${encodeURIComponent(subToken)}`, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n\n');
          buffer = lines.pop(); // 未完了の行を保持
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

    assert.ok(completedResult, 'Result must be returned');

    // 返却された結果の JSON 全体を検査
    const resultJson = JSON.stringify(completedResult);

    // 1. "base64" という文字列が含まれていないこと
    assert.ok(!resultJson.includes('base64'), 'Result JSON must NOT contain "base64"');

    // 2. attachedFiles のプロパティ検証
    assert.ok(Array.isArray(completedResult.attachedFiles));
    assert.strictEqual(completedResult.attachedFiles.length, 1);
    const savedFile = completedResult.attachedFiles[0];
    assert.strictEqual(savedFile.name, 'confidential-blueprint.pdf');
    assert.strictEqual(savedFile.size, 4096);
    assert.strictEqual(savedFile.type, 'application/pdf');
    assert.strictEqual(savedFile.base64, undefined);
    assert.strictEqual(savedFile.text, undefined);

    // 3. referenceContext がレポートから除外されていること
    assert.strictEqual(completedResult.referenceContext, undefined);
  } finally {
    serverProcess.kill('SIGTERM');
  }
});


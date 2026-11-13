'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

async function runWithServer(customEnv, callback) {
  const testPort = 3958;
  const env = {
    ...process.env,
    PORT: String(testPort),
    NODE_ENV: 'test',
    ...customEnv,
  };

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  const url = `http://127.0.0.1:${testPort}`;

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }

  assert.ok(ready, `Test server failed to start on port ${testPort}`);

  try {
    await callback(url);
  } finally {
    try {
      child.kill('SIGINT');
      if (process.platform === 'win32' && child.pid) {
        try { child.kill('SIGKILL'); } catch {}
      }
    } catch {}
  }
}

test('A-5: Cloud mode rejects unauthenticated requests to AI and export routes with 401', async () => {
  await runWithServer(
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      ENABLE_TEST_USERS: 'true',
    },
    async (base) => {
      const routes = [
        { path: '/api/research/deep-dive', body: { theme: 'AI', question: 'What is it?' } },
        { path: '/api/presentation/prompt', body: { document: 'test doc' } },
        { path: '/api/presentation/generate', body: { document: 'test doc' } },
        { path: '/api/export/pdf/html', body: { data: { title: 'test' } } },
        { path: '/api/export/pdf', body: { data: { title: 'test' } } },
        { path: '/api/export/excel', body: { data: { title: 'test' } } },
        { path: '/api/export/markdown', body: { data: { title: 'test' } } },
        { path: '/api/export/text', body: { data: { title: 'test' } } },
      ];

      for (const route of routes) {
        const res = await fetch(`${base}${route.path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(route.body),
        });
        assert.equal(
          res.status,
          401,
          `Unauthenticated POST ${route.path} must return 401 in cloud mode, got ${res.status}`
        );
      }
    }
  );
});

test('A-5: Local mode allows requests to export and AI prompt routes without token', async () => {
  await runWithServer(
    {
      SUPABASE_URL: '',
    },
    async (base) => {
      // ローカル版ではトークンなしでも 401 にならず成功またはバリデーション応答が返る
      const resPrompt = await fetch(`${base}/api/presentation/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: 'test document' }),
      });
      assert.equal(resPrompt.status, 200, 'Local mode POST /api/presentation/prompt should return 200');

      const resMd = await fetch(`${base}/api/export/markdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Test Report', theme: 'Test' } }),
      });
      assert.equal(resMd.status, 200, 'Local mode POST /api/export/markdown should return 200');
    }
  );
});

test('R-1: Production cloud defaults to requiring auth (401), and ALLOW_ANONYMOUS_CLOUD=true enables free anonymous access with warnings', async () => {
  const http = require('http');
  const fs = require('fs');
  const os = require('os');

  // 最小モック Supabase サーバー
  const mockSb = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
  await new Promise((r) => mockSb.listen(0, '127.0.0.1', r));
  const sbPort = mockSb.address().port;
  const mockSbUrl = `http://127.0.0.1:${sbPort}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r1-test-'));

  async function spawnWithLogs(customEnv) {
    const portServer = http.createServer();
    await new Promise((r) => portServer.listen(0, '127.0.0.1', r));
    const port = portServer.address().port;
    await new Promise((r) => portServer.close(r));

    const env = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      SUPABASE_URL: mockSbUrl,
      SUPABASE_ANON_KEY: 'dummy-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service',
      TAVILY_API_KEY: 'dummy-tavily',
      RESEARCH_DATA_DIR: tmpDir,
      ...customEnv,
    };
    if (!customEnv.ENABLE_AUTH) delete env.ENABLE_AUTH;
    if (!customEnv.ALLOW_ANONYMOUS_CLOUD) delete env.ALLOW_ANONYMOUS_CLOUD;

    let logs = '';
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d) => { logs += d.toString(); });
    child.stderr.on('data', (d) => { logs += d.toString(); });

    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const res = await fetch(`${base}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    assert.ok(ready, `Server failed to start on port ${port}. Logs:\n${logs}`);

    return {
      base,
      getLogs: () => logs,
      stop: async () => {
        try {
          child.kill('SIGINT');
          if (process.platform === 'win32' && child.pid) {
            try { child.kill('SIGKILL'); } catch {}
          }
        } catch {}
      },
    };
  }

  try {
    // ケース1: NODE_ENV=production, SUPABASE_URL あり, ENABLE_AUTH/ALLOW_ANONYMOUS_CLOUD なし
    const srvLocked = await spawnWithLogs({});
    try {
      const rHist = await fetch(`${srvLocked.base}/api/history`);
      assert.equal(rHist.status, 401, 'GET /api/history without token must return 401');

      const rRes = await fetch(`${srvLocked.base}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'R-1 test', depth: 'quick', forceMock: true }),
      });
      assert.equal(rRes.status, 401, 'POST /api/research without token must return 401');

      const rDeep = await fetch(`${srvLocked.base}/api/research/deep-dive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'R-1 test', question: 'test question' }),
      });
      assert.equal(rDeep.status, 401, 'POST /api/research/deep-dive without token must return 401');

      const rCfg = await fetch(`${srvLocked.base}/api/auth/config`);
      const cfg = await rCfg.json();
      assert.equal(cfg.anonymousMode, false, 'anonymousMode must be false by default');
    } finally {
      await srvLocked.stop();
    }

    // ケース2: ALLOW_ANONYMOUS_CLOUD=true を付与
    const srvAnon = await spawnWithLogs({ ALLOW_ANONYMOUS_CLOUD: 'true' });
    try {
      const logs = srvAnon.getLogs();
      assert.ok(
        logs.includes('警告: ログイン不要モードで起動しています。全訪問者が1つの利用者として扱われます'),
        `Startup logs must warn about anonymous mode. Actual logs:\n${logs}`
      );

      const rCfg = await fetch(`${srvAnon.base}/api/auth/config`);
      const cfg = await rCfg.json();
      assert.equal(cfg.anonymousMode, true, 'anonymousMode must be true when ALLOW_ANONYMOUS_CLOUD=true');

      const rMe = await fetch(`${srvAnon.base}/api/auth/me`);
      assert.equal(rMe.status, 200);
      const me = await rMe.json();
      assert.equal(me.authenticated, true);
      assert.equal(me.user.plan, 'free', '/api/auth/me user.plan must be free in anonymous cloud mode');
      assert.equal(me.quota.plan, 'free', '/api/auth/me quota.plan must be free in anonymous cloud mode');

      const rHist = await fetch(`${srvAnon.base}/api/history`);
      assert.equal(rHist.status, 200, 'GET /api/history without token must return 200 in anonymous cloud mode');

      const rRes = await fetch(`${srvAnon.base}/api/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'R-1 test', depth: 'quick', forceMock: true }),
      });
      assert.equal(rRes.status, 202, 'POST /api/research without token must return 202 in anonymous cloud mode');

      const rDeep = await fetch(`${srvAnon.base}/api/research/deep-dive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'R-1 test', question: 'test question' }),
      });
      assert.equal(rDeep.status, 200, 'POST /api/research/deep-dive without token must return 200 in anonymous cloud mode');
    } finally {
      await srvAnon.stop();
    }
  } finally {
    await new Promise((r) => mockSb.close(r));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});


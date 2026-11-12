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


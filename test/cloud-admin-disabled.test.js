'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

async function runWithCloudServer(customEnv, callback) {
  const testPort = 3956;
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

test('A-3: Cloud mode disables administrative routes and endpoints', async () => {
  await runWithCloudServer(
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
    },
    async (base) => {
      // 1. 管理系ルートがすべて 404 を返すことの検証
      const forbiddenRoutes = [
        { method: 'POST', path: '/api/lifecycle/leave' },
        { method: 'GET', path: '/api/lifecycle/leave' },
        { method: 'POST', path: '/api/shutdown' },
        { method: 'PUT', path: '/api/settings', body: JSON.stringify({ publisher: 'test' }), headers: { 'Content-Type': 'application/json' } },
        { method: 'POST', path: '/api/settings/test' },
        { method: 'GET', path: '/api/usage' },
        { method: 'GET', path: '/api/logs' },
        { method: 'GET', path: '/api/memory' },
        { method: 'DELETE', path: '/api/memory/example.com' },
        { method: 'POST', path: '/api/memory/clear' },
        { method: 'GET', path: '/api/qr?text=hello' },
      ];

      for (const r of forbiddenRoutes) {
        const res = await fetch(`${base}${r.path}`, {
          method: r.method,
          headers: r.headers || {},
          body: r.body,
        });
        assert.equal(res.status, 404, `${r.method} ${r.path} must return 404 in cloud mode, got ${res.status}`);
      }

      // 2. GET /api/settings は表示用項目のみを返し、APIキーの set / count / masked を返さない
      const settingsRes = await fetch(`${base}/api/settings`);
      assert.equal(settingsRes.status, 200);
      const settingsData = await settingsRes.json();
      assert.equal(settingsData.geminiApiKey, undefined, 'settings must not leak geminiApiKey object');
      assert.equal(settingsData.tavilyApiKey, undefined, 'settings must not leak tavilyApiKey object');
      assert.equal(settingsData.groqApiKey, undefined, 'settings must not leak groqApiKey object');
      assert.ok(settingsData.publisher !== undefined, 'settings must include publisher');

      // 3. GET /api/info は lan を含まず、settings も秘匿化されている
      const infoRes = await fetch(`${base}/api/info`);
      assert.equal(infoRes.status, 200);
      const infoData = await infoRes.json();
      assert.equal(infoData.lan, undefined, 'info must not include lan array in cloud mode');
      assert.equal(infoData.settings.geminiApiKey, undefined, 'info.settings must not include API keys');

      // 4. ブラウザ離脱通知を試みても、自動終了タイマーが発動せずサーバーが稼働し続ける
      await fetch(`${base}/api/lifecycle/leave`, { method: 'POST' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      const healthAfter = await fetch(`${base}/api/health`);
      assert.equal(healthAfter.status, 200, '/api/health must still respond after leave in cloud mode');
    }
  );
});

test('A-3: Local mode preserves administrative routes and settings update', async () => {
  const customEnv = {};
  delete customEnv.SUPABASE_URL;

  await runWithCloudServer(
    {
      SUPABASE_URL: '',
    },
    async (base) => {
      // 1. GET /api/info に lan と settings が含まれる
      const infoRes = await fetch(`${base}/api/info`);
      assert.equal(infoRes.status, 200);
      const infoData = await infoRes.json();
      assert.ok(Array.isArray(infoData.lan), 'info must include lan in local mode');
      assert.ok(infoData.settings.geminiApiKey !== undefined, 'info must include geminiApiKey in local mode');

      // 2. PUT /api/settings が動作する
      const putRes = await fetch(`${base}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publisher: 'Local Studio' }),
      });
      assert.equal(putRes.status, 200);

      // 3. GET /api/qr が動作する
      const qrRes = await fetch(`${base}/api/qr?text=http://localhost:3956`);
      assert.equal(qrRes.status, 200);
      assert.ok(qrRes.headers.get('content-type').includes('image/svg+xml'));

      // 4. POST /api/shutdown が動作する
      const shutRes = await fetch(`${base}/api/shutdown`, { method: 'POST' });
      assert.equal(shutRes.status, 200);
    }
  );
});

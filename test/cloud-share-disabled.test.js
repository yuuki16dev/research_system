'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');
const history = require('../server/history');

const ROOT = path.join(__dirname, '..');

async function runWithServer(port, customEnv, callback) {
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    ...customEnv,
  };

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  const url = `http://127.0.0.1:${port}`;

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

  assert.ok(ready, `Test server failed to start on port ${port}`);

  try {
    await callback(url);
  } finally {
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch {}
      } else {
        child.kill('SIGKILL');
      }
    } catch {}
  }
}

test('A-6: Cloud mode disables /api/share/:id and /share/:id returning 404', async () => {
  const testReportId = 'c6c6c6c6-c6c6-46c6-86c6-c6c6c6c6c6c6';

  history.save({
    id: testReportId,
    title: 'Shared Report Test',
    theme: 'Shared Report Test',
    userId: 'owner-user',
    createdAt: new Date().toISOString(),
  });

  try {
    // 1. クラウドモードでの検証 (SUPABASE_URL 設定)
    await runWithServer(
      3961,
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        ENABLE_TEST_USERS: 'true',
      },
      async (base) => {
        const apiRes = await fetch(`${base}/api/share/${testReportId}`);
        assert.equal(apiRes.status, 404, 'GET /api/share/:id must return 404 in cloud mode');

        const pageRes = await fetch(`${base}/share/${testReportId}`);
        assert.equal(pageRes.status, 404, 'GET /share/:id must return 404 in cloud mode');
      }
    );

    // 2. ローカルモードでの後方互換性検証 (SUPABASE_URL 未設定)
    await runWithServer(
      3962,
      {
        SUPABASE_URL: '',
      },
      async (base) => {
        const apiRes = await fetch(`${base}/api/share/${testReportId}`);
        assert.equal(apiRes.status, 200, 'GET /api/share/:id must return 200 in local mode');
        const data = await apiRes.json();
        assert.equal(data.id, testReportId);

        const pageRes = await fetch(`${base}/share/${testReportId}`);
        assert.equal(pageRes.status, 200, 'GET /share/:id must return 200 in local mode');
      }
    );
  } finally {
    history.remove(testReportId, null, 'admin', { all: true });
  }
});

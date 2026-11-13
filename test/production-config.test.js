'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function runWithProductionServer(callback) {
  const { startDbCheckMockServer } = require('./helpers/mock-supabase-db');
  const mockDb = await startDbCheckMockServer();
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-prod-test-'));

  const env = { ...process.env };
  delete env.ENABLE_AUTH;
  delete env.ALLOW_ANONYMOUS_CLOUD;
  delete env.ENABLE_TEST_USERS;

  Object.assign(env, {
    PORT: String(port),
    NODE_ENV: 'production',
    SUPABASE_URL: mockDb.url,
    SUPABASE_ANON_KEY: 'dummy',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy',
    TAVILY_API_KEY: 'dummy',
    RESEARCH_DATA_DIR: tmpDir,
  });

  let logs = '';
  let exited = false;
  let exitCode = null;

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    assert.ok(ready, `Production server failed to start (exited=${exited}, code=${exitCode}). Logs:\n${logs}`);
    await callback(baseUrl);
  } finally {
    try {
      child.kill('SIGTERM');
      if (process.platform === 'win32' && child.pid) {
        try { child.kill('SIGKILL'); } catch {}
      }
    } catch {}
    await mockDb.close();
    await new Promise((r) => setTimeout(r, 200));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

test('R-2: Production cloud configuration enforces auth (401), disables local/admin/share routes (404), rejects test tokens, and sets CSP header', async () => {
  await runWithProductionServer(async (baseUrl) => {
    const protected401Routes = [
      { method: 'GET', path: '/api/history' },
      { method: 'GET', path: '/api/history/backup' },
      { method: 'GET', path: '/api/user/profile' },
      { method: 'POST', path: '/api/research', body: { theme: 'test' } },
      { method: 'POST', path: '/api/research/cross-synthesis', body: { reportIds: [] } },
      { method: 'POST', path: '/api/research/delta', body: { theme: 'test' } },
      { method: 'POST', path: '/api/research/deep-dive', body: { theme: 'test', question: 'q' } },
      { method: 'POST', path: '/api/presentation/generate', body: { document: 'doc' } },
      { method: 'POST', path: '/api/export/pdf', body: { data: { title: 't' } } },
      { method: 'POST', path: '/api/export/excel', body: { data: { title: 't' } } },
    ];

    for (const route of protected401Routes) {
      const init = {
        method: route.method,
        headers: route.body ? { 'Content-Type': 'application/json' } : {},
        body: route.body ? JSON.stringify(route.body) : undefined,
      };
      const res = await fetch(`${baseUrl}${route.path}`, init);
      assert.strictEqual(
        res.status,
        401,
        `Expected 401 for unauthenticated ${route.method} ${route.path}, got ${res.status}`
      );
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp && csp.length > 0, `Expected Content-Security-Policy header on ${route.method} ${route.path}`);
    }

    const disabled404Routes = [
      { method: 'POST', path: '/api/shutdown' },
      { method: 'POST', path: '/api/lifecycle/leave' },
      { method: 'PUT', path: '/api/settings', body: {} },
      { method: 'POST', path: '/api/settings/test', body: {} },
      { method: 'GET', path: '/api/logs' },
      { method: 'GET', path: '/api/memory' },
      { method: 'GET', path: '/api/usage' },
      { method: 'GET', path: '/api/qr' },
      { method: 'GET', path: '/api/share/550e8400-e29b-41d4-a716-446655440000' },
    ];

    for (const route of disabled404Routes) {
      const init = {
        method: route.method,
        headers: route.body ? { 'Content-Type': 'application/json' } : {},
        body: route.body ? JSON.stringify(route.body) : undefined,
      };
      const res = await fetch(`${baseUrl}${route.path}`, init);
      assert.strictEqual(
        res.status,
        404,
        `Expected 404 for disabled ${route.method} ${route.path}, got ${res.status}`
      );
      const csp = res.headers.get('content-security-policy');
      assert.ok(csp && csp.length > 0, `Expected Content-Security-Policy header on ${route.method} ${route.path}`);
    }

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer test-token-admin-user' },
    });
    assert.strictEqual(meRes.status, 200);
    const meJson = await meRes.json();
    assert.strictEqual(meJson.authenticated, false, 'Test token must be rejected in production config');
    const meCsp = meRes.headers.get('content-security-policy');
    assert.ok(meCsp && meCsp.length > 0, 'Expected Content-Security-Policy header on /api/auth/me');
  });
});


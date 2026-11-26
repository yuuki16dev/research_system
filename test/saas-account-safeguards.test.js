'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function getFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitReady(baseUrl, proc) {
  for (let i = 0; i < 80; i++) {
    if (proc.exitCode !== null) throw new Error(`Server exited with code ${proc.exitCode}`);
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

test('S-3 E2E: password reset, update password, self-service account deletion, Turnstile, and free-tier daily cap isolation', async () => {
  const userUuid = '33333333-3333-4333-8333-333333333333';
  const paidUuid = '44444444-4444-4444-8444-444444444444';

  const events = {
    recoverEmails: [],
    updatedPasswords: [],
    deletedTables: [],
    anonymizedUsage: false,
    deletedAuthUsers: [],
    turnstileTokens: [],
  };

  let mockDailyCost = 0;

  const mockRemote = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = '';
    req.on('data', (c) => { body += c.toString(); });
    req.on('end', () => {
      // Turnstile mock endpoint
      if (url.pathname === '/turnstile/siteverify') {
        const params = new URLSearchParams(body);
        const token = params.get('response') || '';
        events.turnstileTokens.push(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: token === 'valid-turnstile-token' }));
      }

      // Supabase Auth endpoints
      if (url.pathname === '/auth/v1/signup') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userUuid, email: 'new@example.com' }));
      }
      if (url.pathname === '/auth/v1/recover') {
        const parsed = JSON.parse(body || '{}');
        events.recoverEmails.push(parsed.email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
        const parsed = JSON.parse(body || '{}');
        events.updatedPasswords.push({ auth: req.headers.authorization, password: parsed.password });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userUuid }));
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const authHdr = req.headers.authorization || '';
        if (authHdr === 'Bearer free-jwt') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ id: userUuid, email: 'free@example.com' }));
        }
        if (authHdr === 'Bearer paid-jwt') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ id: paidUuid, email: 'paid@example.com' }));
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid token' }));
      }
      if (url.pathname.startsWith('/auth/v1/admin/users/') && req.method === 'DELETE') {
        const uid = url.pathname.split('/').pop();
        events.deletedAuthUsers.push(uid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }

      // Supabase REST / RPC endpoints
      if (url.pathname === '/rest/v1/rpc/usage_cost_since') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(String(mockDailyCost));
      }
      if (url.pathname === '/rest/v1/rpc/consume_credits') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('true');
      }
      if (url.pathname === '/rest/v1/rpc/refund_credits') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('null');
      }
      if (url.pathname === '/rest/v1/profiles' && req.method === 'GET') {
        if (url.search.includes(paidUuid)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([{ plan: 'standard', subscription_status: 'active' }]));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ plan: 'free', subscription_status: 'active' }]));
      }
      if (url.pathname === '/rest/v1/usage_events' && req.method === 'PATCH') {
        events.anonymizedUsage = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('[]');
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/rest/v1/')) {
        events.deletedTables.push(url.pathname);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('[]');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
  });

  const remotePort = await new Promise((resolve) =>
    mockRemote.listen(0, '127.0.0.1', () => resolve(mockRemote.address().port))
  );
  const serverPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  const proc = fork(path.join(ROOT, 'server', 'index.js'), [], {
    env: {
      ...process.env,
      PORT: String(serverPort),
      NODE_ENV: 'test',
      SUPABASE_URL: `http://127.0.0.1:${remotePort}`,
      SUPABASE_ANON_KEY: 'sb_publishable_mock_s3',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_mock_s3',
      TAVILY_API_KEY: 'dummy-tavily',
      TURNSTILE_SITE_KEY: '0x4AAAAAA_test_site_key',
      TURNSTILE_SECRET_KEY: '0x4AAAAAA_test_secret_key',
      TURNSTILE_VERIFY_URL: `http://127.0.0.1:${remotePort}/turnstile/siteverify`,
      DAILY_COST_LIMIT_JPY: '1000',
      FREE_DAILY_COST_LIMIT_JPY: '300',
    },
    stdio: 'pipe',
  });

  try {
    await waitReady(baseUrl, proc);

    // 1. /api/auth/config exposes turnstileSiteKey and CSP allows challenges.cloudflare.com
    const cfgRes = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(cfgRes.status, 200);
    const csp = cfgRes.headers.get('content-security-policy') || '';
    assert.ok(csp.includes('https://challenges.cloudflare.com'), 'CSP must allow Turnstile when configured');
    const cfg = await cfgRes.json();
    assert.equal(cfg.turnstileSiteKey, '0x4AAAAAA_test_site_key');

    // 2. Turnstile blocks signup without/with invalid token, allows valid token
    const noCaptcha = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'password123' }),
    });
    assert.equal(noCaptcha.status, 400);

    const badCaptcha = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'password123', captchaToken: 'bad-token' }),
    });
    assert.equal(badCaptcha.status, 400);

    const okSignup = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'password123', captchaToken: 'valid-turnstile-token' }),
    });
    assert.equal(okSignup.status, 200);

    // 3. Password reset request
    const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'free@example.com' }),
    });
    assert.equal(resetRes.status, 200);
    assert.deepEqual(events.recoverEmails, ['free@example.com']);

    // 4. Update password with recovery Bearer token
    const shortPassRes = await fetch(`${baseUrl}/api/auth/update-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer recovery-tok' },
      body: JSON.stringify({ password: 'short' }),
    });
    assert.equal(shortPassRes.status, 400);

    const okPassRes = await fetch(`${baseUrl}/api/auth/update-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer recovery-tok' },
      body: JSON.stringify({ password: 'newstrongpassword' }),
    });
    assert.equal(okPassRes.status, 200);
    assert.equal(events.updatedPasswords.length, 1);
    assert.equal(events.updatedPasswords[0].auth, 'Bearer recovery-tok');

    // 5. Free-tier daily cost cap blocks free user at 350 JPY while paid user still succeeds (< 1000 JPY)
    mockDailyCost = 350;
    const freeRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer free-jwt' },
      body: JSON.stringify({ theme: '無料枠テストテーマ', depth: 'quick', forceMock: true }),
    });
    assert.equal(freeRes.status, 503);
    const freeErr = await freeRes.json();
    assert.equal(freeErr.code, 'FREE_DAILY_LIMIT_REACHED');

    const paidRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer paid-jwt' },
      body: JSON.stringify({ theme: '有料枠保護テストテーマ', depth: 'quick', forceMock: true }),
    });
    assert.equal(paidRes.status, 202, 'Paid user must NOT be blocked by free-tier daily cap');

    // 6. Self-service account deletion requires auth & confirm: 'DELETE'
    const unauthDel = await fetch(`${baseUrl}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(unauthDel.status, 401);

    const badConfirmDel = await fetch(`${baseUrl}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer free-jwt' },
      body: JSON.stringify({ confirm: 'WRONG' }),
    });
    assert.equal(badConfirmDel.status, 400);

    const okDel = await fetch(`${baseUrl}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer free-jwt' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(okDel.status, 200);
    assert.equal(events.anonymizedUsage, true);
    assert.ok(events.deletedTables.includes('/rest/v1/user_reports'));
    assert.ok(events.deletedTables.includes('/rest/v1/research_usage'));
    assert.ok(events.deletedTables.includes('/rest/v1/profiles'));
    assert.deepEqual(events.deletedAuthUsers, [userUuid]);
  } finally {
    proc.kill();
    await new Promise((r) => proc.once('exit', r));
    await new Promise((r) => mockRemote.close(r));
  }
});

test('S-3 UI consistency: signup, reset, recovery, Turnstile, and account deletion elements exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('minlength="8"'), 'signup password input must require 8 chars');
  assert.ok(!html.includes('月3回まで高精度ディープリサーチ'), 'signup perk must not misstate free deep research');
  assert.ok(html.includes('id="btn-show-reset-password"'), 'login form must include password reset button');
  assert.ok(html.includes('id="auth-form-reset"'), 'auth modal must include password reset form');
  assert.ok(html.includes('id="auth-form-update-password"'), 'auth modal must include recovery password update form');
  assert.ok(html.includes('id="turnstile-signup-container"'), 'signup form must include Turnstile container');
  assert.ok(html.includes('id="account-danger-zone"'), 'account modal must include danger zone');
  assert.ok(html.includes('id="btn-account-delete"'), 'account modal must include delete button');
  assert.ok(html.includes('id="footer-env-label"'), 'footer must include dynamic env label');
});

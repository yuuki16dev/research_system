'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../server/auth');
const quota = require('../server/quota');

test('auth: local fallback automatically grants admin access when SUPABASE_URL is not configured', (t, done) => {
  const req = { headers: {} };
  const res = {};
  auth.requireAuth(req, res, () => {
    assert.ok(req.user, 'req.user must be populated');
    assert.ok(req.user.id === 'owner-user' || req.user.id === 'local-user');
    assert.strictEqual(req.user.plan, 'admin');
    done();
  });
});

test('auth: optionalAuth populates local user when SUPABASE_URL is not configured', (t, done) => {
  const req = { headers: {} };
  const res = {};
  auth.optionalAuth(req, res, () => {
    assert.ok(req.user, 'req.user must be populated');
    assert.strictEqual(req.user.plan, 'admin');
    done();
  });
});

test('quota: PLAN_LIMITS properly defines free, light, pro, and admin', () => {
  assert.strictEqual(quota.PLAN_LIMITS.free, 3, 'free plan must have 3 research quota');
  assert.strictEqual(quota.PLAN_LIMITS.light, 40, 'light plan must have 40 research quota');
  assert.strictEqual(quota.PLAN_LIMITS.pro, 80, 'pro plan must have 80 research quota');
  assert.strictEqual(quota.PLAN_LIMITS.admin, Infinity, 'admin plan must be unlimited');
});

test('quota: getMonthlyQuota returns valid quota structure', async () => {
  const q = await quota.getMonthlyQuota('test-user', 'light');
  assert.strictEqual(q.limit, 40);
  assert.strictEqual(q.plan, 'light');
  assert.strictEqual(typeof q.used, 'number');
  assert.strictEqual(typeof q.remaining, 'number');
  assert.strictEqual(typeof q.canResearch, 'boolean');
  assert.match(q.yearMonth, /^\d{4}-\d{2}$/);
});

test('quota: requireQuota blocks request when limit is reached', async () => {
  const uid = `blocked-user-${Date.now()}`;
  const req = {
    user: { id: uid, plan: 'free' },
  };

  // Reserve 3 credits (free plan monthly limit = 3)
  await quota.reserveCredits(uid, 'free', 'research_quick');
  await quota.reserveCredits(uid, 'free', 'research_quick');
  await quota.reserveCredits(uid, 'free', 'research_quick');

  await new Promise((resolve) => {
    const res = {
      status(code) {
        assert.strictEqual(code, 403, 'Must return 403 Forbidden');
        return {
          json(payload) {
            assert.strictEqual(payload.code, 'QUOTA_EXCEEDED');
            assert.ok(payload.error.includes('リサーチ上限回数'));
            resolve();
          },
        };
      },
    };
    quota.requireQuota(req, res, () => {
      assert.fail('Should not call next when quota exceeded');
    });
  });
});

test('auth: signupUser and loginUser reject gracefully when SUPABASE_URL is unconfigured', async () => {
  await assert.rejects(async () => {
    await auth.signupUser('test@example.com', 'password123');
  }, /Supabase/);

  await assert.rejects(async () => {
    await auth.loginUser('test@example.com', 'password123');
  }, /Supabase/);
});

test('auth & quota: UI elements and DOM consistency in public/index.html', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  // ヘッダーメーター
  assert.ok(html.includes('id="auth-meter-container"'), 'Must have auth-meter-container');
  assert.ok(html.includes('id="btn-open-auth-modal"'), 'Must have btn-open-auth-modal');
  assert.ok(html.includes('id="user-quota-badge"'), 'Must have user-quota-badge');
  assert.ok(html.includes('id="user-plan-pill"'), 'Must have user-plan-pill');
  assert.ok(html.includes('id="user-quota-count"'), 'Must have user-quota-count');

  // 認証モーダル
  assert.ok(html.includes('id="modal-auth"'), 'Must have modal-auth');
  assert.ok(html.includes('id="auth-tab-login"'), 'Must have auth-tab-login');
  assert.ok(html.includes('id="auth-tab-signup"'), 'Must have auth-tab-signup');
  assert.ok(html.includes('id="auth-form-login"'), 'Must have auth-form-login');
  assert.ok(html.includes('id="auth-form-signup"'), 'Must have auth-form-signup');

  // アカウント詳細モーダル
  assert.ok(html.includes('id="modal-account"'), 'Must have modal-account');
  assert.ok(html.includes('id="btn-account-logout"'), 'Must have btn-account-logout');
});

test('R-9 #1: /api/auth/login and /api/auth/signup return 503 with fixed message when Supabase is unreachable, and 401 on credential failure', async () => {
  const http = require('http');
  const net = require('net');
  const path = require('path');
  const { fork } = require('child_process');
  const { handleDbCheckRequest } = require('./helpers/mock-supabase-db');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    req.resume();
    if (handleDbCheckRequest(req, res, url)) return;
    if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error_description: 'Invalid login credentials' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const mockPort = server.address().port;
  const closeMock = () =>
    new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });

  const srvPort = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

  let mockClosed = false;
  const child = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(srvPort),
      NODE_ENV: 'production',
      SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
      SUPABASE_ANON_KEY: 'dummy-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
      TAVILY_API_KEY: 'dummy-tavily-key',
      ENABLE_TEST_USERS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timed out')), 25000);
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.includes('Research Studio') || text.includes(String(srvPort))) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited prematurely with code ${code}`));
      });
    });

    // 1. 通常の認証失敗は 401 のまま
    const failRes = await fetch(`http://127.0.0.1:${srvPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'wrongpassword' }),
    });
    assert.strictEqual(failRes.status, 401);
    const failBody = await failRes.json();
    assert.strictEqual(failBody.error, 'Invalid login credentials');

    // 2. Supabase 停止後は接続エラー -> 503 と定型文のみ返し fetch failed を露出しない
    await closeMock();
    mockClosed = true;

    const downLoginRes = await fetch(`http://127.0.0.1:${srvPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });
    assert.strictEqual(downLoginRes.status, 503);
    const downLoginBody = await downLoginRes.json();
    assert.strictEqual(
      downLoginBody.error,
      '認証サーバーに接続できませんでした。しばらくしてから再度お試しください'
    );
    assert.ok(!/fetch failed/i.test(downLoginBody.error));

    const downSignupRes = await fetch(`http://127.0.0.1:${srvPort}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });
    assert.strictEqual(downSignupRes.status, 503);
    const downSignupBody = await downSignupRes.json();
    assert.strictEqual(
      downSignupBody.error,
      '認証サーバーに接続できませんでした。しばらくしてから再度お試しください'
    );
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000).unref();
    if (!mockClosed) await closeMock();
  }
});


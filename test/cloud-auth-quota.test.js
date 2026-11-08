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

test('quota: requireQuota blocks request when limit is reached', (t, done) => {
  const req = {
    user: { id: 'blocked-user', plan: 'free' },
  };

  // Simulate reaching quota by recording 3 usages
  const ym = quota.getCurrentYearMonth();
  quota.recordUsage('blocked-user', 'free').then(() => {
    quota.recordUsage('blocked-user', 'free').then(() => {
      quota.recordUsage('blocked-user', 'free').then(() => {
        const res = {
          status(code) {
            assert.strictEqual(code, 403, 'Must return 403 Forbidden');
            return {
              json(payload) {
                assert.strictEqual(payload.code, 'QUOTA_EXCEEDED');
                assert.ok(payload.error.includes('リサーチ上限回数'));
                done();
              },
            };
          },
        };
        quota.requireQuota(req, res, () => {
          assert.fail('Should not call next when quota exceeded');
        });
      });
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


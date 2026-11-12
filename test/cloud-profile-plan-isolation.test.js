'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');
const auth = require('../server/auth');

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

test('B-1: verifyToken reads plan from profiles table and ignores user_metadata.plan', async () => {
  const originalFetch = globalThis.fetch;
  auth.clearProfileCache();

  const prevEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
  };

  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'mock-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';
  process.env.ADMIN_USER_IDS = 'admin-uuid-999';

  const mockUserPayload = {
    id: 'user-uuid-123',
    email: 'hacker@example.com',
    role: 'authenticated',
    user_metadata: {
      plan: 'admin', // ユーザーが自己書き換えした偽の admin
    },
  };

  const mockProfileRow = [
    {
      plan: 'free', // 実際の profiles テーブルの契約プラン
      subscription_status: 'active',
    },
  ];

  let profileFetchCount = 0;

  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('/auth/v1/user')) {
      return {
        ok: true,
        status: 200,
        json: async () => mockUserPayload,
      };
    }
    if (urlStr.includes('/rest/v1/profiles')) {
      profileFetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => mockProfileRow,
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    // 1回目の検証: profiles から plan: 'free' が返る（user_metadata.plan: 'admin' は無視される）
    const user = await auth.verifyToken('valid-jwt-token-hacker');
    assert.ok(user, 'User should be authenticated');
    assert.equal(user.id, 'user-uuid-123');
    assert.equal(user.plan, 'free', 'Plan MUST be free from profiles, NOT admin from user_metadata');
    assert.equal(profileFetchCount, 1, 'Profile should be fetched once');

    // 2回目の検証: 60秒キャッシュが効いて profiles への REST fetch は再発走しない
    const cachedUser = await auth.verifyToken('valid-jwt-token-hacker');
    assert.equal(cachedUser.plan, 'free');
    assert.equal(profileFetchCount, 1, 'Profile should be cached for 60 seconds without re-fetching');
  } finally {
    globalThis.fetch = originalFetch;
    auth.clearProfileCache();
    process.env.SUPABASE_URL = prevEnv.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = prevEnv.SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_USER_IDS = prevEnv.ADMIN_USER_IDS;
  }
});

test('B-1: Cloud mode treats plan === admin as free unless userId is in ADMIN_USER_IDS', async () => {
  const originalFetch = globalThis.fetch;
  auth.clearProfileCache();

  const prevEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
  };

  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'mock-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';
  process.env.ADMIN_USER_IDS = 'real-admin-uuid-111, other-admin-uuid-222';

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/auth/v1/user')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'impostor-uuid-333',
          email: 'impostor@example.com',
          role: 'authenticated',
        }),
      };
    }
    if (urlStr.includes('/rest/v1/profiles')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ plan: 'admin', subscription_status: 'active' }],
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    // impostor-uuid-333 は profiles に admin とあっても ADMIN_USER_IDS に含まれないため free に落とされる
    const user = await auth.verifyToken('valid-jwt-token-impostor');
    assert.equal(user.plan, 'free', 'Non-ADMIN_USER_IDS user cannot be granted admin plan');
  } finally {
    globalThis.fetch = originalFetch;
    auth.clearProfileCache();
    process.env.SUPABASE_URL = prevEnv.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = prevEnv.SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ADMIN_USER_IDS = prevEnv.ADMIN_USER_IDS;
  }
});

test('B-1: Server startup crashes if SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
  const { execPath } = process;
  const { spawnSync } = require('child_process');

  const result = spawnSync(execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: '3991',
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: '', // 欠落
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, 'Server must fail startup without service role key');
  assert.ok(
    result.stderr.includes('SUPABASE_SERVICE_ROLE_KEY') || result.stdout.includes('SUPABASE_SERVICE_ROLE_KEY'),
    'Error message must indicate missing SUPABASE_SERVICE_ROLE_KEY'
  );
});

test('B-1: End-to-end GET /api/auth/me retains profiles.plan even if user_metadata.plan is admin', async () => {
  const http = require('http');

  // モック Supabase サーバーを起動
  const mockSupabasePort = 3996;
  const mockSupabase = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/auth/v1/user')) {
      // ユーザーメタデータには改ざんされた admin が入っている
      return res.end(
        JSON.stringify({
          id: 'user-uuid-tampered',
          email: 'tampered@example.com',
          role: 'authenticated',
          user_metadata: { plan: 'admin' },
        })
      );
    }
    if (req.url.startsWith('/rest/v1/profiles')) {
      // profiles テーブルの正式プランは free
      return res.end(
        JSON.stringify([
          {
            plan: 'free',
            subscription_status: 'active',
          },
        ])
      );
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => mockSupabase.listen(mockSupabasePort, resolve));

  try {
    await runWithServer(
      3997,
      {
        SUPABASE_URL: `http://127.0.0.1:${mockSupabasePort}`,
        SUPABASE_ANON_KEY: 'mock-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
      },
      async (base) => {
        const res = await fetch(`${base}/api/auth/me`, {
          headers: {
            Authorization: 'Bearer mock-tampered-token',
          },
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.authenticated, true);
        assert.equal(data.user.id, 'user-uuid-tampered');
        assert.equal(data.user.plan, 'free', 'Plan must be "free" as stored in profiles table');
        assert.notEqual(data.user.plan, 'admin', 'Plan must NOT be "admin" from user_metadata');
      }
    );
  } finally {
    await new Promise((resolve) => mockSupabase.close(resolve));
  }
});

'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const getFreePort = () =>
  new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });

/**
 * 認可テスト専用の Supabase モックサーバー
 */
function createMockSupabaseServer() {
  const store = new Map(); // id -> row
  const requestLog = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let bodyStr = '';

    req.on('data', (chunk) => {
      bodyStr += chunk;
    });

    req.on('end', () => {
      let body = null;
      if (bodyStr) {
        try {
          body = JSON.parse(bodyStr);
        } catch {
          body = bodyStr;
        }
      }

      requestLog.push({
        method: req.method,
        pathname: url.pathname,
        headers: req.headers,
        body,
      });

      // 1. Supabase Auth ユーザー検証: /auth/v1/user
      if (url.pathname === '/auth/v1/user') {
        const authHeader = req.headers.authorization || '';
        if (authHeader === 'Bearer valid-token-user-a') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              id: 'user-a-uuid',
              email: 'user-a@example.com',
              user_metadata: { plan: 'admin' }, // 改ざんされたメタデータ
            })
          );
        }
        if (authHeader === 'Bearer valid-token-user-b') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              id: 'user-b-uuid',
              email: 'user-b@example.com',
              user_metadata: {},
            })
          );
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Invalid JWT' }));
      }

      // 2. profiles テーブル取得: /rest/v1/profiles
      if (url.pathname === '/rest/v1/profiles') {
        const idParam = url.searchParams.get('id');
        let targetId = 'unknown';
        if (idParam && idParam.startsWith('eq.')) {
          targetId = idParam.slice(3);
        }
        // DB 上はどちらのユーザーも free プラン
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify([
            {
              id: targetId,
              plan: 'free',
              subscription_status: 'active',
            },
          ])
        );
      }

      // 3. user_reports テーブル: /rest/v1/user_reports
      if (url.pathname === '/rest/v1/user_reports') {
        const userIdParam = url.searchParams.get('user_id');
        const idParam = url.searchParams.get('id');

        let matched = Array.from(store.values());

        if (userIdParam && userIdParam.startsWith('eq.')) {
          const targetUserId = userIdParam.slice(3);
          matched = matched.filter((r) => r.user_id === targetUserId);
        }

        if (idParam && idParam.startsWith('eq.')) {
          const targetId = idParam.slice(3);
          matched = matched.filter((r) => r.id === targetId);
        }

        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(matched));
        }

        if (req.method === 'POST') {
          const row = body;
          store.set(row.id, {
            ...row,
            pinned: Boolean(row.pinned),
            created_at: row.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([store.get(row.id)]));
        }

        if (req.method === 'PATCH') {
          const updated = [];
          for (const item of matched) {
            const current = store.get(item.id);
            const next = { ...current, ...body, updated_at: new Date().toISOString() };
            store.set(item.id, next);
            updated.push(next);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(updated));
        }

        if (req.method === 'DELETE') {
          const deleted = [];
          for (const item of matched) {
            store.delete(item.id);
            deleted.push(item);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(deleted));
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });

  return {
    server,
    store,
    requestLog,
    listen: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('B-11: Comprehensive Cloud Authorization and Tenant Isolation Suite', async () => {
  const mockSupabase = createMockSupabaseServer();
  const mockSupabaseUrl = await mockSupabase.listen();

  // 事前に利用者B（user-b-uuid）のレポートを DB に格納しておく
  mockSupabase.store.set('report-b-001', {
    id: 'report-b-001',
    user_id: 'user-b-uuid',
    theme: '利用者Bの極秘戦略レポート',
    title: '利用者Bの極秘戦略レポート',
    summary: '極秘データ',
    pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: mockSupabaseUrl,
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_service_role_key',
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
  const tokenA = 'Bearer valid-token-user-a';
  const tokenB = 'Bearer valid-token-user-b';

  try {
    // -------------------------------------------------------------------------
    // 1. トークンなしで、A-4・A-5 の全保護ルートが 401 を返すこと
    // -------------------------------------------------------------------------
    const protectedRoutes = [
      // A-4 履歴・プロファイル・複合分析
      { method: 'GET', path: '/api/history' },
      { method: 'GET', path: '/api/history/backup' },
      { method: 'POST', path: '/api/history/restore', body: { reports: [] } },
      { method: 'GET', path: '/api/history/dummy-id-123' },
      { method: 'PATCH', path: '/api/history/dummy-id-123', body: { title: 'New' } },
      { method: 'PUT', path: '/api/history/dummy-id-123', body: { title: 'New' } },
      { method: 'DELETE', path: '/api/history/dummy-id-123' },
      { method: 'POST', path: '/api/history/dummy-id-123/pin' },
      { method: 'GET', path: '/api/user/profile' },
      { method: 'PUT', path: '/api/user/profile', body: { displayName: 'Tester' } },
      { method: 'POST', path: '/api/research/cross-synthesis', body: { reportIds: ['id1', 'id2'] } },
      { method: 'POST', path: '/api/research/delta', body: { baseReportId: 'id1' } },

      // A-5 AI・出力系
      { method: 'POST', path: '/api/research/deep-dive', body: { theme: 'AI', question: 'Q' } },
      { method: 'POST', path: '/api/presentation/prompt', body: { report: { title: 'T' } } },
      { method: 'POST', path: '/api/presentation/generate', body: { outline: [] } },
      { method: 'POST', path: '/api/export/pdf/html', body: { data: { title: 'T' }, template: 'decision-brief' } },
      { method: 'POST', path: '/api/export/pdf', body: { data: { title: 'T' }, template: 'decision-brief' } },
      { method: 'POST', path: '/api/export/excel', body: { data: { title: 'T' } } },
      { method: 'POST', path: '/api/export/markdown', body: { data: { title: 'T' } } },
      { method: 'POST', path: '/api/export/text', body: { data: { title: 'T' } } },
    ];

    for (const route of protectedRoutes) {
      const opts = { method: route.method };
      if (route.body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(route.body);
      }
      const res = await fetch(`${baseUrl}${route.path}`, opts);
      assert.strictEqual(
        res.status,
        401,
        `Unauthenticated ${route.method} ${route.path} must return 401 (got ${res.status})`
      );
    }

    // -------------------------------------------------------------------------
    // 2. A-3 の全管理系ルートが 404 を返すこと
    // -------------------------------------------------------------------------
    const disabledAdminRoutes = [
      { method: 'POST', path: '/api/lifecycle/leave' },
      { method: 'POST', path: '/api/shutdown' },
      { method: 'PUT', path: '/api/settings', body: {} },
      { method: 'POST', path: '/api/settings/test', body: {} },
      { method: 'GET', path: '/api/usage' },
      { method: 'GET', path: '/api/logs' },
      { method: 'GET', path: '/api/memory' },
      { method: 'DELETE', path: '/api/memory/domain.com' },
      { method: 'POST', path: '/api/memory/clear' },
      { method: 'GET', path: '/api/qr' },
      { method: 'GET', path: '/api/share/some-id' },
      { method: 'GET', path: '/share/some-id' },
    ];

    for (const route of disabledAdminRoutes) {
      const opts = {
        method: route.method,
        headers: { Authorization: tokenA },
      };
      if (route.body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(route.body);
      }
      const res = await fetch(`${baseUrl}${route.path}`, opts);
      assert.strictEqual(
        res.status,
        404,
        `Cloud disabled route ${route.method} ${route.path} must return 404 (got ${res.status})`
      );
    }

    // -------------------------------------------------------------------------
    // 3. 利用者Aが利用者Bのレポートを取得・更新・削除・ピン留め・クロス・差分の対象にできない（404）
    // -------------------------------------------------------------------------
    const targetReportId = 'report-b-001';

    // 3-a. GET
    const resGetOther = await fetch(`${baseUrl}/api/history/${targetReportId}`, {
      headers: { Authorization: tokenA },
    });
    assert.strictEqual(resGetOther.status, 404, 'User A GET User B report must return 404');

    // 3-b. PATCH
    const resPatchOther = await fetch(`${baseUrl}/api/history/${targetReportId}`, {
      method: 'PATCH',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked Title' }),
    });
    assert.strictEqual(resPatchOther.status, 404, 'User A PATCH User B report must return 404');

    // 3-c. PUT
    const resPutOther = await fetch(`${baseUrl}/api/history/${targetReportId}`, {
      method: 'PUT',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Overwritten Title' }),
    });
    assert.strictEqual(resPutOther.status, 404, 'User A PUT User B report must return 404');

    // 3-d. DELETE
    const resDeleteOther = await fetch(`${baseUrl}/api/history/${targetReportId}`, {
      method: 'DELETE',
      headers: { Authorization: tokenA },
    });
    assert.strictEqual(resDeleteOther.status, 404, 'User A DELETE User B report must return 404');

    // 3-e. PIN
    const resPinOther = await fetch(`${baseUrl}/api/history/${targetReportId}/pin`, {
      method: 'POST',
      headers: { Authorization: tokenA },
    });
    assert.strictEqual(resPinOther.status, 404, 'User A PIN User B report must return 404');

    // 3-f. CROSS SYNTHESIS
    const resCrossOther = await fetch(`${baseUrl}/api/research/cross-synthesis`, {
      method: 'POST',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportIds: [targetReportId, 'dummy-id-2'] }),
    });
    assert.strictEqual(resCrossOther.status, 404, 'User A Cross-Synthesis with User B report must return 404');

    // 3-g. DELTA TRACKING
    const resDeltaOther = await fetch(`${baseUrl}/api/research/delta`, {
      method: 'POST',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseReportId: targetReportId }),
    });
    assert.strictEqual(resDeltaOther.status, 404, 'User A Delta with User B report must return 404');

    // レポートBが一切変更・削除されていないことを検証
    const reportBInDb = mockSupabase.store.get(targetReportId);
    assert.ok(reportBInDb, 'Report B must still exist in DB');
    assert.strictEqual(reportBInDb.title, '利用者Bの極秘戦略レポート');

    // -------------------------------------------------------------------------
    // 4. user_metadata.plan = 'admin' でも free として扱われること (B-1 検証)
    // -------------------------------------------------------------------------
    const resMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: tokenA },
    });
    assert.strictEqual(resMe.status, 200);
    const meData = await resMe.json();
    assert.strictEqual(meData.authenticated, true);
    assert.strictEqual(
      meData.user.plan,
      'free',
      'user_metadata.plan=admin must be ignored and fallback to profiles.plan=free'
    );
  } finally {
    serverProcess.kill('SIGTERM');
    await mockSupabase.close();
  }
});

test('B-11: Production environment rejects test-token-admin-user and test accounts', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://prod-test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_prod',
      ENABLE_AUTH: 'true',
      NODE_ENV: 'production', // 本番環境モード
      ENABLE_TEST_USERS: undefined,
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

  try {
    // 1. test-token-admin-user で /api/auth/me を呼び出す -> authenticated: false
    const resMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer test-token-admin-user' },
    });
    assert.strictEqual(resMe.status, 200);
    const dataMe = await resMe.json();
    assert.strictEqual(dataMe.authenticated, false, 'test-token must be rejected in production');

    // 2. test-token-admin-user で保護ルートにアクセス -> 401
    const resHistory = await fetch(`${baseUrl}/api/history`, {
      headers: { Authorization: 'Bearer test-token-admin-user' },
    });
    assert.strictEqual(resHistory.status, 401, 'Protected route with test-token must return 401');

    // 3. admin@test.local でのログイン試行 -> 失敗
    const resLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.local', password: 'password123' }),
    });
    assert.notStrictEqual(resLogin.status, 200, 'Test account login must fail in production');
  } finally {
    serverProcess.kill('SIGTERM');
  }
});


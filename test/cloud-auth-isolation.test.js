'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');
const history = require('../server/history');

const ROOT = path.join(__dirname, '..');

async function runWithServer(customEnv, callback) {
  const testPort = 3957;
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

test('A-4: Cloud mode rejects unauthenticated history access and isolates users', async () => {
  const reportAId = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
  const reportBId = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';

  // 事前にテスト用レポートをセットアップ
  history.save({
    id: reportAId,
    title: 'Report A for User A',
    theme: 'Report A for User A',
    userId: 'user-a',
    createdAt: new Date().toISOString(),
  });

  history.save({
    id: reportBId,
    title: 'Report B for User B',
    theme: 'Report B for User B',
    userId: 'user-b',
    createdAt: new Date().toISOString(),
  });

  try {
    await runWithServer(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        ENABLE_TEST_USERS: 'true',
      },
      async (base) => {
        // 1. トークンなしの GET /api/history は 401 を返す
        const noAuthHistory = await fetch(`${base}/api/history`);
        assert.equal(noAuthHistory.status, 401, 'Unauthenticated GET /api/history must return 401');

        // 2. トークンなしの GET /api/history/:id は 401 を返す
        const noAuthItem = await fetch(`${base}/api/history/${reportAId}`);
        assert.equal(noAuthItem.status, 401, 'Unauthenticated GET /api/history/:id must return 401');

        // 3. トークンなしの GET /api/user/profile は 401 を返す
        const noAuthProfile = await fetch(`${base}/api/user/profile`);
        assert.equal(noAuthProfile.status, 401, 'Unauthenticated GET /api/user/profile must return 401');

        // 4. 利用者A のトークンで GET /api/history ➔ 自分のレポートAのみ取得
        const resListA = await fetch(`${base}/api/history`, {
          headers: { Authorization: 'Bearer test-token-user-a' },
        });
        assert.equal(resListA.status, 200);
        const listA = await resListA.json();
        const idsA = listA.map((r) => r.id);
        assert.ok(idsA.includes(reportAId), 'User A must see report A');
        assert.ok(!idsA.includes(reportBId), 'User A must NOT see report B');

        // 5. 利用者A のトークンで利用者BのレポートIDを指定 ➔ 404 を返す
        const crossGet = await fetch(`${base}/api/history/${reportBId}`, {
          headers: { Authorization: 'Bearer test-token-user-a' },
        });
        assert.equal(crossGet.status, 404, 'User A accessing Report B must return 404');

        const crossPatch = await fetch(`${base}/api/history/${reportBId}`, {
          method: 'PATCH',
          headers: { Authorization: 'Bearer test-token-user-a', 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Hacked Title' }),
        });
        assert.equal(crossPatch.status, 404, 'User A patching Report B must return 404');

        const crossDelete = await fetch(`${base}/api/history/${reportBId}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer test-token-user-a' },
        });
        assert.equal(crossDelete.status, 404, 'User A deleting Report B must return 404');

        // 6. 利用者B のトークンで利用者B自身のレポートを取得・削除可能
        const ownGetB = await fetch(`${base}/api/history/${reportBId}`, {
          headers: { Authorization: 'Bearer test-token-user-b' },
        });
        assert.equal(ownGetB.status, 200, 'User B accessing Report B must return 200');

        const ownDeleteB = await fetch(`${base}/api/history/${reportBId}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer test-token-user-b' },
        });
        assert.equal(ownDeleteB.status, 200, 'User B deleting Report B must return 200');
      }
    );
  } finally {
    history.remove(reportAId, null, 'admin', { all: true });
    history.remove(reportBId, null, 'admin', { all: true });
  }
});

test('A-4: Local mode allows history access without token as owner-user', async () => {
  await runWithServer(
    {
      SUPABASE_URL: '',
    },
    async (base) => {
      // ローカル版ではトークンなしでも 200 OK で履歴が返る
      const res = await fetch(`${base}/api/history`);
      assert.equal(res.status, 200, 'Local mode must return 200 for GET /api/history without token');
      const data = await res.json();
      assert.ok(Array.isArray(data), 'Local mode history must be an array');
    }
  );
});


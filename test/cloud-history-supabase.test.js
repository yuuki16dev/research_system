'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// テスト用モック Supabase サーバーの作成
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
        url: req.url,
        pathname: url.pathname,
        searchParams: Object.fromEntries(url.searchParams.entries()),
        headers: req.headers,
        body,
      });

      // API Key / Authorization の検証
      if (!req.headers.apikey || !req.headers.authorization) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }

      // /rest/v1/user_reports
      if (url.pathname === '/rest/v1/user_reports') {
        const userIdParam = url.searchParams.get('user_id');
        const idParam = url.searchParams.get('id');
        const createdAtParam = url.searchParams.get('created_at');

        let matched = Array.from(store.values());

        // user_id フィルタ
        if (userIdParam && userIdParam.startsWith('eq.')) {
          const targetUserId = userIdParam.slice(3);
          matched = matched.filter((r) => r.user_id === targetUserId);
        }

        // id フィルタ
        if (idParam && idParam.startsWith('eq.')) {
          const targetId = idParam.slice(3);
          matched = matched.filter((r) => r.id === targetId);
        } else if (idParam && idParam.startsWith('in.(')) {
          const rawIds = idParam.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''));
          matched = matched.filter((r) => rawIds.includes(r.id));
        }

        // created_at フィルタ (gte / lt)
        if (createdAtParam && createdAtParam.startsWith('gte.')) {
          const iso = createdAtParam.slice(4);
          matched = matched.filter((r) => r.created_at >= iso);
        } else if (createdAtParam && createdAtParam.startsWith('lt.')) {
          const iso = createdAtParam.slice(3);
          matched = matched.filter((r) => r.created_at < iso);
        }

        if (req.method === 'GET') {
          // ソート
          const order = url.searchParams.get('order');
          if (order && order.includes('pinned.desc')) {
            matched.sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return String(b.created_at).localeCompare(String(a.created_at));
            });
          } else if (order && order.includes('pinned.asc')) {
            matched.sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? 1 : -1;
              return String(a.created_at).localeCompare(String(b.created_at));
            });
          }

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
          const updatedRows = [];
          for (const item of matched) {
            const current = store.get(item.id);
            const next = {
              ...current,
              ...body,
              pinned: body.pinned !== undefined ? Boolean(body.pinned) : current.pinned,
              updated_at: new Date().toISOString(),
            };
            store.set(item.id, next);
            updatedRows.push(next);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(updatedRows));
        }

        if (req.method === 'DELETE') {
          const deletedRows = [];
          for (const item of matched) {
            store.delete(item.id);
            deletedRows.push(item);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(deletedRows));
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

test('B-2: All history-cloud functions strictly include user_id=eq.<id> query and enforce tenant isolation', async () => {
  const mock = createMockSupabaseServer();
  const mockUrl = await mock.listen();

  process.env.SUPABASE_URL = mockUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-b2';
  process.env.IS_CLOUD = 'true';
  process.env.HISTORY_MAX_PER_USER = '5';

  const cloud = require('../server/history-cloud');

  const userId = '11111111-1111-4111-8111-111111111111';
  const reportId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  try {
    // 1. save
    mock.requestLog.length = 0;
    await cloud.save({
      id: reportId,
      userId,
      theme: 'クラウド分離テーマ',
      title: 'クラウド分離レポート',
      summary: 'テスト概要',
    });

    // save 内部の prune 照会および POST の確認
    const savePruneReq = mock.requestLog.find(
      (r) => r.method === 'GET' && r.url.includes('/rest/v1/user_reports')
    );
    assert.ok(savePruneReq, 'save must query user reports for pruning');
    assert.match(savePruneReq.url, /user_id=eq\./, 'Prune query must contain user_id=eq.');
    assert.strictEqual(savePruneReq.searchParams.user_id, `eq.${userId}`);

    const saveInsertReq = mock.requestLog.find(
      (r) => r.method === 'POST' && r.url.includes('/rest/v1/user_reports')
    );
    assert.ok(saveInsertReq, 'save must POST report');
    assert.strictEqual(saveInsertReq.body.user_id, userId, 'Payload user_id must match');

    // 2. list
    mock.requestLog.length = 0;
    const items = await cloud.list(userId);
    assert.strictEqual(items.length, 1);
    const listReq = mock.requestLog.find(
      (r) => r.method === 'GET' && r.url.includes('/rest/v1/user_reports')
    );
    assert.ok(listReq, 'list must issue GET request');
    assert.strictEqual(listReq.searchParams.user_id, `eq.${userId}`, 'list must filter by user_id=eq.');

    // 3. get
    mock.requestLog.length = 0;
    const single = await cloud.get(reportId, userId);
    assert.ok(single);
    assert.strictEqual(single.id, reportId);
    const getReq = mock.requestLog.find((r) => r.method === 'GET');
    assert.ok(getReq, 'get must issue GET request');
    assert.strictEqual(getReq.searchParams.user_id, `eq.${userId}`, 'get must filter by user_id=eq.');
    assert.strictEqual(getReq.searchParams.id, `eq.${reportId}`, 'get must filter by id=eq.');

    // 他人の user_id で get を試行した場合
    const foreignUser = '22222222-2222-4222-8222-222222222222';
    const forbidden = await cloud.get(reportId, foreignUser);
    assert.strictEqual(forbidden, null, 'Must not return report belonging to other user');

    // 4. togglePin & update
    mock.requestLog.length = 0;
    const pinnedItem = await cloud.togglePin(reportId, userId);
    assert.ok(pinnedItem);
    assert.strictEqual(pinnedItem.pinned, true);
    const patchReq = mock.requestLog.find((r) => r.method === 'PATCH');
    assert.ok(patchReq, 'togglePin must issue PATCH');
    assert.strictEqual(patchReq.searchParams.user_id, `eq.${userId}`, 'PATCH must filter by user_id=eq.');
    assert.strictEqual(patchReq.searchParams.id, `eq.${reportId}`, 'PATCH must filter by id=eq.');

    // 5. getAllForUser
    mock.requestLog.length = 0;
    const allReports = await cloud.getAllForUser(userId);
    assert.strictEqual(allReports.length, 1);
    const getAllReq = mock.requestLog.find((r) => r.method === 'GET');
    assert.ok(getAllReq, 'getAllForUser must issue GET');
    assert.strictEqual(getAllReq.searchParams.user_id, `eq.${userId}`, 'getAllForUser must filter by user_id=eq.');

    // 6. remove
    mock.requestLog.length = 0;
    const removed = await cloud.remove(reportId, userId);
    assert.strictEqual(removed, true);
    const delReq = mock.requestLog.find((r) => r.method === 'DELETE');
    assert.ok(delReq, 'remove must issue DELETE');
    assert.strictEqual(delReq.searchParams.user_id, `eq.${userId}`, 'DELETE must filter by user_id=eq.');
    assert.strictEqual(delReq.searchParams.id, `eq.${reportId}`, 'DELETE must filter by id=eq.');

    // 未認証・null userId 時の安全性
    assert.deepStrictEqual(await cloud.list(null), []);
    assert.strictEqual(await cloud.get(reportId, null), null);
    assert.strictEqual(await cloud.remove(reportId, null), false);
    assert.strictEqual(await cloud.update(reportId, {}, null), null);
    assert.strictEqual(await cloud.togglePin(reportId, null), null);
    assert.deepStrictEqual(await cloud.getAllForUser(null), []);
  } finally {
    await mock.close();
  }
});

test('B-2: User A saving max+1 reports prunes only User A reports, leaving User B reports unaffected', async () => {
  const mock = createMockSupabaseServer();
  const mockUrl = await mock.listen();

  process.env.SUPABASE_URL = mockUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-b2';
  process.env.IS_CLOUD = 'true';
  process.env.HISTORY_MAX_PER_USER = '3'; // 上限を3件に設定

  const cloud = require('../server/history-cloud');

  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

  try {
    // 利用者Bが2件保存
    await cloud.save({
      id: 'bbbbbb01-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      userId: userB,
      theme: 'ユーザーB レポート1',
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    await cloud.save({
      id: 'bbbbbb02-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      userId: userB,
      theme: 'ユーザーB レポート2',
      createdAt: '2026-11-02T00:00:00.000Z',
    });

    const bListBefore = await cloud.list(userB);
    assert.strictEqual(bListBefore.length, 2, 'User B must have 2 reports');

    // 利用者Aが上限(3件)+1件 = 4件保存
    await cloud.save({
      id: 'aaaaaa01-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: userA,
      theme: 'ユーザーA レポート1 (最古)',
      createdAt: '2026-11-01T01:00:00.000Z',
    });
    await cloud.save({
      id: 'aaaaaa02-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: userA,
      theme: 'ユーザーA レポート2',
      createdAt: '2026-11-01T02:00:00.000Z',
    });
    await cloud.save({
      id: 'aaaaaa03-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: userA,
      theme: 'ユーザーA レポート3',
      createdAt: '2026-11-01T03:00:00.000Z',
    });

    // ここで利用者Aは3件
    const aListAtLimit = await cloud.list(userA);
    assert.strictEqual(aListAtLimit.length, 3, 'User A should reach 3 reports');

    // 4件目を保存 (上限+1件)
    await cloud.save({
      id: 'aaaaaa04-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: userA,
      theme: 'ユーザーA レポート4 (最新)',
      createdAt: '2026-11-01T04:00:00.000Z',
    });

    // 利用者Aの件数は上限の3件に保たれ、最古の1件（aaaaaa01）が削除されていること
    const aListAfter = await cloud.list(userA);
    assert.strictEqual(aListAfter.length, 3, 'User A must still have max 3 reports');
    const aIds = aListAfter.map((r) => r.id);
    assert.ok(!aIds.includes('aaaaaa01-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'Oldest report of User A must be pruned');
    assert.ok(aIds.includes('aaaaaa04-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'Newest report of User A must be present');

    // 最重要検証: 利用者Bの件数およびデータが一切変わっていないこと
    const bListAfter = await cloud.list(userB);
    assert.strictEqual(bListAfter.length, 2, 'User B must still have exactly 2 reports unaffected');
    const bIds = bListAfter.map((r) => r.id);
    assert.ok(bIds.includes('bbbbbb01-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    assert.ok(bIds.includes('bbbbbb02-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
  } finally {
    await mock.close();
  }
});

test('B-2: HISTORY_RETENTION_DAYS excludes expired reports and deletes them', async () => {
  const mock = createMockSupabaseServer();
  const mockUrl = await mock.listen();

  process.env.SUPABASE_URL = mockUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key-b2';
  process.env.IS_CLOUD = 'true';
  process.env.HISTORY_MAX_PER_USER = '100';
  process.env.HISTORY_RETENTION_DAYS = '7'; // 7日間の保持期間

  const cloud = require('../server/history-cloud');
  const userId = '33333333-3333-4333-8333-333333333333';

  try {
    const now = Date.now();
    const tenDaysAgoIso = new Date(now - 10 * 86400000).toISOString();
    const twoDaysAgoIso = new Date(now - 2 * 86400000).toISOString();

    // 10日前の古いレポート
    await cloud.save({
      id: 'cccc0001-cccc-4ccc-8ccc-cccccccccccc',
      userId,
      theme: '10日前のレポート（期限切れ）',
      createdAt: tenDaysAgoIso,
    });

    // 2日前の有効レポート
    await cloud.save({
      id: 'cccc0002-cccc-4ccc-8ccc-cccccccccccc',
      userId,
      theme: '2日前のレポート（有効）',
      createdAt: twoDaysAgoIso,
    });

    const activeList = await cloud.list(userId);
    assert.strictEqual(activeList.length, 1, 'Only non-expired report must be returned');
    assert.strictEqual(activeList[0].id, 'cccc0002-cccc-4ccc-8ccc-cccccccccccc');
  } finally {
    await mock.close();
  }
});

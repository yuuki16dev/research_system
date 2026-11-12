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

test('B-9: Job ownership, subscription token verification, cancel authorization, and concurrency limits', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-jobs.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b9',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      MAX_CONCURRENT_JOBS: '2', // テスト用に同時実行数上限を2に設定
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
  const tokenA = 'Bearer test-token-user-a';
  const tokenB = 'Bearer test-token-user-b';

  try {
    // 1. 利用者Aがジョブを開始（forceMock: true）
    const resA1 = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenA,
      },
      body: JSON.stringify({
        theme: '利用者Aのジョブ1',
        scope: 'web',
        depth: 'quick',
        purpose: 'general',
        forceMock: true,
      }),
    });

    assert.strictEqual(resA1.status, 202);
    const dataA1 = await resA1.json();
    assert.ok(dataA1.jobId, 'jobId must be returned');
    assert.ok(dataA1.token, 'token must be returned');
    const jobIdA = dataA1.jobId;
    const subTokenA = dataA1.token;

    // 2. 利用者Bが利用者Aのジョブの events をトークンなし・他人のトークンで購読試行 -> 404
    // 2-a. トークンなし、未認証 -> 404
    const resEventsNoAuth = await fetch(`${baseUrl}/api/research/${jobIdA}/events`);
    assert.strictEqual(resEventsNoAuth.status, 404, 'Events without token or owner auth should return 404');

    // 2-b. 利用者Bの認証ヘッダーのみ（トークンなし） -> 404
    const resEventsUserB = await fetch(`${baseUrl}/api/research/${jobIdA}/events`, {
      headers: { Authorization: tokenB },
    });
    assert.strictEqual(resEventsUserB.status, 404, 'Events with other user auth should return 404');

    // 2-c. 不正なトークンクエリ -> 404
    const resEventsBadToken = await fetch(`${baseUrl}/api/research/${jobIdA}/events?token=invalid-secret-token`);
    assert.strictEqual(resEventsBadToken.status, 404, 'Events with invalid token should return 404');

    // 2-d. 正しい購読トークン付き -> 200 (SSE stream開始)
    const controller1 = new AbortController();
    const resEventsOkToken = await fetch(`${baseUrl}/api/research/${jobIdA}/events?token=${encodeURIComponent(subTokenA)}`, {
      signal: controller1.signal,
    });
    assert.strictEqual(resEventsOkToken.status, 200, 'Events with valid token should return 200');
    assert.ok(resEventsOkToken.headers.get('content-type').includes('text/event-stream'));
    controller1.abort();

    // 2-e. 利用者A自身の認証ヘッダー付き（トークンクエリなし） -> 200
    const controller2 = new AbortController();
    const resEventsOkUserA = await fetch(`${baseUrl}/api/research/${jobIdA}/events`, {
      headers: { Authorization: tokenA },
      signal: controller2.signal,
    });
    assert.strictEqual(resEventsOkUserA.status, 200, 'Events with owner auth should return 200');
    controller2.abort();

    // 3. 同じ利用者Aが実行中に2件目のジョブを開始しようとする -> 429 (JOB_ALREADY_RUNNING)
    const resA2 = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenA,
      },
      body: JSON.stringify({
        theme: '利用者Aのジョブ2（多重実行試行）',
        scope: 'web',
        depth: 'quick',
        purpose: 'general',
        forceMock: true,
      }),
    });
    assert.strictEqual(resA2.status, 429, 'Second concurrent job for same user should return 429');
    const dataA2 = await resA2.json();
    assert.strictEqual(dataA2.code, 'JOB_ALREADY_RUNNING');

    // 4. 利用者Bが利用者Aのジョブを cancel しようとする -> 404
    const resCancelB = await fetch(`${baseUrl}/api/research/${jobIdA}/cancel`, {
      method: 'POST',
      headers: { Authorization: tokenB },
    });
    assert.strictEqual(resCancelB.status, 404, 'Cancel other user job should return 404');

    // 5. 別の利用者Bがジョブを開始（MAX_CONCURRENT_JOBS = 2 の2件目） -> 202
    const resB1 = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenB,
      },
      body: JSON.stringify({
        theme: '利用者Bのジョブ1',
        scope: 'web',
        depth: 'quick',
        purpose: 'general',
        forceMock: true,
      }),
    });
    assert.strictEqual(resB1.status, 202, 'Different user should succeed under limit');
    const dataB1 = await resB1.json();
    const jobIdB = dataB1.jobId;

    // 6. サーバー全体で2件実行中（上限到達）の状態で、3人目のユーザー（admin）が開始しようとする -> 503 (SERVER_BUSY)
    const tokenAdmin = 'Bearer test-token-admin-user';
    const resC1 = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenAdmin,
      },
      body: JSON.stringify({
        theme: '利用者Cのジョブ（サーバー混雑時）',
        scope: 'web',
        depth: 'quick',
        purpose: 'general',
        forceMock: true,
      }),
    });
    assert.strictEqual(resC1.status, 503, 'Server full capacity should return 503');
    const dataC1 = await resC1.json();
    assert.strictEqual(dataC1.code, 'SERVER_BUSY');

    // 7. 利用者Aが自分のジョブを cancel -> 200
    const resCancelA = await fetch(`${baseUrl}/api/research/${jobIdA}/cancel`, {
      method: 'POST',
      headers: { Authorization: tokenA },
    });
    assert.strictEqual(resCancelA.status, 200, 'Owner canceling job should return 200');
    const cancelDataA = await resCancelA.json();
    assert.strictEqual(cancelDataA.ok, true);

    // 8. キャンセル後、利用者Aは新しいジョブを開始できる -> 202
    const resA3 = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenA,
      },
      body: JSON.stringify({
        theme: '利用者Aのジョブ再試行',
        scope: 'web',
        depth: 'quick',
        purpose: 'general',
        forceMock: true,
      }),
    });
    assert.strictEqual(resA3.status, 202, 'Owner can start new job after canceling previous job');
    const dataA3 = await resA3.json();

    // クリーンアップ: 実行中ジョブのキャンセル
    await fetch(`${baseUrl}/api/research/${jobIdB}/cancel`, {
      method: 'POST',
      headers: { Authorization: tokenB },
    }).catch(() => {});
    await fetch(`${baseUrl}/api/research/${dataA3.jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: tokenA },
    }).catch(() => {});
  } finally {
    serverProcess.kill('SIGTERM');
  }
});


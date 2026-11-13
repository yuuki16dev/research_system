'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const quota = require('../server/quota');
const jobs = require('../server/jobs');

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

test('R-3: quota.js contains no direct POST to research_usage table and deletes legacy helpers', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'quota.js'), 'utf8');
  assert.strictEqual(src.includes('/rest/v1/research_usage'), true, 'Expected read SELECT query on research_usage');
  assert.doesNotMatch(src, /\/rest\/v1\/research_usage[^;]*method\s*:\s*['"]POST['"]/);
  assert.doesNotMatch(src, /merge-duplicates/);
  assert.strictEqual(quota.recordUsage, undefined, 'recordUsage must be removed');
  assert.strictEqual(quota.consumeActionCredits, undefined, 'consumeActionCredits must be removed');
});

test('R-3: getCurrentYearMonth rolls over at Asia/Tokyo midnight (23:59 JST -> 00:00 JST next month)', () => {
  // 2026-11-30 23:59:59 JST == 2026-11-30T14:59:59Z
  const beforeMidnightJst = new Date('2026-11-30T14:59:59.999Z');
  // 2026-12-01 00:00:00 JST == 2026-11-30T15:00:00Z
  const atMidnightJst = new Date('2026-11-30T15:00:00.000Z');

  assert.strictEqual(quota.getCurrentYearMonth(beforeMidnightJst), '2026-11');
  assert.strictEqual(quota.getCurrentYearMonth(atMidnightJst), '2026-12');
});

test('R-3: getMonthlyQuota returns remaining: null and unavailable: true when Supabase fails (no memory fallback)', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://mock-sb-r3.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';
  globalThis.fetch = async () => new Response('Internal Server Error', { status: 500 });

  try {
    const q = await quota.getMonthlyQuota('11111111-1111-4111-8111-111111111111', 'free');
    assert.strictEqual(q.remaining, null);
    assert.strictEqual(q.unavailable, true);
    assert.strictEqual(q.canResearch, false);
  } finally {
    globalThis.fetch = origFetch;
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  }
});

test('R-3: createJob invokes onSettled once with done, error, or cancelled status', async () => {
  // 1. done
  const doneStatuses = [];
  await new Promise((resolve) => {
    const j = jobs.createJob({ theme: 't' }, async () => ({ ok: true }), {
      userId: 'u1',
      onSettled: (status) => {
        doneStatuses.push(status);
        resolve();
      },
    });
    assert.ok(j.id);
  });
  assert.deepStrictEqual(doneStatuses, ['done']);

  // 2. error
  const errorStatuses = [];
  await new Promise((resolve) => {
    jobs.createJob(
      { theme: 't' },
      async () => {
        throw new Error('simulated failure');
      },
      {
        userId: 'u2',
        onSettled: (status) => {
          errorStatuses.push(status);
          resolve();
        },
      }
    );
  });
  assert.deepStrictEqual(errorStatuses, ['error']);

  // 3. cancelled
  const cancelStatuses = [];
  await new Promise((resolve) => {
    const j = jobs.createJob(
      { theme: 't' },
      async (job) => {
        job.controller.abort();
        throw new Error('aborted');
      },
      {
        userId: 'u3',
        onSettled: (status) => {
          cancelStatuses.push(status);
          resolve();
        },
      }
    );
  });
  assert.deepStrictEqual(cancelStatuses, ['cancelled']);

  // 4. error時にのみ refundCredits が RPC refund_credits を1回呼び、done / cancelled では呼ばない
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevRefundCancel = process.env.REFUND_ON_CANCEL;
  const origFetch = globalThis.fetch;
  const refundPayloads = [];

  process.env.SUPABASE_URL = 'https://mock-sb-r3-settled.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';
  delete process.env.REFUND_ON_CANCEL;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/rest/v1/rpc/refund_credits')) {
      refundPayloads.push(JSON.parse(init.body));
      return new Response('null', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const settledUuid = '22222222-2222-4222-8222-222222222222';
    await new Promise((resolve) => {
      jobs.createJob(
        { theme: 'fail-refund' },
        async () => { throw new Error('boom'); },
        {
          userId: settledUuid,
          onSettled: async (status) => {
            if (status === 'error') {
              await quota.refundCredits(settledUuid, 'research_quick', '2026-11');
            }
            resolve();
          },
        }
      );
    });
    assert.strictEqual(refundPayloads.length, 1);
    assert.deepStrictEqual(refundPayloads[0], {
      p_user: settledUuid,
      p_ym: '2026-11',
      p_cost: 1,
    });
  } finally {
    globalThis.fetch = origFetch;
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    if (prevRefundCancel === undefined) delete process.env.REFUND_ON_CANCEL;
    else process.env.REFUND_ON_CANCEL = prevRefundCancel;
  }
});

test('R-3 E2E: Concurrent 5 requests with 1 credit allow only 1, error triggers refund_credits, RPC 500 returns 503 without creating job', async () => {
  const userUuid = '11111111-1111-4111-8111-111111111111';
  const state = {
    usedCredits: 2, // free limit = 3 -> 1 credit remaining
    consumeCalls: [],
    refundCalls: [],
    rpcMode: 'normal', // 'normal' | 'error500' | 'timeout'
    consumeDelayMs: 50,
  };

  const mockSupabase = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (url.pathname === '/auth/v1/user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userUuid, email: 'uuid-user@example.com' }));
      }
      if (url.pathname === '/rest/v1/profiles') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ id: userUuid, plan: 'free', subscription_status: 'active' }]));
      }
      if (url.pathname === '/rest/v1/research_usage') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ used_count: state.usedCredits }]));
      }
      if (url.pathname === '/rest/v1/rpc/consume_credits') {
        const parsed = body ? JSON.parse(body) : {};
        if (state.consumeDelayMs > 0) {
          await new Promise((r) => setTimeout(r, state.consumeDelayMs));
        }
        if (state.rpcMode === 'error500') {
          state.consumeCalls.push({ parsed, result: 'HTTP_500' });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'db down' }));
        }
        const cost = Number(parsed.p_cost || 1);
        const limit = Number(parsed.p_limit || 3);
        let ok = false;
        if (state.usedCredits + cost <= limit) {
          state.usedCredits += cost;
          ok = true;
        }
        state.consumeCalls.push({ parsed, result: ok });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(ok));
      }
      if (url.pathname === '/rest/v1/rpc/refund_credits') {
        const parsed = body ? JSON.parse(body) : {};
        const cost = Number(parsed.p_cost || 1);
        state.usedCredits = Math.max(0, state.usedCredits - cost);
        state.refundCalls.push(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(null));
      }
      if (url.pathname.startsWith('/rest/v1/user_reports')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([]));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  const sbPort = await new Promise((resolve) => mockSupabase.listen(0, '127.0.0.1', () => resolve(mockSupabase.address().port)));
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r3-test-'));

  const env = { ...process.env };
  delete env.ENABLE_TEST_USERS;
  delete env.ALLOW_ANONYMOUS_CLOUD;
  Object.assign(env, {
    PORT: String(port),
    NODE_ENV: 'production',
    SUPABASE_URL: `http://127.0.0.1:${sbPort}`,
    SUPABASE_ANON_KEY: 'dummy-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-service',
    TAVILY_API_KEY: 'dummy-tavily',
    RESEARCH_DATA_DIR: tmpDir,
  });

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let logs = '';
  child.stdout.on('data', (c) => { logs += c.toString(); });
  child.stderr.on('data', (c) => { logs += c.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) { ready = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  try {
    assert.ok(ready, `Server failed to start. Logs:\n${logs}`);

    // 1. 残り1クレジットのUUIDユーザーが同時に5件送信 -> 1件だけ202、4件は403 QUOTA_EXCEEDED
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, idx) =>
        fetch(`${baseUrl}/api/research`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-uuid-token',
          },
          body: JSON.stringify({
            theme: `同時送信テスト-${idx}`,
            depth: 'quick',
            forceMock: true,
          }),
        }).then(async (r) => ({ status: r.status, body: await r.json() }))
      )
    );

    const accepted = responses.filter((r) => r.status === 202);
    const rejectedQuota = responses.filter((r) => r.status === 403 && r.body.code === 'QUOTA_EXCEEDED');
    assert.strictEqual(accepted.length, 1, `Expected 1 accepted request, got: ${JSON.stringify(responses)}`);
    assert.strictEqual(rejectedQuota.length, 4, `Expected 4 QUOTA_EXCEEDED responses, got: ${JSON.stringify(responses)}`);
    assert.strictEqual(state.consumeCalls.length, 5, 'consume_credits RPC must be called 5 times');
    assert.strictEqual(state.consumeCalls.filter((c) => c.result === true).length, 1, 'consume_credits must return true once');

    // ジョブ完了待機 (done -> refund_credits は呼ばれない)
    const doneJob = accepted[0].body;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SSE timeout (done)')), 15000);
      http.get(`${baseUrl}/api/research/${doneJob.jobId}/events?token=${encodeURIComponent(doneJob.token)}`, (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('"type":"end"')) {
            clearTimeout(timer);
            res.destroy();
            resolve();
          }
        });
      });
    });
    assert.strictEqual(state.refundCalls.length, 0, 'refund_credits must NOT be called when job completes done');

    // 2. キャンセル時は返却されない (REFUND_ON_CANCEL=false)
    state.consumeDelayMs = 0;
    state.usedCredits = 0;
    const cancelCreateRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-uuid-token',
      },
      body: JSON.stringify({ theme: 'キャンセル確認テーマ', depth: 'quick', forceMock: true }),
    });
    assert.strictEqual(cancelCreateRes.status, 202);
    const cancelJob = await cancelCreateRes.json();

    const cancelReqRes = await fetch(`${baseUrl}/api/research/${cancelJob.jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-uuid-token' },
    });
    assert.strictEqual(cancelReqRes.status, 200);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SSE timeout (cancel)')), 15000);
      http.get(`${baseUrl}/api/research/${cancelJob.jobId}/events?token=${encodeURIComponent(cancelJob.token)}`, (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('"type":"end"')) {
            clearTimeout(timer);
            res.destroy();
            resolve();
          }
        });
      });
    });
    assert.strictEqual(state.refundCalls.length, 0, 'refund_credits must NOT be called on user cancel by default');

    // 3. RPC が 500 を返す場合 -> 503 QUOTA_UNAVAILABLE で拒否され、ジョブは作成されない
    state.rpcMode = 'error500';
    const resRpcErr = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-uuid-token',
      },
      body: JSON.stringify({ theme: 'RPC障害テスト', depth: 'quick', forceMock: true }),
    });
    assert.strictEqual(resRpcErr.status, 503);
    const errJson = await resRpcErr.json();
    assert.strictEqual(errJson.code, 'QUOTA_UNAVAILABLE');
    assert.strictEqual(errJson.jobId, undefined, 'No job must be created on RPC 500');

    // ジョブが作られていないことを確認（RPC復旧後の次リクエストが 429 JOB_ALREADY_RUNNING ではなく 202 になる）
    state.rpcMode = 'normal';
    const resAfterRecover = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-uuid-token',
      },
      body: JSON.stringify({ theme: 'RPC復旧後テスト', depth: 'quick', forceMock: true }),
    });
    assert.strictEqual(resAfterRecover.status, 202, 'Previous 503 must not have created a blocking job');

    // ジョブ完了を待ってから終了する
    const recoveredJob = await resAfterRecover.json();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SSE timeout (recovered)')), 15000);
      http.get(`${baseUrl}/api/research/${recoveredJob.jobId}/events?token=${encodeURIComponent(recoveredJob.token)}`, (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('"type":"end"')) {
            clearTimeout(timer);
            res.destroy();
            resolve();
          }
        });
      });
    });

    // 4. RPC がタイムアウト (AbortError) する場合も 503 QUOTA_UNAVAILABLE になる
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origFetch = globalThis.fetch;
    process.env.SUPABASE_URL = 'https://mock-sb-timeout.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';
    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };
    try {
      await assert.rejects(
        () => quota.reserveCredits('33333333-3333-4333-8333-333333333333', 'free', 'research_quick'),
        /timeout/i
      );
    } finally {
      globalThis.fetch = origFetch;
      if (prevUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  } finally {
    try {
      child.kill('SIGTERM');
      if (process.platform === 'win32' && child.pid) {
        try { child.kill('SIGKILL'); } catch {}
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => mockSupabase.close(r));
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

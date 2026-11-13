'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const usageEvents = require('../server/usage-events');

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

test('R-5: getTodayCostJpy caches for 60s, warns once at >=80%, falls back on cache, and throws without cache', async () => {
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevLimit = process.env.DAILY_COST_LIMIT_JPY;
  const origFetch = globalThis.fetch;
  const origWarn = console.warn;

  usageEvents._clearDailyCostCacheForTest();
  process.env.SUPABASE_URL = 'https://mock-sb-r5.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';
  process.env.DAILY_COST_LIMIT_JPY = '1000';

  let rpcCalls = 0;
  let nextMode = 'fail';
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/rest/v1/rpc/usage_cost_since')) {
      rpcCalls++;
      const body = JSON.parse(init.body || '{}');
      assert.strictEqual(body.p_since, usageEvents.getJstDayStartIso());
      if (nextMode === 'fail') return new Response('db err', { status: 500 });
      if (nextMode === '850') return new Response('850', { status: 200 });
      return new Response('0', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    // 1. キャッシュなしで RPC 失敗 -> 例外（呼び出し側で 503）
    await assert.rejects(() => usageEvents.getTodayCostJpy(), /usage_cost_since/);
    assert.strictEqual(rpcCalls, 1);

    // 2. 850 JPY (>= 80% of 1000) を取得 -> 警告ログが1回だけ出る & キャッシュされる
    nextMode = '850';
    const cost1 = await usageEvents.getTodayCostJpy();
    assert.strictEqual(cost1, 850);
    assert.strictEqual(rpcCalls, 2);

    // 60秒キャッシュ内 -> RPC 再実行されない・警告も増えない
    const cost2 = await usageEvents.getTodayCostJpy();
    assert.strictEqual(cost2, 850);
    assert.strictEqual(rpcCalls, 2);
    const eightyPctWarns = warnings.filter((w) => w.includes('80%'));
    assert.strictEqual(eightyPctWarns.length, 1, '80% warning must fire only once per day');

    // 3. 新規原価記録後（キャッシュ鮮度失効）に RPC が失敗しても直近キャッシュ値を返す
    await usageEvents.recordUsageEvent({
      userId: '11111111-1111-4111-8111-111111111111',
      kind: 'research_quick',
      tavilyCredits: 1,
      status: 'done',
    });
    nextMode = 'fail';
    const costFallback = await usageEvents.getTodayCostJpy();
    assert.ok(costFallback >= 850, 'Fallback must return latest cached cost when RPC fails');
    assert.strictEqual(rpcCalls, 3);
  } finally {
    console.warn = origWarn;
    globalThis.fetch = origFetch;
    usageEvents._clearDailyCostCacheForTest();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    if (prevLimit === undefined) delete process.env.DAILY_COST_LIMIT_JPY;
    else process.env.DAILY_COST_LIMIT_JPY = prevLimit;
  }
});

test('R-5 E2E: DAILY_COST_LIMIT_JPY=1 blocks all AI routes with 503 BEFORE consuming credits', async () => {
  const userUuid = '11111111-1111-4111-8111-111111111111';
  let currentCostJpy = 0;
  let consumeCreditsCount = 0;

  const mockSupabase = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (url.pathname === '/auth/v1/user') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userUuid, email: 'r5@example.com' }));
      }
      if (url.pathname === '/rest/v1/profiles') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ id: userUuid, plan: 'standard', subscription_status: 'active' }]));
      }
      if (url.pathname === '/rest/v1/rpc/usage_cost_since') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(String(currentCostJpy));
      }
      if (url.pathname === '/rest/v1/rpc/consume_credits') {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch {}
        if (parsed.p_user === '00000000-0000-0000-0000-000000000000' || Number(parsed.p_cost) === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end('true');
        }
        consumeCreditsCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('true');
      }
      if (url.pathname === '/rest/v1/rpc/refund_credits') {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/rest/v1/research_usage' || url.pathname === '/rest/v1/user_reports') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('[]');
      }
      if (url.pathname === '/rest/v1/usage_events') {
        res.writeHead(req.method === 'GET' ? 200 : 201, { 'Content-Type': 'application/json' });
        return res.end('[]');
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  const sbPort = await new Promise((resolve) => mockSupabase.listen(0, '127.0.0.1', () => resolve(mockSupabase.address().port)));
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r5-e2e-'));

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
    DAILY_COST_LIMIT_JPY: '1',
    RESEARCH_DATA_DIR: tmpDir,
  });

  let logs = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
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

    // 原価が1円を超過した状態にする
    currentCostJpy = 1.25;

    const aiRoutes = [
      { path: '/api/research', body: { theme: 'R5 test', depth: 'quick', forceMock: true } },
      { path: '/api/research/cross-synthesis', body: { reportIds: ['1', '2'] } },
      { path: '/api/research/delta', body: { baseReportId: '1' } },
      { path: '/api/research/deep-dive', body: { reportId: '11111111-1111-4111-8111-111111111111', theme: 't', question: 'q' } },
      { path: '/api/presentation/generate', body: { document: 'doc' } },
    ];

    for (const route of aiRoutes) {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-token',
        },
        body: JSON.stringify(route.body),
      });
      assert.strictEqual(res.status, 503, `Expected 503 for ${route.path} when daily cost >= 1 JPY`);
      const json = await res.json();
      assert.strictEqual(json.code, 'DAILY_LIMIT_REACHED');
      assert.strictEqual(json.error, '本日の受付上限に達しました。明日以降に再度お試しください');
    }

    assert.strictEqual(consumeCreditsCount, 0, 'Credits must NOT be consumed when blocked by daily cost limit');
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


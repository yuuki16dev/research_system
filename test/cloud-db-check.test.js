'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dbCheck = require('../server/db-check');

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

async function startCustomMockDb(handler) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, url, body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      }),
  };
}

function respondHealthyTablesAndRpcs(req, res, url, opts = {}) {
  const missingRpcs = new Set(opts.missingRpcs || []);
  const missingTables = new Set(opts.missingTables || []);

  if (req.method === 'GET' && url.pathname.startsWith('/rest/v1/')) {
    const tableName = url.pathname.slice('/rest/v1/'.length);
    if (missingTables.has(tableName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 'PGRST204', message: `Column missing in ${tableName}` }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('[]');
  }

  if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
    const rpcName = url.pathname.slice('/rest/v1/rpc/'.length);
    if (missingRpcs.has(rpcName)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 'PGRST202', message: `Could not find function public.${rpcName}` }));
    }
    if (rpcName === 'refund_credits') {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(rpcName === 'usage_cost_since' ? '0' : 'true');
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{}');
}

test('R-7 unit: verifyDatabaseSchema passes when all tables, columns, and RPCs exist', async () => {
  const seen = [];
  const mockDb = await startCustomMockDb((req, res, url) => {
    seen.push(`${req.method} ${url.pathname}${url.search}`);
    respondHealthyTablesAndRpcs(req, res, url);
  });

  try {
    const result = await dbCheck.verifyDatabaseSchema({
      force: true,
      supabaseUrl: mockDb.url,
      serviceRoleKey: 'service-role-secret',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.checkedTables, ['profiles', 'research_usage', 'user_reports', 'usage_events']);
    assert.deepEqual(result.checkedRpcs, ['consume_credits', 'refund_credits', 'usage_cost_since']);
    assert.ok(seen.some((s) => s.includes('/rest/v1/profiles?select=id,plan,subscription_status&limit=0')));
    assert.ok(seen.some((s) => s.includes('/rest/v1/user_reports?select=id,user_id,report_json,pinned,updated_at,share_token,share_enabled&limit=0')));
  } finally {
    await mockDb.close();
  }
});

test('R-7 unit: verifyDatabaseSchema enumerates all missing RPCs and missing table columns', async () => {
  const mockDb = await startCustomMockDb((req, res, url) => {
    respondHealthyTablesAndRpcs(req, res, url, {
      missingTables: ['usage_events'],
      missingRpcs: ['consume_credits', 'usage_cost_since'],
    });
  });

  try {
    await assert.rejects(
      () =>
        dbCheck.verifyDatabaseSchema({
          force: true,
          supabaseUrl: mockDb.url,
          serviceRoleKey: 'service-role-secret',
        }),
      (err) => {
        assert.match(err.message, /usage_events/);
        assert.match(err.message, /consume_credits/);
        assert.match(err.message, /usage_cost_since/);
        assert.equal(err.failures.length, 3);
        return true;
      }
    );
  } finally {
    await mockDb.close();
  }
});

test('R-7 E2E: Server startup exits with code 1 and logs [FATAL] with missing RPC names when DB functions are missing', async () => {
  const mockDb = await startCustomMockDb((req, res, url) => {
    // 4テーブルと refund_credits のみ存在し、consume_credits と usage_cost_since が未作成の DB を模倣
    respondHealthyTablesAndRpcs(req, res, url, {
      missingRpcs: ['consume_credits', 'usage_cost_since'],
    });
  });
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r7-missing-'));

  try {
    const env = { ...process.env };
    delete env.ENABLE_TEST_USERS;
    Object.assign(env, {
      PORT: String(port),
      NODE_ENV: 'production',
      SUPABASE_URL: mockDb.url,
      SUPABASE_ANON_KEY: 'dummy-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role',
      TAVILY_API_KEY: 'dummy-tavily',
      RESEARCH_DATA_DIR: tmpDir,
    });

    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`Server did not exit on missing DB functions. stdout=${stdout} stderr=${stderr}`));
      }, 15000);
      child.stdout.on('data', (c) => { stdout += c.toString(); });
      child.stderr.on('data', (c) => { stderr += c.toString(); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });

    assert.equal(result.code, 1, `Expected exit code 1, got ${result.code}. stderr=${result.stderr}`);
    assert.match(result.stderr, /\[FATAL\]/, 'stderr must contain [FATAL]');
    assert.match(result.stderr, /consume_credits/, 'stderr must list missing consume_credits');
    assert.match(result.stderr, /usage_cost_since/, 'stderr must list missing usage_cost_since');
  } finally {
    await mockDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('R-7 E2E: Server startup exits with code 1 and logs [FATAL] when Supabase is unreachable', async () => {
  const closedPort = await getFreePort();
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r7-unreach-'));

  try {
    const env = { ...process.env };
    Object.assign(env, {
      PORT: String(port),
      NODE_ENV: 'production',
      SUPABASE_URL: `http://127.0.0.1:${closedPort}`,
      SUPABASE_ANON_KEY: 'dummy-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role',
      TAVILY_API_KEY: 'dummy-tavily',
      RESEARCH_DATA_DIR: tmpDir,
    });

    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        reject(new Error(`Server did not exit when Supabase unreachable. stderr=${stderr}`));
      }, 15000);
      child.stderr.on('data', (c) => { stderr += c.toString(); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });

    assert.equal(result.code, 1, `Expected exit code 1, got ${result.code}. stderr=${result.stderr}`);
    assert.match(result.stderr, /\[FATAL\]/, 'stderr must contain [FATAL]');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('R-7 unit: env.normalizeSupabaseUrl cleans whitespace, quotes, trailing slashes, and /rest/v1 suffix', () => {
  const envModule = require('../server/env');
  assert.equal(
    envModule.normalizeSupabaseUrl('  "https://kqbuzfyjzfiyltzecivg.supabase.co/rest/v1/"  '),
    'https://kqbuzfyjzfiyltzecivg.supabase.co'
  );
  assert.equal(
    envModule.normalizeSupabaseUrl("'https://example.supabase.co///'"),
    'https://example.supabase.co'
  );
  assert.equal(envModule.normalizeEnvValue('  "secret_key_123"  '), 'secret_key_123');
});

test('R-7 unit: verifyDatabaseSchema rejects malformed SUPABASE_URL clearly', async () => {
  await assert.rejects(
    () =>
      dbCheck.verifyDatabaseSchema({
        force: true,
        supabaseUrl: 'not-a-valid-url',
        serviceRoleKey: 'service-role-secret',
        retryDelaysMs: [],
      }),
    (err) => {
      assert.match(err.message, /SUPABASE_URL の形式が不正です/);
      return true;
    }
  );
});

test('R-7 unit: verifyDatabaseSchema retries transient 503 responses and succeeds when upstream recovers', async () => {
  let profileAttempts = 0;
  const mockDb = await startCustomMockDb((req, res, url) => {
    if (url.pathname === '/rest/v1/profiles') {
      profileAttempts += 1;
      if (profileAttempts < 3) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end('Service Temporarily Unavailable');
      }
    }
    respondHealthyTablesAndRpcs(req, res, url);
  });

  try {
    const result = await dbCheck.verifyDatabaseSchema({
      force: true,
      supabaseUrl: mockDb.url,
      serviceRoleKey: 'service-role-secret',
      retryDelaysMs: [10, 10],
    });
    assert.equal(result.ok, true);
    assert.equal(profileAttempts, 3);
  } finally {
    await mockDb.close();
  }
});

test('R-7 unit: verifyDatabaseSchema stops after connectivity preflight on unreachable host instead of duplicating 7 errors', async () => {
  const closedPort = await getFreePort();
  await assert.rejects(
    () =>
      dbCheck.verifyDatabaseSchema({
        force: true,
        supabaseUrl: `http://127.0.0.1:${closedPort}`,
        serviceRoleKey: 'service-role-secret',
        retryDelaysMs: [],
      }),
    (err) => {
      assert.match(err.message, /Supabase サーバー \(127\.0\.0\.1\) へ接続できません/);
      assert.doesNotMatch(err.message, /usage_events/);
      assert.doesNotMatch(err.message, /consume_credits/);
      assert.equal(err.failures.length, 1);
      return true;
    }
  );
});

test('R-7 unit: buildConnectionFatalError explains DNS ENOTFOUND and Supabase Pause recovery steps', () => {
  const err = dbCheck.buildConnectionFatalError('kqbuzfyjzfiyltzecivg.supabase.co', {
    ok: false,
    kind: 'connection',
    name: 'profiles(id,plan,subscription_status)',
    errorCode: 'ENOTFOUND',
    reason: '接続失敗: getaddrinfo ENOTFOUND kqbuzfyjzfiyltzecivg.supabase.co',
  });
  assert.equal(err.code, 'ENOTFOUND');
  assert.match(err.message, /名前解決（DNS）に失敗しました/);
  assert.match(err.message, /Paused/);
  assert.match(err.message, /Resume project/);
  assert.match(err.message, /SUPABASE_URL/);
});

test('R-7 unit: verifyDatabaseSchema adds service role key hint on 401/403 authentication errors', async () => {
  const mockDb = await startCustomMockDb((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Invalid API key' }));
  });

  try {
    await assert.rejects(
      () =>
        dbCheck.verifyDatabaseSchema({
          force: true,
          supabaseUrl: mockDb.url,
          serviceRoleKey: 'wrong-key',
          retryDelaysMs: [],
        }),
      (err) => {
        assert.match(err.message, /HTTP 401/);
        assert.match(err.message, /SUPABASE_SERVICE_ROLE_KEY/);
        return true;
      }
    );
  } finally {
    await mockDb.close();
  }
});

test('R-7 unit: env.buildSupabaseHeaders omits Bearer header for modern sb_ opaque keys and retains it for JWT keys', () => {
  const envModule = require('../server/env');
  const sbHeaders = envModule.buildSupabaseHeaders('sb_secret_example_123', { 'Content-Type': 'application/json' });
  assert.equal(sbHeaders.apikey, 'sb_secret_example_123');
  assert.equal(sbHeaders.Authorization, undefined);
  assert.equal(sbHeaders['Content-Type'], 'application/json');

  const jwtHeaders = envModule.buildSupabaseHeaders('eyJhbGciOiJIUzI1NiJ9.payload.sig');
  assert.equal(jwtHeaders.apikey, 'eyJhbGciOiJIUzI1NiJ9.payload.sig');
  assert.equal(jwtHeaders.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
});

test('Keep-Alive unit: pingDatabaseKeepAlive queries profiles limit=1, caches within cooldown, and backs off on error', async () => {
  dbCheck._resetKeepAliveStateForTest();
  let calls = 0;
  let shouldFail = false;

  const mockDb = await startCustomMockDb((req, res, url) => {
    calls += 1;
    if (shouldFail) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end('Unavailable');
    }
    assert.equal(req.method, 'GET');
    assert.equal(`${url.pathname}${url.search}`, '/rest/v1/profiles?select=id&limit=1');
    assert.equal(req.headers.apikey, 'sb_secret_keepalive_test');
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });

  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = mockDb.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_keepalive_test';

  try {
    let fakeNow = 1_700_000_000_000;
    const nowFn = () => fakeNow;

    // 1回目: 実クエリが実行される
    const r1 = await dbCheck.pingDatabaseKeepAlive({ now: nowFn, cooldownMs: 60_000 });
    assert.equal(r1.ok, true);
    assert.equal(r1.status, 'ok');
    assert.equal(calls, 1);

    // 2回目 (クールダウン内): DB には問い合わせず cached を返す
    fakeNow += 10_000;
    const r2 = await dbCheck.pingDatabaseKeepAlive({ now: nowFn, cooldownMs: 60_000 });
    assert.equal(r2.ok, true);
    assert.equal(r2.status, 'cached');
    assert.equal(calls, 1);

    // 3回目 (クールダウン経過後、障害発生時): unreachable を返す
    fakeNow += 60_000;
    shouldFail = true;
    const r3 = await dbCheck.pingDatabaseKeepAlive({ now: nowFn, cooldownMs: 60_000, failureBackoffMs: 30_000 });
    assert.equal(r3.ok, false);
    assert.equal(r3.status, 'unreachable');
    assert.equal(calls, 2);

    // 4回目 (失敗バックオフ期間中): 連続リトライを抑止し backoff を返す
    fakeNow += 5_000;
    const r4 = await dbCheck.pingDatabaseKeepAlive({ now: nowFn, cooldownMs: 60_000, failureBackoffMs: 30_000 });
    assert.equal(r4.ok, false);
    assert.equal(r4.status, 'backoff');
    assert.equal(calls, 2);
  } finally {
    dbCheck._resetKeepAliveStateForTest();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    await mockDb.close();
  }
});

test('Keep-Alive unit: triggerBackgroundKeepAlive is disabled in test env unless forced and runs non-blocking when forced', async () => {
  dbCheck._resetKeepAliveStateForTest();
  assert.equal(dbCheck.triggerBackgroundKeepAlive(), false, 'must stay skipped in NODE_ENV=test by default');

  let pinged = 0;
  const mockDb = await startCustomMockDb((req, res) => {
    pinged += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });

  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = mockDb.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_bg_test';

  try {
    const scheduled = dbCheck.triggerBackgroundKeepAlive({ forceRun: true, intervalMs: 60_000 });
    assert.equal(scheduled, true);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(pinged, 1);
    assert.equal(dbCheck.triggerBackgroundKeepAlive({ forceRun: true, intervalMs: 60_000 }), false);
  } finally {
    dbCheck._resetKeepAliveStateForTest();
    if (prevUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    await mockDb.close();
  }
});

test('Keep-Alive E2E: /api/health/db returns 200 ok in cloud mode using startup cache without leaking secrets', async () => {
  const mockDb = await startCustomMockDb((req, res, url) => {
    respondHealthyTablesAndRpcs(req, res, url);
  });
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-keepalive-e2e-'));

  let child;
  try {
    const env = { ...process.env };
    Object.assign(env, {
      PORT: String(port),
      NODE_ENV: 'production',
      SUPABASE_URL: mockDb.url,
      SUPABASE_ANON_KEY: 'sb_publishable_dummy',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_dummy',
      TAVILY_API_KEY: 'dummy-tavily',
      RESEARCH_DATA_DIR: tmpDir,
    });

    child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 10000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready, true, 'Cloud server must start up cleanly with sb_secret_ key');

    const dbRes = await fetch(`${baseUrl}/api/health/db`);
    assert.equal(dbRes.status, 200);
    const data = await dbRes.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.supabase, 'cached');
    assert.ok(data.checkedAt);
    assert.equal(JSON.stringify(data).includes('sb_secret_dummy'), false);
  } finally {
    if (child) {
      try { child.kill('SIGKILL'); } catch {}
    }
    await mockDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


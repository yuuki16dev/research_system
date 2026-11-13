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


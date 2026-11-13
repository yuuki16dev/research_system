'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const planConfig = require('../server/plan-config');

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

test('R-4: plan-config defines DEEPDIVE_LIMIT_PER_REPORT (10) and DEEPDIVE_LIMIT_PER_DAY (50)', () => {
  assert.strictEqual(planConfig.DEEPDIVE_LIMIT_PER_REPORT, 10);
  assert.strictEqual(planConfig.DEEPDIVE_LIMIT_PER_DAY, 50);
});

test('R-4: deep-dive.js sends reportId and shows Japanese limit message on 403', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'deep-dive.js'), 'utf8');
  assert.ok(js.includes('reportId: appState.currentResult.id'), 'deep-dive.js must send reportId');
  assert.ok(js.includes('403') && js.includes('このレポートの深掘り回数の上限に達しました'), 'deep-dive.js must display limit message on 403');
});

test('R-4 E2E: Deep-dive enforces reportId ownership (404), per-report/day limits (403), count error (503), and presentation validates inputs (400)', async () => {
  const userAUuid = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const userBUuid = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const reportAId = '11111111-aaaa-4111-8111-111111111111';
  const reportBId = '22222222-bbbb-4222-8222-222222222222';

  const usageEventsStore = [];
  let failUsageCountQuery = false;

  const mockSupabase = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (url.pathname === '/auth/v1/user') {
        const auth = req.headers.authorization || '';
        const uid = auth.includes('token-b') ? userBUuid : userAUuid;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: uid, email: `${uid}@example.com` }));
      }

      if (url.pathname === '/rest/v1/profiles') {
        const idParam = url.searchParams.get('id') || '';
        const uid = idParam.replace(/^eq\./, '') || userAUuid;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ id: uid, plan: 'standard', subscription_status: 'active' }]));
      }

      if (url.pathname === '/rest/v1/user_reports') {
        const idFilter = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const userFilter = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const rows = [];
        if (idFilter === reportAId && userFilter === userAUuid) {
          rows.push({
            id: reportAId,
            user_id: userAUuid,
            theme: 'User A Theme',
            title: 'User A Report',
            report_json: { id: reportAId, theme: 'User A Theme', title: 'User A Report' },
          });
        } else if (idFilter === reportBId && userFilter === userBUuid) {
          rows.push({
            id: reportBId,
            user_id: userBUuid,
            theme: 'User B Theme',
            title: 'User B Report',
            report_json: { id: reportBId, theme: 'User B Theme', title: 'User B Report' },
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(rows));
      }

      if (url.pathname === '/rest/v1/rpc/usage_cost_since') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('0');
      }

      if (url.pathname === '/rest/v1/usage_events') {
        if (req.method === 'POST') {
          const parsed = JSON.parse(body || '{}');
          const row = { id: `ev-${usageEventsStore.length + 1}`, ...parsed };
          usageEventsStore.push(row);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify([row]));
        }

        if (req.method === 'GET') {
          if (failUsageCountQuery) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'usage_events query failed' }));
          }
          const userFilter = (url.searchParams.get('user_id') || '').replace(/^eq\./, '');
          const jobFilter = (url.searchParams.get('job_id') || '').replace(/^eq\./, '');
          const kindFilter = (url.searchParams.get('kind') || '').replace(/^eq\./, '');
          const statusFilter = (url.searchParams.get('status') || '').replace(/^eq\./, '');
          const createdGte = (url.searchParams.get('created_at') || '').replace(/^gte\./, '');

          let matched = usageEventsStore.slice();
          if (userFilter) matched = matched.filter((e) => e.user_id === userFilter);
          if (jobFilter) matched = matched.filter((e) => e.job_id === jobFilter);
          if (kindFilter) matched = matched.filter((e) => e.kind === kindFilter);
          if (statusFilter) matched = matched.filter((e) => e.status === statusFilter);
          if (createdGte) matched = matched.filter((e) => e.created_at >= createdGte);

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Range': `0-${Math.max(0, matched.length - 1)}/${matched.length}`,
          });
          return res.end(JSON.stringify(matched.map((e) => ({ id: e.id }))));
        }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });

  const sbPort = await new Promise((resolve) => mockSupabase.listen(0, '127.0.0.1', () => resolve(mockSupabase.address().port)));
  const port = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r4-test-'));

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

    // 1. reportId なしは 400
    const missingIdRes = await fetch(`${baseUrl}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ theme: 'Test', question: 'Q', forceMock: true }),
    });
    assert.strictEqual(missingIdRes.status, 400);

    // 2. 他人 (User B) の reportId を指定すると 404
    const otherOwnerRes = await fetch(`${baseUrl}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ reportId: reportBId, theme: 'Test', question: 'Q', forceMock: true }),
    });
    assert.strictEqual(otherOwnerRes.status, 404);

    // 3. 件数取得失敗時は 503 でブロック
    failUsageCountQuery = true;
    const countErrRes = await fetch(`${baseUrl}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ reportId: reportAId, theme: 'Test', question: 'Q', forceMock: true }),
    });
    assert.strictEqual(countErrRes.status, 503);
    failUsageCountQuery = false;

    // 4. 過去セッションで9回実施済みの状態から、10回目は200で記録され、11回目は403 DEEPDIVE_LIMIT
    for (let i = 0; i < 9; i++) {
      usageEventsStore.push({
        id: `prev-${i}`,
        user_id: userAUuid,
        job_id: reportAId,
        kind: 'deepdive',
        status: 'done',
        created_at: new Date().toISOString(),
      });
    }

    const tenthRes = await fetch(`${baseUrl}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ reportId: reportAId, theme: 'Test', question: '10回目', forceMock: true }),
    });
    assert.strictEqual(tenthRes.status, 200);
    const recordedForA = usageEventsStore.filter((e) => e.job_id === reportAId && e.kind === 'deepdive' && e.status === 'done');
    assert.strictEqual(recordedForA.length, 10, '10th deepdive must record usage_event with job_id=reportId');

    const eleventhRes = await fetch(`${baseUrl}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ reportId: reportAId, theme: 'Test', question: '11回目', forceMock: true }),
    });
    assert.strictEqual(eleventhRes.status, 403);
    const eleventhBody = await eleventhRes.json();
    assert.strictEqual(eleventhBody.code, 'DEEPDIVE_LIMIT');

    // 5. 別ユーザー (User B) で1日50件上限 (DEEPDIVE_LIMIT_PER_DAY) に到達した場合も403
    for (let i = 0; i < 50; i++) {
      usageEventsStore.push({
        id: `daily-b-${i}`,
        user_id: userBUuid,
        job_id: `other-report-${i}`,
        kind: 'deepdive',
        status: 'done',
        created_at: new Date().toISOString(),
      });
    }
    const dailyLimitRes = await fetch(`${baseUrl}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-b' },
      body: JSON.stringify({ reportId: reportBId, theme: 'Test B', question: 'Daily over', forceMock: true }),
    });
    assert.strictEqual(dailyLimitRes.status, 403);
    const dailyBody = await dailyLimitRes.json();
    assert.strictEqual(dailyBody.code, 'DEEPDIVE_LIMIT');

    // 6. スライド生成 (/api/presentation/generate) の入力長・件数・サイズ検証 -> すべて400
    const badDoc = await fetch(`${baseUrl}/api/presentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ document: 'X'.repeat(20000) }),
    });
    assert.strictEqual(badDoc.status, 400, 'document > 15,000 must return 400');

    const badAudience = await fetch(`${baseUrl}/api/presentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ document: 'valid', audience: 'A'.repeat(301) }),
    });
    assert.strictEqual(badAudience.status, 400, 'audience > 300 must return 400');

    const badGoal = await fetch(`${baseUrl}/api/presentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({ document: 'valid', goal: 'G'.repeat(301) }),
    });
    assert.strictEqual(badGoal.status, 400, 'goal > 300 must return 400');

    const tooManyFiles = await fetch(`${baseUrl}/api/presentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({
        document: 'valid',
        files: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, content: 'hi' })),
      }),
    });
    assert.strictEqual(tooManyFiles.status, 400, 'files > 5 must return 400');

    // base64 で 5MB を超過 (7,000,000 文字 -> 約 5.25MB デコードサイズ)
    const oversizedBase64 = 'A'.repeat(7000000);
    const tooLargeFile = await fetch(`${baseUrl}/api/presentation/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-a' },
      body: JSON.stringify({
        document: 'valid',
        files: [{ name: 'big.pdf', base64: oversizedBase64 }],
      }),
    });
    assert.strictEqual(tooLargeFile.status, 400, 'file.base64 > 5MB must return 400');
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


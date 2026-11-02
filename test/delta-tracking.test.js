'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('node:path');
const { spawn } = require('child_process');

const { normalizeResult } = require('../server/util');
const { buildDeltaMockRaw } = require('../server/mock');
const { runDeltaTracking } = require('../server/pipeline');
const history = require('../server/history');

test('Delta Tracking: normalizeResult schema extensions', () => {
  const sample = {
    theme: 'AI検索ツールの動向',
    isDeltaTracking: true,
    baseReportId: '00000000-0000-0000-0000-000000000001',
    baseReportDate: '2026-01-15',
    baseReportTitle: 'AI検索ツール先行調査',
    deltaHighlights: [
      { category: '価格改定', title: '有料プラン値下げ', description: '月額20ドルから15ドルに改定', impact: '高' },
      { category: '機能追加', title: 'リアルタイムWeb連携', description: '最新ブラウジング機能が追加', impact: '中' },
      { title: 'API仕様変更', description: 'v2エンドポイント公開', impact: '低' },
      { title: '' }, // 無効な要素（title/description両方なし）
    ],
  };

  const normalized = normalizeResult(sample, {
    theme: sample.theme,
    isDeltaTracking: sample.isDeltaTracking,
    baseReportId: sample.baseReportId,
    baseReportDate: sample.baseReportDate,
    baseReportTitle: sample.baseReportTitle,
    deltaHighlights: sample.deltaHighlights,
  });

  assert.equal(normalized.isDeltaTracking, true);
  assert.equal(normalized.baseReportId, '00000000-0000-0000-0000-000000000001');
  assert.equal(normalized.baseReportDate, '2026-01-15');
  assert.equal(normalized.baseReportTitle, 'AI検索ツール先行調査');
  assert.equal(normalized.deltaHighlights.length, 3);
  assert.equal(normalized.deltaHighlights[0].category, '価格改定');
  assert.equal(normalized.deltaHighlights[0].title, '有料プラン値下げ');
  assert.equal(normalized.deltaHighlights[0].impact, '高');
  assert.equal(normalized.deltaHighlights[1].impact, '中');
  assert.equal(normalized.deltaHighlights[2].category, '新着アップデート'); // デフォルト値
  assert.equal(normalized.deltaHighlights[2].impact, '低');
});

test('Delta Tracking: buildDeltaMockRaw generates rich delta fields', () => {
  const baseReport = {
    id: crypto.randomUUID(),
    theme: '社内ナレッジ管理ツール',
    createdAt: '2026-02-01T10:00:00.000Z',
  };

  const deltaRaw = buildDeltaMockRaw(baseReport);

  assert.ok(deltaRaw);
  assert.ok(deltaRaw.title.includes('定点差分観測'));
  assert.ok(deltaRaw.deltaHighlights);
  assert.ok(deltaRaw.deltaHighlights.length >= 3);
  assert.ok(deltaRaw.table);
  assert.ok(deltaRaw.table.columns.length >= 3);
  assert.ok(deltaRaw.chart);
  assert.ok(['bar', 'radar'].includes(deltaRaw.chart.type));
  assert.ok(deltaRaw.chart.datasets.length >= 2);
  assert.ok(deltaRaw.insights.length >= 2);
});

test('Delta Tracking: runDeltaTracking executes in DEMO mode and returns normalized report', async () => {
  const baseReport = {
    id: crypto.randomUUID(),
    theme: '生成AI開発ツール',
    title: '生成AI開発ツール比較調査',
    createdAt: '2026-01-10T12:00:00.000Z',
    scope: 'tech',
  };

  const logs = [];
  const progressEvents = [];

  const mockJob = {
    id: 'test_delta_job_1',
    params: {
      theme: '【定点差分】生成AI開発ツール',
      baseReportId: baseReport.id,
      baseReport,
      forceMock: true,
    },
    log: (level, msg, detail) => logs.push({ level, msg, detail }),
    progress: (stage, value) => progressEvents.push({ stage, value }),
  };

  const result = await runDeltaTracking(mockJob, { geminiApiKey: '' });

  assert.ok(result);
  assert.equal(result.isDeltaTracking, true);
  assert.equal(result.baseReportId, baseReport.id);
  assert.equal(result.baseReportTitle, '生成AI開発ツール比較調査');
  assert.ok(result.deltaHighlights.length >= 3);
  assert.ok(result.sources.length >= 1);
  assert.ok(logs.length > 0);
  assert.ok(progressEvents.length > 0);
});

const ROOT = path.join(__dirname, '..');

async function runWithServer(callback) {
  const testPort = 3953;
  const env = { ...process.env, PORT: String(testPort), NODE_ENV: 'test' };

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  const url = `http://localhost:${testPort}`;

  let ready = false;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`${url}/api/info`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }

  assert.ok(ready, 'Test server failed to start within timeout');

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

test('integration: /api/research/delta accepts valid baseReport and rejects invalid requests', async () => {
  await runWithServer(async (url) => {
    // 1. baseReportId なしは 400
    const resNoId = await fetch(`${url}/api/research/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(resNoId.status, 400);

    // 2. 存在しない baseReportId は 404
    const fakeId = crypto.randomUUID();
    const resNotFound = await fetch(`${url}/api/research/delta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseReportId: fakeId }),
    });
    assert.equal(resNotFound.status, 404);

    // 3. 有効なレポートを作成して delta をリクエスト
    const baseId = crypto.randomUUID();
    const baseReport = {
      id: baseId,
      theme: '定点観測テスト元レポート',
      title: '定点観測テスト元タイトル',
      summary: '前回の調査サマリー',
      createdAt: '2026-01-01T00:00:00.000Z',
      scope: 'web',
      sources: [{ title: '元ソース', url: 'https://example.com' }],
    };
    history.save(baseReport);

    try {
      const resOk = await fetch(`${url}/api/research/delta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseReportId: baseId, forceMock: true }),
      });
      assert.equal(resOk.status, 202);
      const data = await resOk.json();
      assert.ok(data.jobId);
    } finally {
      // 後片付け
      history.remove(baseId);
    }
  });
});

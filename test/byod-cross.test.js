'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResult } = require('../server/util');
const { buildMock } = require('../server/mock');
const { runCrossSynthesis } = require('../server/pipeline');

test('BYOD & Cross: normalizeResult schema extensions', () => {
  const sample = {
    theme: 'AIエージェント比較',
    referenceUrls: ['https://example.com/agent-a', 'invalid-url', 'https://example.com/agent-b'],
    attachedFiles: [
      { name: 'data.xlsx', size: 1024, text: 'Sheet1\nCol1,Col2' },
      { name: 'invalid-file' }, // size or text missing
    ],
    isCrossSynthesis: true,
    synthesizedReportIds: ['rep_1', 'rep_2'],
    synthesizedThemes: ['Agent A調査', 'Agent B調査'],
  };

  const normalized = normalizeResult(sample, {
    theme: sample.theme,
    referenceUrls: sample.referenceUrls,
    attachedFiles: sample.attachedFiles,
    isCrossSynthesis: sample.isCrossSynthesis,
    synthesizedReportIds: sample.synthesizedReportIds,
    synthesizedThemes: sample.synthesizedThemes,
  });

  assert.equal(normalized.referenceUrls.length, 2);
  assert.equal(normalized.referenceUrls[0], 'https://example.com/agent-a');
  assert.equal(normalized.referenceUrls[1], 'https://example.com/agent-b');

  assert.equal(normalized.attachedFiles.length, 2);
  assert.equal(normalized.attachedFiles[0].name, 'data.xlsx');
  assert.equal(normalized.attachedFiles[0].size, 1024);

  assert.equal(normalized.isCrossSynthesis, true);
  assert.deepEqual(normalized.synthesizedReportIds, ['rep_1', 'rep_2']);
  assert.deepEqual(normalized.synthesizedThemes, ['Agent A調査', 'Agent B調査']);
});

test('BYOD & Cross: buildMock handles referenceUrls and attachedFiles', () => {
  const params = {
    theme: '次世代SaaSツール分析',
    referenceUrls: ['https://example.com/pricing', 'https://saas-product.io/features'],
    attachedFiles: [{ name: 'internal-memo.txt', size: 500, text: '自社開発方針メモ' }],
  };

  const mock = buildMock(params);

  assert.equal(mock.referenceUrls.length, 2);
  assert.equal(mock.attachedFiles.length, 1);
  // sources に先行参考URLが含まれること
  const hasRefUrlInSources = mock.sources.some(s => s.url.includes('example.com') || s.url.includes('saas-product.io'));
  assert.equal(hasRefUrlInSources, true);
});

test('BYOD & Cross: runCrossSynthesis generates merged mock report with table and radar', async () => {
  const reports = [
    {
      id: 'rep_1',
      theme: 'Notion AIの機能と価格',
      title: 'Notion AI 徹底調査',
      summary: 'Notion AIはワークスペース統合に強みを持つ。',
      metrics: [{ label: '月額', value: '$10' }],
    },
    {
      id: 'rep_2',
      theme: 'Cursor AIの機能と価格',
      title: 'Cursor AI 徹底調査',
      summary: 'Cursorはエンジニアの開発効率を劇的に向上させる。',
      metrics: [{ label: '月額', value: '$20' }],
    },
  ];

  const logs = [];
  const progressEvents = [];

  const mockJob = {
    id: 'test_cross_job_1',
    params: {
      theme: '【統合クロス分析】Notion AI × Cursor AI',
      reportIds: ['rep_1', 'rep_2'],
      reports,
      forceMock: true,
    },
    log: (level, msg, detail) => logs.push({ level, msg, detail }),
    progress: (stage, value) => progressEvents.push({ stage, value }),
  };

  const result = await runCrossSynthesis(mockJob, { geminiApiKey: '' });

  assert.ok(result);
  assert.equal(result.isCrossSynthesis, true);
  assert.deepEqual(result.synthesizedReportIds, ['rep_1', 'rep_2']);
  assert.equal(result.synthesizedThemes.length, 2);
  assert.ok(result.title.includes('統合クロス分析'));
  assert.ok(result.table);
  assert.ok(result.table.columns.length >= 2);
  assert.ok(result.table.rows.length >= 2);
  assert.ok(result.chart);
  assert.equal(result.chart.type, 'radar');
  assert.ok(logs.length > 0);
  assert.ok(progressEvents.length > 0);
});

// API エンドポイント統合テスト
const path = require('node:path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const history = require('../server/history');

process.env.NODE_ENV = 'test';

async function runWithServer(callback) {
  const testPort = 3951;
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

test('integration: /api/research accepts referenceUrls and attachedFiles', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'BYOD検証リサーチ',
        scope: 'web',
        depth: 'quick',
        purpose: 'business',
        referenceUrls: ['https://example.com/spec'],
        attachedFiles: [{ name: 'test.txt', size: 120, text: 'サンプル仕様' }],
        forceMock: true,
      }),
    });

    assert.equal(res.status, 202);
    const data = await res.json();
    assert.ok(data.jobId);
  });
});

test('integration: /api/research/cross-synthesis validates and accepts job', async () => {
  await runWithServer(async (url) => {
    // 1件未満は 400
    const resBad = await fetch(`${url}/api/research/cross-synthesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportIds: ['single_id'] }),
    });
    assert.equal(resBad.status, 400);

    // 存在しないレポートは 404
    const resNotFound = await fetch(`${url}/api/research/cross-synthesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportIds: ['non_existent_1', 'non_existent_2'] }),
    });
    assert.equal(resNotFound.status, 404);

    const crypto = require('crypto');
    const rep1 = {
      id: crypto.randomUUID(),
      theme: 'リサーチA',
      title: 'レポートA',
      summary: 'Aの要約',
      scope: 'web',
      depth: 'quick',
      table: { columns: ['項目', 'A'], rows: [['価格', '100']] },
    };
    const rep2 = {
      id: crypto.randomUUID(),
      theme: 'リサーチB',
      title: 'レポートB',
      summary: 'Bの要約',
      scope: 'web',
      depth: 'quick',
      table: { columns: ['項目', 'B'], rows: [['価格', '200']] },
    };
    history.save(rep1);
    history.save(rep2);

    try {
      const resOk = await fetch(`${url}/api/research/cross-synthesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportIds: [rep1.id, rep2.id],
          forceMock: true,
        }),
      });

      assert.equal(resOk.status, 202);
      const dataOk = await resOk.json();
      assert.ok(dataOk.jobId);
    } finally {
      try { history.remove(rep1.id); } catch {}
      try { history.remove(rep2.id); } catch {}
    }
  });
});


'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeResult } = require('../server/util');
const { buildMock } = require('../server/mock');
const { runResearch } = require('../server/pipeline');

const ROOT = path.join(__dirname, '..');

test('multihop: normalizeResult preserves and sanitizes multiHop metadata and source hops', () => {
  const raw = {
    title: 'マルチホップテスト',
    summary: '要約テスト',
    multiHop: {
      enabled: true,
      hopsExecuted: 2,
      gapsDetected: ['主要3社の料金プラン', '2026年市場規模予測'],
      followUpQueries: ['サービス 料金プラン 比較', '市場規模 2026 予測'],
      secondHopSourcesCount: 3,
    },
  };

  const meta = {
    id: 'test-hop-1',
    theme: 'AIディープリサーチの進化',
    depth: 'deep',
    sources: [
      { title: '1次ソース1', url: 'https://example.com/1', domain: 'example.com', hop: 1 },
      { title: '2次ソース1', url: 'https://example.com/2', domain: 'example.com', hop: 2 },
    ],
  };

  const res = normalizeResult(raw, meta);
  assert.ok(res.multiHop, 'multiHop must be present in normalized result');
  assert.strictEqual(res.multiHop.enabled, true);
  assert.strictEqual(res.multiHop.hopsExecuted, 2);
  assert.strictEqual(res.multiHop.gapsDetected.length, 2);
  assert.strictEqual(res.multiHop.followUpQueries.length, 2);
  assert.strictEqual(res.multiHop.secondHopSourcesCount, 3);

  assert.strictEqual(res.sources.length, 2);
  assert.strictEqual(res.sources[0].hop, 1);
  assert.strictEqual(res.sources[1].hop, 2);
});

test('multihop: buildMock creates valid multiHop and 2nd-hop sources when depth is deep', () => {
  const deepMock = buildMock({
    theme: '最新AIエージェントの動向',
    scope: 'web',
    depth: 'deep',
  });

  assert.ok(deepMock.raw.multiHop, 'deep mock must contain multiHop in raw');
  assert.strictEqual(deepMock.raw.multiHop.enabled, true);
  assert.strictEqual(deepMock.raw.multiHop.hopsExecuted, 2);
  assert.ok(deepMock.raw.multiHop.gapsDetected.length >= 2, 'must have 2+ gaps detected');
  assert.ok(deepMock.raw.multiHop.followUpQueries.length >= 2, 'must have 2+ follow-up queries');
  assert.ok(deepMock.raw.multiHop.secondHopSourcesCount >= 1, 'must have 2nd hop sources count');

  const hop2Sources = deepMock.sources.filter((s) => s.hop === 2);
  assert.ok(hop2Sources.length >= 1, 'deep mock must include hop: 2 sources');

  // クイックモードでは multiHop が未定義（無効）
  const quickMock = buildMock({
    theme: '最新AIエージェントの動向',
    scope: 'web',
    depth: 'quick',
  });
  assert.ok(!quickMock.raw.multiHop, 'quick mock must not contain multiHop');
  const quickHop2 = quickMock.sources.filter((s) => s.hop === 2);
  assert.strictEqual(quickHop2.length, 0, 'quick mock must not have hop: 2 sources');
});

test('multihop: runResearch in DEMO/mock mode executes 2-stage search and emits gap logs', async () => {
  const logs = [];
  const progressEvents = [];

  const mockJob = {
    id: 'test-job-multihop',
    params: {
      theme: 'SaaSプロダクトの解約率改善策',
      scope: 'web',
      depth: 'deep',
      forceMock: true,
    },
    controller: new AbortController(),
    emit(event) {
      if (event.type === 'log') logs.push(event);
      if (event.type === 'progress') progressEvents.push(event);
    },
  };

  const res = await runResearch(mockJob, { mode: 'mock' });
  assert.ok(res.multiHop, 'result must contain multiHop');
  assert.strictEqual(res.multiHop.enabled, true);
  assert.strictEqual(res.multiHop.hopsExecuted, 2);

  // ログに自律ギャップ分析と2次ホップの出力があることを検証
  const hasGapAnalysisLog = logs.some((l) => l.message && l.message.includes('自律ギャップ分析'));
  assert.ok(hasGapAnalysisLog, 'must emit gap analysis log');

  const hasHop2Log = logs.some((l) => l.message && l.message.includes('第2次ホップ'));
  assert.ok(hasHop2Log, 'must emit 2nd hop search log');
});

test('multihop: public/index.html and render.js consistency for multi-hop UI', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('自律深層リサーチ'), 'index.html must have 自律深層リサーチ depth label');
  assert.ok(indexHtml.includes('2段階探索'), 'index.html must mention 2段階探索 in depth subtitle');

  const renderJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8');
  assert.ok(renderJs.includes('tag-multihop'), 'render.js must render tag-multihop');
  assert.ok(renderJs.includes('multihop-banner'), 'render.js must render multihop-banner');
  assert.ok(renderJs.includes('tag-hop2'), 'render.js must render tag-hop2 badge');
});

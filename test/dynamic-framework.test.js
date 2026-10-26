'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeResult, FOCUS_LABELS } = require('../server/util');
const { buildMock } = require('../server/mock');
const { runResearch } = require('../server/pipeline');

test('dynamic framework: FOCUS_LABELS contains all required options including auto', () => {
  assert.ok(FOCUS_LABELS.auto, 'must have auto focus');
  assert.ok(FOCUS_LABELS.decision, 'must have decision focus');
  assert.ok(FOCUS_LABELS.tech, 'must have tech focus');
  assert.ok(FOCUS_LABELS.market, 'must have market focus');
  assert.ok(FOCUS_LABELS.problem, 'must have problem focus');
});

test('dynamic framework: normalizeResult preserves and sanitizes framework data', () => {
  const raw = {
    title: 'テストタイトル',
    summary: 'テストサマリー',
    framework: {
      focus: 'tech',
      focusLabel: '技術比較・選定・アーキテクチャ',
      rationale: '選定比較の特性に最適化',
      dynamicHeadings: [
        { heading: '性能ベンチマーク', keyQuestion: 'レイテンシとメモリ使用量' },
        { heading: '開発者体験とエコシステム', keyQuestion: 'ライブラリとサポート' },
      ],
      tableComparisonAxis: '性能 vs 開発効率',
    },
  };

  const meta = {
    id: 'test-123',
    theme: '技術比較テーマ',
    scope: 'web',
    depth: 'deep',
    focus: 'tech',
  };

  const res = normalizeResult(raw, meta);
  assert.strictEqual(res.focus, 'tech');
  assert.strictEqual(res.focusLabel, '技術比較・選定・アーキテクチャ');
  assert.ok(res.framework, 'framework must be preserved');
  assert.strictEqual(res.framework.focus, 'tech');
  assert.strictEqual(res.framework.rationale, '選定比較の特性に最適化');
  assert.strictEqual(res.framework.dynamicHeadings.length, 2);
  assert.strictEqual(res.framework.dynamicHeadings[0].heading, '性能ベンチマーク');
  assert.strictEqual(res.framework.tableComparisonAxis, '性能 vs 開発効率');
});

test('dynamic framework: buildMock creates tailored dynamic framework based on focus', () => {
  const mockTech = buildMock({ theme: 'Next.js 15 vs Remix', scope: 'web', depth: 'deep', focus: 'tech' });
  assert.ok(mockTech.raw.framework, 'mock must contain framework');
  assert.strictEqual(mockTech.raw.framework.focus, 'tech');
  assert.strictEqual(mockTech.raw.framework.focusLabel, '技術比較・選定・アーキテクチャ');
  assert.ok(mockTech.raw.framework.dynamicHeadings.length >= 3, 'must have dynamic headings');

  const mockAuto = buildMock({ theme: '新規事業の立ち上げ', scope: 'web', depth: 'deep', focus: 'auto' });
  assert.strictEqual(mockAuto.raw.framework.focus, 'auto');
  assert.strictEqual(mockAuto.raw.framework.focusLabel, 'テーマ特化型最適構造');
});

test('dynamic framework: all focus types produce consistent framework in normalizeResult', () => {
  const focusTypes = ['auto', 'decision', 'tech', 'market', 'problem'];
  for (const f of focusTypes) {
    const mock = buildMock({ theme: `テストテーマ_${f}`, scope: 'web', depth: 'deep', focus: f });
    assert.ok(mock.raw.framework, `mock must contain framework for ${f}`);
    assert.strictEqual(mock.raw.framework.focus, f);

    const norm = normalizeResult(mock.raw, {
      id: `job-${f}`,
      theme: `テストテーマ_${f}`,
      depth: 'deep',
      focus: f,
      focusLabel: FOCUS_LABELS[f],
    });

    assert.strictEqual(norm.focus, f);
    assert.ok(norm.framework, 'framework must exist in normalized result');
    assert.strictEqual(norm.framework.focus, f);
    assert.ok(norm.framework.dynamicHeadings.length >= 3, 'must have 3+ dynamic headings');
  }
});

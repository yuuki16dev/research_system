'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { THEME_PRESETS, resolveTheme } = require('../server/themes');
const { normalizeResult } = require('../server/util');
const settings = require('../server/settings');
const { applyThemeTokens, generateExcelReport, transformDataToExcelFormat, BRAND } = require('../server/excel');
const { buildThemePdfStyle, buildDecisionBriefHtml, buildSlideDeckHtml } = require('../public/js/exporters');

test('Theme Designer: THEME_PRESETS defines all enterprise presets with valid color tokens', () => {
  const expectedPresets = [
    'corporate-blue',
    'tech-emerald',
    'executive-slate',
    'vibrant-violet',
    'warm-amber',
    'crimson-burgundy',
  ];

  for (const pid of expectedPresets) {
    const preset = THEME_PRESETS[pid];
    assert.ok(preset, `Preset ${pid} must exist in THEME_PRESETS`);
    assert.ok(preset.name, `Preset ${pid} must have a name`);
    assert.match(preset.primary, /^#[0-9a-fA-F]{6}$/, `Preset ${pid} primary must be hex color`);
    assert.match(preset.accent, /^#[0-9a-fA-F]{6}$/, `Preset ${pid} accent must be hex color`);
    assert.ok(Array.isArray(preset.chart) && preset.chart.length >= 3, `Preset ${pid} chart must have >= 3 colors`);
  }
});

test('Theme Designer: resolveTheme resolves known presets and custom colors correctly', () => {
  // 1. 既知のプリセット
  const emerald = resolveTheme('tech-emerald');
  assert.equal(emerald.id, 'tech-emerald');
  assert.equal(emerald.primary, '#059669');
  assert.equal(emerald.accent, '#10b981');

  // 2. カスタムカラー指定
  const custom = resolveTheme({ preset: 'custom', primary: '#ff3366', accent: '#ff99aa' });
  assert.equal(custom.id, 'custom');
  assert.equal(custom.primary, '#ff3366');
  assert.equal(custom.accent, '#ff99aa');
  assert.ok(custom.gradient.includes('#ff3366'));

  // 3. 不正な値の安全なフォールバック
  const fallback = resolveTheme('non-existent-theme-xyz');
  assert.equal(fallback.id, 'corporate-blue');
});

test('Theme Designer: normalizeResult schema stores reportTheme correctly', () => {
  const sample = {
    theme: 'AIエージェントの動向',
    reportTheme: { preset: 'warm-amber' },
  };

  const normalized = normalizeResult(sample, {
    theme: sample.theme,
    reportTheme: sample.reportTheme,
  });

  assert.ok(normalized.reportTheme);
  assert.equal(normalized.reportTheme.preset, 'warm-amber');
  assert.equal(normalized.reportTheme.primary, '#d97706');
});

test('Theme Designer: server settings preserves themePreset', () => {
  const saved = settings.save({ themePreset: 'vibrant-violet' });
  assert.equal(saved.themePreset, 'vibrant-violet');

  const view = settings.publicView();
  assert.equal(view.themePreset, 'vibrant-violet');

  // 元に戻す
  settings.save({ themePreset: 'corporate-blue' });
});

test('Theme Designer: Excel engine dynamically updates BRAND tokens on theme selection', async () => {
  applyThemeTokens('crimson-burgundy');
  assert.equal(BRAND.blue, 'BE123C');
  assert.equal(BRAND.cyan, 'F43F5E');

  const mockData = {
    theme: 'テーマテスト',
    title: 'テーマテストタイトル',
    createdAt: new Date().toISOString(),
    reportTheme: { preset: 'crimson-burgundy' },
    metrics: [{ label: 'KPI', value: '100' }],
    sources: [{ title: '情報源', url: 'https://example.com', score: 90 }],
  };

  const buffer = await generateExcelReport(mockData, { theme: 'crimson-burgundy' });
  assert.ok(buffer && buffer.length > 1000, 'Excel buffer must be generated with theme');
});

test('Theme Designer: PDF exporters include theme CSS overrides', () => {
  const css = buildThemePdfStyle('tech-emerald');
  assert.ok(css.includes('--blue: #059669 !important;'));
  assert.ok(css.includes('--cyan: #10b981 !important;'));

  const mockData = {
    theme: 'PDFテーマテスト',
    title: 'PDFテーマテストタイトル',
    createdAt: new Date().toISOString(),
    reportTheme: { preset: 'tech-emerald' },
    metrics: [],
    sources: [],
  };

  const paperHtml = buildDecisionBriefHtml(mockData);
  assert.ok(paperHtml.includes('rs-theme-pdf-overrides'), 'Decision brief must contain theme override style tag');

  const slideHtml = buildSlideDeckHtml(mockData);
  assert.ok(slideHtml.includes('rs-theme-pdf-overrides'), 'Slide deck must contain theme override style tag');
});

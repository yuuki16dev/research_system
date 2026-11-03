const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('v1.19.1: exporters.js passes isPrint: true to renderSvgChart in Decision Brief', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/exporters.js'), 'utf-8');
  assert.ok(
    code.includes('renderSvgChart(data.chart, { isPrint: true })'),
    'exporters.js must pass { isPrint: true } to renderSvgChart'
  );
});

test('v1.19.1: charts.js includes auto-scale normalization and point circles in renderRadarChart', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/modules/charts.js'), 'utf-8');
  assert.ok(code.includes('rawMax <= 5 ? 5 : rawMax <= 10 ? 10 : 100'), 'Must contain auto-scaling scaleMax logic');
  assert.ok(code.includes('scaleTicksSvg'), 'Must render scale tick labels');
  assert.ok(code.includes('pointsSvg'), 'Must render data point circles');
});

test('v1.19.1: ui.js defines all required Lucide SVG icons', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf-8');
  const required = [
    'palette',
    'monitor',
    'plus',
    'minus',
    'edit-3',
    'upload-cloud',
    'users',
    'git-merge',
    'database'
  ];
  for (const ic of required) {
    const hasIcon = code.includes(`${ic}:`) || code.includes(`'${ic}':`) || code.includes(`"${ic}":`);
    assert.ok(hasIcon, `ui.js must define icon '${ic}'`);
  }
});

test('v1.19.1: util.js normalizeResult preserves chart.description', () => {
  const { normalizeResult } = require('../server/util');
  const normalized = normalizeResult({
    chart: {
      type: 'radar',
      title: 'テストチャート',
      description: '多変量スコア比較解説',
      labels: ['A', 'B', 'C'],
      datasets: [{ label: 'スコア', data: [4.2, 3.8, 4.5] }]
    }
  });
  assert.equal(normalized.chart.description, '多変量スコア比較解説');
});

test('v1.19.1: pipeline.js passes themePreset to normalizeResult', () => {
  const code = fs.readFileSync(path.join(__dirname, '../server/pipeline.js'), 'utf-8');
  assert.ok(code.includes('themePreset: settings.themePreset,'), 'runResearch must pass themePreset');
});

test('v1.19.1: server/index.js prevents duplicate 【定点差分】 prefixes', () => {
  const code = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf-8');
  assert.ok(code.includes('/^(【定点差分】)+/'), 'server/index.js must strip existing prefix');
});

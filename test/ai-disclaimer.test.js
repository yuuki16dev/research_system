'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const { AI_GENERATED_DISCLAIMER, resolveAiDisclaimer } = require('../server/ai-disclaimer');
const { buildMarkdown, buildPlainText } = require('../server/util');
const { renderTemplateHtml } = require('../server/template-engine');
const excel = require('../server/excel');

const SAMPLE_REPORT = {
  id: 'd1-test-001',
  theme: 'AIリサーチ基盤の選定',
  title: 'AIリサーチ基盤の比較分析レポート',
  subtitle: '主要アプローチの定量的評価と導入提言',
  scope: 'all',
  scopeLabel: 'Web全体',
  depth: 'quick',
  depthLabel: 'クイック',
  periodLabel: '直近1年',
  createdAt: '2026-11-26T12:00:00.000Z',
  durationMs: 12000,
  summary: '主要3方式を比較した結果、段階的導入が最も費用対効果に優れる。',
  keyPoints: ['導入コストを30%削減可能', 'セキュリティガバナンスの標準化が鍵'],
  metrics: [{ label: '導入コスト削減', value: '30%', note: '初年度試算' }],
  table: {
    caption: '方式比較マトリクス',
    columns: ['方式', '推奨度', 'コスト'],
    rows: [
      ['方式A', '◎ 推奨', '低'],
      ['方式B', '○ 標準', '中'],
    ],
  },
  sections: [{ heading: '導入背景と評価', body: '対象領域の最新動向を整理した。', bullets: ['要件整理'] }],
  insights: [{ title: '先行PoCの実施', body: '小規模チームから開始すべき。', priority: '高' }],
  sources: [
    { index: 1, title: '公式ドキュメント', url: 'https://example.com/doc', domain: 'example.com', score: 90, snippet: '概要' },
  ],
};

function extractWorkbookText(wb) {
  const parts = [];
  wb.worksheets.forEach((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (typeof v === 'string') parts.push(v);
        else if (v && typeof v === 'object' && Array.isArray(v.richText)) {
          parts.push(v.richText.map((r) => r.text).join(''));
        } else if (v && typeof v === 'object' && typeof v.text === 'string') {
          parts.push(v.text);
        }
      });
    });
  });
  return parts.join('\n');
}

test('D-1 single source of truth: server and frontend share exact AI_GENERATED_DISCLAIMER constant', async () => {
  const frontendMod = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'modules', 'ai-disclaimer.js')).href);
  assert.equal(typeof AI_GENERATED_DISCLAIMER, 'string');
  assert.ok(AI_GENERATED_DISCLAIMER.length >= 20);
  assert.equal(frontendMod.AI_GENERATED_DISCLAIMER, AI_GENERATED_DISCLAIMER);
  const settingsSrc = fs.readFileSync(path.join(ROOT, 'server', 'settings.js'), 'utf8');
  assert.ok(settingsSrc.includes('disclaimer: AI_GENERATED_DISCLAIMER'), 'settings.js default must use AI_GENERATED_DISCLAIMER');

  assert.equal(resolveAiDisclaimer(''), AI_GENERATED_DISCLAIMER);
  assert.equal(resolveAiDisclaimer(AI_GENERATED_DISCLAIMER), AI_GENERATED_DISCLAIMER);
  const combined = resolveAiDisclaimer('社外秘');
  assert.ok(combined.includes(AI_GENERATED_DISCLAIMER) && combined.includes('社外秘'));
});

test('D-1 Markdown & Plain Text (server and frontend): both include AI_GENERATED_DISCLAIMER', async () => {
  const serverMd = buildMarkdown(SAMPLE_REPORT);
  const serverTxt = buildPlainText(SAMPLE_REPORT);
  assert.ok(serverMd.includes(AI_GENERATED_DISCLAIMER), 'server buildMarkdown must include AI disclaimer');
  assert.ok(serverTxt.includes(AI_GENERATED_DISCLAIMER), 'server buildPlainText must include AI disclaimer');

  const exporters = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'exporters.js')).href);
  const clientMd = exporters.buildMarkdown(SAMPLE_REPORT);
  const clientTxt = exporters.buildPlainText(SAMPLE_REPORT);
  assert.ok(clientMd.includes(AI_GENERATED_DISCLAIMER), 'frontend buildMarkdown must include AI disclaimer');
  assert.ok(clientTxt.includes(AI_GENERATED_DISCLAIMER), 'frontend buildPlainText must include AI disclaimer');
});

test('D-1 PDF templates (server A/B/C and frontend HTML builders): all include AI_GENERATED_DISCLAIMER', async () => {
  for (const key of ['slides', 'decision', 'report']) {
    const htmlWithSources = renderTemplateHtml(key, SAMPLE_REPORT, {});
    assert.ok(
      htmlWithSources.includes(AI_GENERATED_DISCLAIMER),
      `server template "${key}" must include AI_GENERATED_DISCLAIMER`
    );

    const htmlNoSources = renderTemplateHtml(key, { ...SAMPLE_REPORT, sources: [] }, { disclaimer: '社内資料' });
    assert.ok(
      htmlNoSources.includes(AI_GENERATED_DISCLAIMER),
      `server template "${key}" with custom brand disclaimer must still include AI_GENERATED_DISCLAIMER`
    );
  }

  const exporters = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'exporters.js')).href);
  for (const [name, html] of [
    ['buildDecisionBriefHtml', exporters.buildDecisionBriefHtml(SAMPLE_REPORT, {})],
    ['buildSlideDeckHtml', exporters.buildSlideDeckHtml(SAMPLE_REPORT, {})],
    ['buildResearchReportHtml', exporters.buildResearchReportHtml(SAMPLE_REPORT, { disclaimer: '社外秘' })],
  ]) {
    assert.ok(html.includes(AI_GENERATED_DISCLAIMER), `frontend ${name} must include AI_GENERATED_DISCLAIMER`);
  }
});

test('D-1 Excel (commercial and legacy engines): both workbooks contain AI_GENERATED_DISCLAIMER', async () => {
  // 1. Commercial Excel engine (default)
  const commercialBuf = await excel.generateExcelReport(SAMPLE_REPORT, {});
  const commercialWb = new ExcelJS.Workbook();
  await commercialWb.xlsx.load(commercialBuf);
  const commercialText = extractWorkbookText(commercialWb);
  assert.ok(
    commercialText.includes(AI_GENERATED_DISCLAIMER),
    'commercial Excel workbook must contain AI_GENERATED_DISCLAIMER'
  );

  // 2. Legacy Excel engine
  const legacyBuf = await excel.generateExcelReport(SAMPLE_REPORT, {}, { engine: 'legacy' });
  const legacyWb = new ExcelJS.Workbook();
  await legacyWb.xlsx.load(legacyBuf);
  const legacyText = extractWorkbookText(legacyWb);
  assert.ok(
    legacyText.includes(AI_GENERATED_DISCLAIMER),
    'legacy Excel workbook must contain AI_GENERATED_DISCLAIMER'
  );
});

test('D-1 UI report top banner & PPTX export: both include AI_GENERATED_DISCLAIMER from single constant', async () => {
  // 1. UI render.js checks
  const renderSrc = fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8');
  assert.ok(renderSrc.includes("./modules/ai-disclaimer.js"), 'render.js must import single-source ai-disclaimer module');
  assert.ok(renderSrc.includes('AI_GENERATED_DISCLAIMER'), 'render.js must output AI_GENERATED_DISCLAIMER');
  assert.ok(renderSrc.includes('ai-disclaimer-banner'), 'render.js must render top ai-disclaimer-banner');

  // 2. PPTX export execution with lightweight PptxGenJS mock
  const recordedTexts = [];
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  try {
    globalThis.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    globalThis.window = {
      PptxGenJS: class MockPptxGenJS {
        constructor() {
          this.ShapeType = { line: 'line', rect: 'rect', roundRect: 'roundRect' };
          this.ChartType = { bar: 'bar', line: 'line', pie: 'pie', radar: 'radar', doughnut: 'doughnut' };
        }
        addSlide() {
          return {
            addShape() {},
            addChart() {},
            addTable() {},
            addText(val) {
              if (typeof val === 'string') recordedTexts.push(val);
              else if (Array.isArray(val)) recordedTexts.push(val.map((x) => (typeof x === 'string' ? x : x.text || '')).join(''));
            },
          };
        }
        async writeFile() {}
      },
    };

    const pptxMod = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'modules', 'pptx-export.js')).href);
    await pptxMod.exportPowerPoint(SAMPLE_REPORT, { publisherName: 'Test Corp', disclaimer: '社外秘' });
    const allPptxText = recordedTexts.join('\n');
    assert.ok(
      allPptxText.includes(AI_GENERATED_DISCLAIMER),
      'PPTX export must include AI_GENERATED_DISCLAIMER even when custom brand disclaimer is set'
    );
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
  }
});

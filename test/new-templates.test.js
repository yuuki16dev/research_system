'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const templateEngine = require(path.join(ROOT, 'server', 'template-engine.js'));
const pdf = require(path.join(ROOT, 'server', 'pdf.js'));
const {
  resolveOptimalPdfTemplate,
  buildPdfHtml,
} = require(path.join(ROOT, 'public', 'js', 'exporters.js'));

test('new templates: templateEngine renders all 3 templates (A-slides, B-decision, C-report) successfully', () => {
  const sampleData = {
    title: '次世代推論基盤の比較評価',
    theme: 'AIアーキテクチャ',
    summary: '一次情報に忠実な推論パフォーマンス分析。',
    metrics: [{ label: 'TTFT', value: '180ms' }],
    table: {
      caption: 'モデル比較マトリクス',
      columns: ['モデル', 'レイテンシ', '推奨度'],
      rows: [['Gemini 1.5 Pro', '180ms', '◎ 推奨']],
    },
    sections: [{ heading: '第1章', body: '詳細本文です。' }],
    sources: [{ id: 'S1', title: 'Tech Report', publisher: 'Google', score: 95, url: 'https://example.com' }],
  };

  // 1. Template A (Slides)
  const htmlA = templateEngine.renderTemplateHtml('slides', sampleData);
  assert.ok(htmlA.includes('id="deck"'), 'Template A must have deck container');
  assert.ok(htmlA.includes('id="report-data"'), 'Template A must have report-data block');
  assert.ok(htmlA.includes('次世代推論基盤の比較評価'), 'Template A must include title');

  // 2. Template B (Decision Brief)
  const htmlB = templateEngine.renderTemplateHtml('decision', sampleData);
  assert.ok(htmlB.includes('id="doc"'), 'Template B must have doc container');
  assert.ok(htmlB.includes('id="report-data"'), 'Template B must have report-data block');
  assert.ok(htmlB.includes('次世代推論基盤の比較評価'), 'Template B must include title');

  // 3. Template C (Research Report)
  const htmlC = templateEngine.renderTemplateHtml('report', sampleData);
  assert.ok(htmlC.includes('id="doc"'), 'Template C must have doc container');
  assert.ok(htmlC.includes('id="report-data"'), 'Template C must have report-data block');
  assert.ok(htmlC.includes('次世代推論基盤の比較評価'), 'Template C must include title');
});

test('new templates: resolveOptimalPdfTemplate correctly recommends research-report for white paper topics', () => {
  const rec1 = resolveOptimalPdfTemplate({
    title: '生成AI技術動向白書 2026年版',
    theme: 'AI白書',
    framework: { focus: 'report' },
  });
  assert.strictEqual(rec1.template, 'research-report');
  assert.ok(rec1.label.includes('調査白書'));

  const rec2 = resolveOptimalPdfTemplate({
    title: '量子コンピューティング詳細技術調査',
    framework: { focus: 'academic' },
  });
  assert.strictEqual(rec2.template, 'research-report');
});

test('new templates: buildPdfHtml properly dispatches research-report template', () => {
  const mockData = { title: '白書テスト' };
  const html = buildPdfHtml(mockData, 'Test Brand', 'research-report');
  assert.ok(html.includes('class="doc research-report"'), 'Must have .doc.research-report class');
  assert.ok(html.includes('Strategic Intelligence White Paper'), 'Must include White Paper kicker');
});

test('new templates: headless browser renders substantial PDF from Template C and Template A', async () => {
  const browserPath = pdf.findSystemBrowser();
  if (!browserPath) return; // CI/ブラウザ未検出環境ではスキップ

  const sampleData = {
    title: '白書PDF生成検証',
    theme: '自動検証',
    summary: '白書型テンプレートのPDF出力整合性テスト。',
    sections: [{ heading: 'セクション1', body: '本文テストです。' }],
  };

  // Template C (Portrait Report)
  const htmlC = templateEngine.renderTemplateHtml('report', sampleData);
  const pdfPathC = await pdf.generatePdfFromHtml(htmlC, { orientation: 'portrait' });
  assert.ok(fs.existsSync(pdfPathC), 'PDF file C must exist');
  const sizeC = fs.statSync(pdfPathC).size;
  fs.unlinkSync(pdfPathC);
  assert.ok(sizeC > 8000, `Template C PDF size must be substantial (got ${sizeC} bytes)`);

  // Template A (Landscape Slides with client-side auto-fit JS)
  const htmlA = templateEngine.renderTemplateHtml('slides', sampleData);
  const pdfPathA = await pdf.generatePdfFromHtml(htmlA, { orientation: 'landscape' });
  assert.ok(fs.existsSync(pdfPathA), 'PDF file A must exist');
  const sizeA = fs.statSync(pdfPathA).size;
  fs.unlinkSync(pdfPathA);
  assert.ok(sizeA > 8000, `Template A PDF size must be substantial (got ${sizeA} bytes)`);
});

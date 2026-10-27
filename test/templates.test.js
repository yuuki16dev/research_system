'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const excel = require(path.join(ROOT, 'server', 'excel.js'));
const {
  resolveOptimalPdfTemplate,
  buildDecisionBriefHtml,
  buildSlideDeckHtml,
  buildPdfHtml,
} = require(path.join(ROOT, 'public', 'js', 'exporters.js'));

test('dual templates: resolveOptimalPdfTemplate correctly recommends decision-brief vs slide-deck', () => {
  // 意思決定フォーカス
  const rec1 = resolveOptimalPdfTemplate({
    title: '社内ナレッジ検索への生成AI導入可否',
    theme: 'AI導入',
    framework: { focus: 'decision' },
  });
  assert.strictEqual(rec1.template, 'decision-brief');
  assert.ok(rec1.label.includes('意思決定ペーパー'));

  // 役員要約フォーカス
  const rec2 = resolveOptimalPdfTemplate({
    title: '役員向け最新AI動向ブリーフィング',
    framework: { focus: 'brief' },
  });
  assert.strictEqual(rec2.template, 'decision-brief');

  // キーワードによる自動判定（承認・可否・GO/NO-GO）
  const rec3 = resolveOptimalPdfTemplate({
    title: '次期基幹システム移行計画の承認およびGO/NO-GO判定',
    theme: 'ERPリプレイス',
  });
  assert.strictEqual(rec3.template, 'decision-brief');

  // 技術・比較・市場フォーカス（スライド型）
  const rec4 = resolveOptimalPdfTemplate({
    title: '国内クラウドストレージ主要3方式の徹底比較分析',
    theme: 'クラウドインフラ',
    framework: { focus: 'comparison' },
  });
  assert.strictEqual(rec4.template, 'slide-deck');
  assert.ok(rec4.label.includes('スライド'));

  // デフォルト
  const rec5 = resolveOptimalPdfTemplate({});
  assert.strictEqual(rec5.template, 'slide-deck');
});

test('dual templates: buildDecisionBriefHtml generates valid A4 portrait 3-page document', () => {
  const mockData = {
    title: '社内ナレッジ検索への生成AI（RAG）導入可否',
    theme: 'ナレッジマネジメント / 生成AI',
    summary: 'SaaS型AI検索で3ヶ月のパイロットを開始し、検索時間30%短縮の達成を条件に全社展開へ進むべきである。',
    metrics: [
      { label: '3-Year Net', value: '+6,450万円', note: '3年累積純効果' },
      { label: 'Investment', value: '1,850万円', note: '初年度投資' },
      { label: 'Payback', value: '11ヶ月', note: '投資回収' },
      { label: 'Time Saved', value: '−38%', note: '工数削減率' },
    ],
    keyPoints: [
      '社員は1日平均47分を社内情報探しに消費している。',
      '大企業の本番導入率は41%へ急増し生産性格差が拡大。',
      'SaaS型で小さく始め成果確認後に全社展開する二段構えを推奨。',
    ],
    insights: [
      { title: '工数短縮効果の再現性', body: '先行各社で30〜45%の検索時間削減を確認。', kpi: '−38%', kpiLabel: '平均所要時間' },
      { title: '大企業での本番導入加速', body: '導入企業で新人立ち上がり期間が平均3週間短縮。', kpi: '41%', kpiLabel: '業界導入率' },
    ],
    table: {
      columns: ['方式', '精度', 'コスト', '速度', '権限', '初年度投資', '期間', '判定'],
      rows: [
        ['SaaS型AI検索', '○', '◎', '◎', '◎', '1,850万円', '2週間', '採用'],
        ['自社構築RAG', '◎', '△', '△', '○', '3,200万円', '4–6ヶ月', '次段階'],
      ],
    },
    sources: [
      { title: '国内AIソリューション市場規模予測', domain: 'market.example.com', score: 92, category: '公的機関' },
      { title: '企業向けAI検索サービス製品比較ガイド', domain: 'tech.example.net', score: 85, category: '専門メディア' },
    ],
    confidenceScore: 88,
  };

  const html = buildDecisionBriefHtml(mockData, { publisherName: 'Acme Research', confidentiality: 'CONFIDENTIAL' });
  assert.ok(html.includes('class="doc"'), 'Root element must have .doc class');
  assert.ok(html.includes('class="page first"'), 'Must have first page');
  assert.ok(html.includes('data-section="Decision"'), 'Page 1 section must be Decision');
  assert.ok(html.includes('data-section="Evidence & Risk"'), 'Page 2 section must be Evidence & Risk');
  assert.ok(html.includes('data-section="Action & Sign-off"'), 'Page 3 section must be Action & Sign-off');
  assert.ok(html.includes('Acme Research'), 'Must include custom publisher name');
  assert.ok(html.includes('CONFIDENTIAL'), 'Must include confidentiality tag');
  assert.ok(html.includes('GO'), 'Must include verdict');
  assert.ok(html.includes('class="score-ring"'), 'Must include SVG confidence ring');
  assert.ok(html.includes('class="heat"'), 'Must include risk heatmap');
  assert.ok(html.includes('class="signoff"'), 'Must include decision record sign-off box');
});

test('dual templates: buildPdfHtml properly dispatches between slide-deck and decision-brief', () => {
  const mockData = { title: '統合テスト' };
  const htmlDeck = buildPdfHtml(mockData, 'Test Brand', 'slide-deck');
  assert.ok(htmlDeck.includes('class="deck"'), 'slide-deck must produce .deck');
  assert.ok(htmlDeck.includes('class="slide cover"'), 'slide-deck must produce .slide cover');

  const htmlBrief = buildPdfHtml(mockData, 'Test Brand', 'decision-brief');
  assert.ok(htmlBrief.includes('class="doc"'), 'decision-brief must produce .doc');
  assert.ok(htmlBrief.includes('class="page first"'), 'decision-brief must produce .page first');
});

test('excel engine: transformDataToExcelFormat and generateExcelReport produce commercial grade workbook', async () => {
  const mockData = {
    title: '社内ナレッジ検索への生成AI導入評価',
    subtitle: '主要方式の比較分析と導入ロードマップ',
    theme: '生成AI / ナレッジマネジメント',
    summary: 'SaaS型AI検索で小さく始め、3ヶ月の検証後に全社展開へ移行する二段構えを推奨。',
    metrics: [
      { label: '国内市場規模', value: '1.2兆円', note: '2026年見込み' },
      { label: '年間成長率', value: '+18.5%', note: '2026-2030 CAGR' },
      { label: '導入コスト', value: '月額9.8万', note: 'SaaS型中央値' },
      { label: '信頼度', value: '92%', note: '一次情報裏付け' },
    ],
    table: {
      caption: '主要方式の比較マトリクス',
      columns: ['項目名', 'SaaS型AI検索', '自社構築RAG', '既存検索連携', '選定基準', '推奨度'],
      rows: [
        ['要件適合度', '◎', '○', '△', '業務網羅性', '◎ 推奨'],
        ['導入期間', '2週間', '4–6ヶ月', '1–2ヶ月', '稼働リードタイム', '◎ 推奨'],
      ],
    },
    sources: [
      { title: '市場予測レポート', url: 'https://example.com/s1', score: 94, domain: 'example.com' },
      { title: '製品比較ガイド', url: 'https://example.com/s2', score: 78, domain: 'example.net' },
      { title: '活用実態調査', url: 'https://example.com/s3', score: 55, domain: 'example.org' },
    ],
    confidenceScore: 92,
  };

  const brand = {
    publisherName: 'Enterprise Studio',
    confidentiality: 'SECRET / 社内限定',
  };

  // 1. データ構造アダプターの検証
  const formatted = excel.transformDataToExcelFormat(mockData, brand);
  assert.strictEqual(formatted.meta.title, mockData.title);
  assert.strictEqual(formatted.meta.publisher, 'Enterprise Studio');
  assert.strictEqual(formatted.meta.classification, 'SECRET / 社内限定');
  assert.strictEqual(formatted.metrics.length, 4);
  assert.ok(formatted.summary.conclusion.includes('SaaS型'));
  assert.ok(formatted.summary.issues.length > 0);
  assert.ok(formatted.summary.actions.length > 0);
  assert.strictEqual(formatted.comparison.options.length, 3);
  assert.strictEqual(formatted.sources.length, 3);

  // 2. ExcelJS バッファ生成の検証
  const buffer = await excel.generateExcelReport(mockData, brand);
  assert.ok(Buffer.isBuffer(buffer), 'Output must be Buffer');
  assert.ok(buffer.length > 8000, `Buffer size (${buffer.length} bytes) must be substantial`);

  // 3. 生成されたワークブック構造を再度読み込んで詳細検証
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  assert.strictEqual(wb.creator, 'Enterprise Studio');

  const sheetNames = wb.worksheets.map((ws) => ws.name);
  assert.deepStrictEqual(sheetNames, ['Executive_Summary', 'Comparison_Matrix', 'Source_Index']);

  // Sheet 1: Executive_Summary
  const ws1 = wb.getWorksheet('Executive_Summary');
  assert.strictEqual(ws1.getCell('A1').value, mockData.title);
  assert.ok(ws1.getCell('G1').value.includes('CONFIDENCE'));
  assert.strictEqual(ws1.pageSetup.orientation, 'landscape');

  // Sheet 2: Comparison_Matrix
  const ws2 = wb.getWorksheet('Comparison_Matrix');
  assert.strictEqual(ws2.getCell('A1').value, '主要方式の比較マトリクス');
  assert.ok(ws2.getCell('B3').value.includes('SaaS型AI検索'));
  assert.ok(ws2.views[0].state === 'frozen', 'Window pane must be frozen');

  // Sheet 3: Source_Index
  const ws3 = wb.getWorksheet('Source_Index');
  assert.strictEqual(ws3.getCell('A4').value, 'S1');
  assert.strictEqual(ws3.getCell('B4').value, '市場予測レポート');
  assert.strictEqual(ws3.getCell('C4').value, 94);
  assert.ok(ws3.getCell('E4').value.formula.includes('HYPERLINK'), 'URL cell must use HYPERLINK formula');
  assert.ok(ws3.conditionalFormattings.length > 0, 'Must have conditional formatting rules');
});

test('pdf generation: generatePdfFromHtml produces substantial non-blank PDF files with content intact', async () => {
  const fs = require('fs');
  const pdfModule = require(path.join(ROOT, 'server', 'pdf.js'));

  // システムブラウザが存在する場合のみ実行（CI/ローカル共通）
  const browserPath = pdfModule.findSystemBrowser();
  if (!browserPath) {
    return; // ブラウザ未インストールのコンテナ環境ではスキップ
  }

  const mockData = {
    title: '意思決定ペーパーPDFテスト',
    theme: 'AIリサーチ',
    summary: '白紙出力バグを防止するための自動検証テストです。',
    metrics: [{ label: 'Score', value: '98%' }],
    keyPoints: ['ポイント1', 'ポイント2'],
    table: { columns: ['A', 'B'], rows: [['1', '2']] },
    sources: [{ title: 'Source 1', domain: 'example.com', score: 90 }],
  };

  // 1. スライド型
  const slideHtml = buildSlideDeckHtml(mockData);
  const slidePdf = await pdfModule.generatePdfFromHtml(slideHtml, { orientation: 'landscape' });
  assert.ok(fs.existsSync(slidePdf), 'Slide PDF file must exist');
  const slideSize = fs.statSync(slidePdf).size;
  fs.unlinkSync(slidePdf);
  assert.ok(slideSize > 8000, `Slide PDF must not be blank (got ${slideSize} bytes)`);

  // 2. ペーパー型
  const paperHtml = buildDecisionBriefHtml(mockData);
  const paperPdf = await pdfModule.generatePdfFromHtml(paperHtml, { orientation: 'portrait' });
  assert.ok(fs.existsSync(paperPdf), 'Paper PDF file must exist');
  const paperSize = fs.statSync(paperPdf).size;
  fs.unlinkSync(paperPdf);
  assert.ok(paperSize > 8000, `Paper PDF must not be blank (got ${paperSize} bytes)`);
});


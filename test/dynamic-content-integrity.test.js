'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const excel = require(path.join(ROOT, 'server', 'excel.js'));
const {
  buildSlideDeckHtml,
  buildDecisionBriefHtml,
} = require(path.join(ROOT, 'public', 'js', 'exporters.js'));

test('distortion-free: PDF slide deck reflects exact dynamic table columns and cell values without fixed schema', () => {
  const dynamicData = {
    title: '最新LLM推論基盤の比較評価',
    theme: 'AIモデル選定',
    summary: '一次情報に忠実な推論パフォーマンスとAPI料金の分析結果。',
    table: {
      caption: 'モデル別スペックおよびコスト詳細比較',
      columns: ['モデル名', 'コンテキスト長', '入力コスト(1M)', '出力コスト(1M)', '推奨用途'],
      rows: [
        ['Gemini 1.5 Pro', '2,000,000 tokens', '$3.50', '$10.50', '超長文コンテキスト解析・マルチモーダル'],
        ['Claude 3.5 Sonnet', '200,000 tokens', '$3.00', '$15.00', '高度コーディング・複雑推論・エージェント'],
        ['GPT-4o', '128,000 tokens', '$2.50', '$10.00', '汎用高速タスク・音声対話'],
      ],
    },
    sections: [
      {
        heading: '1. トークン処理性能と推論レイテンシの実測値',
        body: '公式ベンチマークおよび独立検証データによると、各モデルのTTFT（Time To First Token）は大幅に改善されています。',
        bullets: ['Gemini 1.5 Pro: 長文でも安定したスループットを維持', 'Claude 3.5 Sonnet: コード生成で圧倒的な成功率を記録'],
      },
    ],
    sources: [
      { title: 'Google DeepMind Technical Report', url: 'https://example.com/gemini', score: 98, domain: 'deepmind.google' },
      { title: 'Anthropic Model Card', url: 'https://example.com/claude', score: 95, domain: 'anthropic.com' },
    ],
  };

  const html = buildSlideDeckHtml(dynamicData);

  // 1. スライド3に動的ヘッダーが完全に出力されているか
  assert.ok(html.includes('モデル名'), 'Slide deck must include dynamic column: モデル名');
  assert.ok(html.includes('コンテキスト長'), 'Slide deck must include dynamic column: コンテキスト長');
  assert.ok(html.includes('入力コスト(1M)'), 'Slide deck must include dynamic column: 入力コスト(1M)');
  assert.ok(html.includes('推奨用途'), 'Slide deck must include dynamic column: 推奨用途');

  // 2. 旧来の固定決め打ち列（総合・精度・コスト・導入速度・権限管理）にすり替わっていないこと
  assert.ok(!html.includes('<th>導入速度</th>') && !html.includes('<th>権限管理</th>'), 'Must not inject obsolete hardcoded table headers');

  // 3. セル値が勝手な「◎○△」に歪曲されず、一次情報の文字列がそのまま入っていること
  assert.ok(html.includes('2,000,000 tokens'), 'Slide deck must contain exact cell value: 2,000,000 tokens');
  assert.ok(html.includes('$3.50'), 'Slide deck must contain exact cell value: $3.50');
  assert.ok(html.includes('高度コーディング・複雑推論・エージェント'), 'Slide deck must contain exact cell value');
});

test('distortion-free: PDF decision brief eliminates fabricated metrics and faithfully renders actual table', () => {
  const customData = {
    title: 'エッジAI推論チップ導入の採否判定',
    theme: 'ハードウェア選定',
    summary: 'エッジデバイスでのリアルタイム推論に向けた専用アクセラレータ導入の是非。',
    metrics: [
      { label: '消費電力', value: '15W', note: '従来比 −40%' },
      { label: '推論遅延', value: '8.2ms', note: '要件10ms以内クリア' },
      { label: '単価', value: '$85', note: '量産時見積もり' },
    ],
    table: {
      columns: ['チップ型番', 'TOPS', '消費電力', '開発容易性', '判定'],
      rows: [
        ['Chip-Alpha', '40 TOPS', '15W', '高 (SDK完備)', '採用候補'],
        ['Chip-Beta', '26 TOPS', '10W', '中 (オープンソース)', '保留'],
      ],
    },
    sources: [
      { title: 'ベンダー仕様書', url: 'https://example.com/spec', score: 90, domain: 'chip-vendor.com' },
    ],
  };

  const html = buildDecisionBriefHtml(customData);

  // 1. 架空のダミー数値（3-Year Net +6,450万円 等）が捏造されていないこと
  assert.ok(!html.includes('6,450万円'), 'Must not contain fabricated +6,450万円');
  assert.ok(!html.includes('1,850万円'), 'Must not contain fabricated 1,850万円');

  // 2. 提供された本物のメトリクスが出力されていること
  assert.ok(html.includes('消費電力'), 'Must contain actual metric label: 消費電力');
  assert.ok(html.includes('15'), 'Must contain actual metric value: 15');
  assert.ok(html.includes('8.2'), 'Must contain actual metric value: 8.2');
  assert.ok(html.includes('ms'), 'Must contain actual metric unit: ms');

  // 3. 提供されたテーブルが忠実に出力されていること
  assert.ok(html.includes('Chip-Alpha'), 'Must contain actual table item: Chip-Alpha');
  assert.ok(html.includes('40 TOPS'), 'Must contain actual table value: 40 TOPS');
  assert.ok(html.includes('採用候補'), 'Must contain actual verdict: 採用候補');
});

test('distortion-free: Excel engine creates 4 sheets including Detailed_Report with full unabridged sections', async () => {
  const fullData = {
    title: '次世代Web開発フレームワーク技術調査',
    theme: 'フロントエンド技術',
    summary: 'フルスタックSSR/SSGフレームワークのパフォーマンスおよび開発者体験の徹底比較。',
    metrics: [
      { label: 'Lighthouse Score', value: '98/100', note: '中央値' },
      { label: 'ビルド時間', value: '12秒', note: 'Turbopack' },
    ],
    table: {
      caption: '主要フレームワークのアーキテクチャ特性比較',
      columns: ['フレームワーク', 'レンダリング方式', 'バンドラー', 'バンドルサイズ', '選定基準'],
      rows: [
        ['Next.js App Router', 'RSC / Hybrid', 'Turbopack', '84KB', 'エンタープライズ規模の拡張性'],
        ['Remix (React Router 7)', 'SSR / Islands', 'Vite', '62KB', 'Web標準準拠・データローディング'],
        ['Astro', 'Islands Architecture', 'Vite', '0KB (デフォルトJSゼロ)', 'コンテンツリッチサイト最適'],
      ],
    },
    sections: [
      {
        heading: '1. レンダリングモデルとHydrationコストの定量的検証',
        body: '近年のフロントエンド潮流において、クライアントに送信するJavaScript量を最小化するアイランドアーキテクチャやReact Server Components（RSC）が主流化しています。\n\nこれにより初回ロード時のTBT（Total Blocking Time）が平均50%以上削減されます。',
        bullets: [
          'RSCはサーバー側でコンポーネントツリーをシリアライズしクライアントJSを削減',
          'Astroは必要なインタラクティブコンポーネントのみを部分的にHydrate',
        ],
      },
      {
        heading: '2. 開発体験（DX）とエコシステムおよびライブラリ互換性',
        body: 'エコシステムの成熟度においてはNext.jsが優勢を維持する一方、Viteエコシステムの急速な発展によりRemixやAstroのビルド体験が急速に向上しています。',
        bullets: [
          'Viteプラグイン資産の活用が可能なフレームワークの保守性が向上',
          'デプロイ環境のベンダーロックイン回避が重要要件として浮上',
        ],
      },
    ],
    sources: [
      { title: 'State of JS Survey', url: 'https://stateofjs.com', score: 95, domain: 'stateofjs.com' },
      { title: 'Vercel Performance Report', url: 'https://vercel.com/blog', score: 90, domain: 'vercel.com' },
    ],
  };

  const buffer = await excel.generateExcelReport(fullData, { publisherName: 'Tech Research Lab' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // 1. シート構成が4シートになっていること
  const sheetNames = wb.worksheets.map((ws) => ws.name);
  assert.deepStrictEqual(sheetNames, [
    'Executive_Summary',
    'Comparison_Matrix',
    'Detailed_Report',
    'Source_Index',
  ]);

  // 2. Comparison_Matrix に動的テーブルの列とセルが忠実に出力されていること
  const wsCmp = wb.getWorksheet('Comparison_Matrix');
  assert.strictEqual(wsCmp.getCell('A1').value, '主要フレームワークのアーキテクチャ特性比較');
  assert.strictEqual(wsCmp.getCell('A3').value, 'フレームワーク');
  assert.strictEqual(wsCmp.getCell('B3').value, 'レンダリング方式');
  assert.strictEqual(wsCmp.getCell('C3').value, 'バンドラー');
  assert.strictEqual(wsCmp.getCell('D3').value, 'バンドルサイズ');
  assert.strictEqual(wsCmp.getCell('E3').value, '選定基準');
  assert.strictEqual(wsCmp.getCell('A4').value, 'Next.js App Router');
  assert.strictEqual(wsCmp.getCell('B4').value, 'RSC / Hybrid');
  assert.strictEqual(wsCmp.getCell('C4').value, 'Turbopack');

  // 3. Detailed_Report シートにセクション見出し・詳細本文・箇条書きが100%格納されていること
  const wsSec = wb.getWorksheet('Detailed_Report');
  assert.ok(wsSec.getCell('A1').value.includes('詳細調査セクション'));
  assert.strictEqual(wsSec.getCell('A4').value, '§1');
  assert.strictEqual(wsSec.getCell('B4').value, '1. レンダリングモデルとHydrationコストの定量的検証');
  assert.ok(wsSec.getCell('C4').value.includes('アイランドアーキテクチャやReact Server Components'));
  assert.ok(wsSec.getCell('D4').value.includes('• RSCはサーバー側でコンポーネントツリーをシリアライズ'));
  assert.strictEqual(wsSec.getCell('B5').value, '2. 開発体験（DX）とエコシステムおよびライブラリ互換性');
  assert.ok(wsSec.getCell('C5').value.includes('Viteエコシステムの急速な発展'));
});

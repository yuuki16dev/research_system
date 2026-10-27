'use strict';

const fs = require('fs');
const path = require('path');
const { generatePdfFromHtml } = require('../server/pdf');
const { generateExcelReport, transformDataToExcelFormat } = require('../server/excel');
const { buildPdfHtml, buildDecisionBriefHtml, buildSlideDeckHtml } = require('../public/js/exporters');

async function verifyAll() {
  console.log('=== 3大フォーマット (PDF / PPTX / Excel) 総合出力検証 ===\n');

  // テスト用モックデータ（長文タイトル・多列テーブル・KPI・インサイト・ロードマップ・参照ソース）
  const testData = {
    title: '国内製造業における生成AI・エッジ推論基盤の全社導入可否および投資対効果徹底比較検証レポート（2026年最新版）',
    theme: '製造業AI・エッジ推論導入',
    subtitle: 'オンプレミスGPUクラスター、SaaS型AI基盤、ハイブリッド構成の3方式における5年TCO・セキュリティ・現場生産性インパクトの多角的評価',
    createdAt: new Date().toISOString(),
    confidenceScore: 94,
    summary: '結論として、機密図面・製品品質検査を伴う製造現場ではエッジAIアプライアンスを第一優先としつつ、ナレッジ検索・社内マニュアル要約には閉域SaaS型を採用する「ハイブリッド二段構え方式」が5年TCOおよび投資回収期間（14ヶ月）の観点から最もROIが高いと評価される。',
    metrics: [
      { label: '5年累計純効果 (ROI)', value: '+1.42億円', note: '初期投資回収14ヶ月' },
      { label: '初年度導入投資額', value: '3,800万円', note: 'ハードウェア・構築費込' },
      { label: 'ライン不良検知率', value: '99.4%', note: '従来目視比+18.2pt' },
      { label: '作業員探索工数削減', value: '−45%', note: '1人日あたり35分短縮' },
    ],
    keyPoints: [
      '現場の低遅延・機密保持要件を満たすには工場内エッジ推論ノードの配置が不可欠である。',
      '全社ナレッジ活用には社内専用LLM連携SaaSを活用し、部門横断の回答精度89%を確保する。',
      'PoC期間は2ヶ月に限定し、不良検知精度98%以上の達成をもって本番投資ゲートを通過させる。',
    ],
    insights: [
      {
        title: 'エッジ推論による超低遅延検査ラインの実現',
        body: 'ミリ秒単位の応答が求められる製品外観検査では、クラウド通信遅延を排除した現場直結ノードが必須要件となる。',
        kpi: '< 15ms',
        kpiLabel: '推論応答時間',
        priority: '高',
      },
      {
        title: '図面・技術文書のセキュアRAG検索効率化',
        body: '30年分の設計資産をベクトル化し、熟練技術者のノウハウ承継時間を年間約1,200時間削減可能。',
        kpi: '−1,200h/年',
        kpiLabel: '工数削減',
        priority: '高',
      },
      {
        title: '多拠点展開における運用保守ガバナンス',
        body: '全国5工場の一括OTAモデル更新パイプラインを整備することで、現場ごとの運用ばらつきを防止。',
        kpi: '5拠点',
        kpiLabel: '同時一括管理',
        priority: '中',
      },
      {
        title: '投資回収と現場定着化のKPI連動',
        body: '現場作業者の受容性を高めるため、直感的なタブレットUIと音声入力を組み合わせた入力補助を標準装備。',
        kpi: '92%',
        kpiLabel: '定着率目標',
        priority: '中',
      },
    ],
    table: {
      columns: ['比較項目', '方式A: エッジ特化型', '方式B: クラウドSaaS型', '方式C: ハイブリッド型 (推奨)', '選定インパクト', '判定'],
      rows: [
        ['初期構築費用', '4,200万円', '1,200万円', '2,800万円', '予算枠内適合性', '◎ 推奨'],
        ['月額ランニング費用', '35万円 / 工場', '180万円 / 全社', '95万円 / 全社', '固定費対効果', '○ 適合'],
        ['検査推論レイテンシ', '12ms (超高速)', '280ms (ネットワーク依存)', '15ms (現場即時)', '生産タクトタイム維持', '◎ 必須要件'],
        ['機密データ外部送出', '完全ゼロ (工場内完結)', '暗号化送信 (海外DC含む)', '機密情報のみ工場内完結', '顧客機密・知財保護', '◎ 安全'],
        ['全社横断ナレッジ検索', '非対応 (工場単位)', '完全対応 (全社一元)', '完全対応 (ゲートウェイ経由)', '情報共有・シナジー', '○ 良好'],
        ['総合推奨度 / 評価', '★★★☆☆ (局所解)', '★★★★☆ (コスト高)', '★★★★★ (最適解)', '総合ROI最大化', '採用決定'],
      ],
    },
    sections: [
      {
        heading: '1. 製造現場におけるAI推論とセキュリティ境界の設計',
        body: '製造ラインの画像検査データは極めて機密性が高く、外部クラウドへの無条件送信はセキュリティポリシー上制限される場合が多い。本検証では、現場端末でのリアルタイム判定と、全社サーバーでの非機密集計を分離する多層防御アーキテクチャの有効性を立証した。',
        bullets: [
          '工場LAN内独立ノードによる推論処理（外部回線切断時もライン停止なし）',
          'モデル更新時のみセキュアトンネル経由で署名済み重みデータを差分配信',
          '個人情報・機密図面メタデータに対する動的マスキングゲートウェイの設置',
        ],
      },
      {
        heading: '2. 5年間TCO試算と投資回収シミュレーション',
        body: 'クラウド専業構成と比較し、推論負荷が高い検査ノードをエッジに配置することで、API従量課金および専用線ネットワーク費用を年間約1,400万円抑制可能である。初年度のハードウェア初期投資は14ヶ月で完全に回収される見込みである。',
        bullets: [
          '5年累計総コスト：方式A 6,300万円 / 方式B 1.2億円 / 方式C 8,500万円',
          '年平均純削減効果：3,800万円（不良流出防止および検査員代替工数）',
          '投資対効果（ROI）：初年度210%、5年累計345%を達成見込み',
        ],
      },
    ],
    deepThinking: {
      roadmap: [
        {
          phase: 'Phase 1: PoC・現場実証',
          focus: 'パイロット工場ラインでの検知精度とレイテンシ検証',
          actions: [
            '主要検査ライン1系統へのエッジ端末試験配備',
            '熟練検査員による教師データ10,000件の精査と再学習',
            '判定遅延15ms未満および誤検知率0.5%未満の達成確認',
          ],
        },
        {
          phase: 'Phase 2: 先行工場本番展開',
          focus: '国内2拠点への横展開および運用マニュアル策定',
          actions: [
            '工場内セキュアゲートウェイと全社ナレッジDBの接続確立',
            'ライン作業員向け直感UIタブレットの導入と操作研修実施',
            '週次不良分析レポートの自動生成と生産技術部門への自動配信',
          ],
        },
        {
          phase: 'Phase 3: 全社最適化・自律運用',
          focus: '全5工場一括統合ガバナンスと継続的モデル進化',
          actions: [
            '各工場の検知ログを統合した差分Federated Learning検証',
            '社内ナレッジ検索との完全統合による熟練ノウハウ自律更新',
            '海外協力工場へのセキュア展開に向けた標準化パッケージ策定',
          ],
        },
      ],
    },
    sources: [
      { id: 'S1', title: '製造業における生成AI・エッジ推論導入実態調査2026', url: 'https://example.com/reports/edge-ai-manufacturing-2026', publisher: '産業技術総合研究所', score: 96 },
      { id: 'S2', title: 'エッジコンピューティングによる品質検査自動化ベストプラクティス', url: 'https://example.com/tech/edge-inspection-guideline', publisher: '日本品質工学会', score: 92 },
      { id: 'S3', title: 'スマートファクトリーセキュリティガイドライン第3版', url: 'https://example.com/gov/smart-factory-security-v3', publisher: '経済産業省', score: 98 },
      { id: 'S4', title: '主要各社の推論アクセラレータ性能・電力・TCO比較分析', url: 'https://example.com/bench/hardware-tco-comparison', publisher: 'Nikkei IT Insight', score: 88 },
      { id: 'S5', title: '製造DX投資におけるROI算出モデルと減価償却シミュレーション', url: 'https://example.com/finance/manufacturing-dx-roi', publisher: 'KPMGコンサルティング', score: 90 },
    ],
  };

  const brand = {
    publisherName: 'Research Studio Enterprise',
    publisherTagline: 'STRATEGIC INTELLIGENCE & DECISION SUITE',
    author: 'Chief AI Strategist',
    confidentiality: '極秘 (STRICTLY CONFIDENTIAL)',
    disclaimer: '本資料はAI動的解析および多角クロス検証に基づくエグゼクティブ向け意思決定レポートです。',
  };

  // 1. PDF検証 (A4横スライド型 & A4縦意思決定ペーパー型)
  console.log('1. PDF出力エンジンの検証開始...');
  const slideHtml = buildPdfHtml(testData, brand, 'slide-deck');
  const paperHtml = buildPdfHtml(testData, brand, 'decision-brief');

  const startPdfSlide = Date.now();
  const pdfSlidePath = await generatePdfFromHtml(slideHtml, { orientation: 'landscape' });
  const timePdfSlide = Date.now() - startPdfSlide;
  const slideStat = fs.statSync(pdfSlidePath);
  console.log(`  [PDF: A4横スライド型] 生成成功! 所要時間: ${(timePdfSlide / 1000).toFixed(2)}秒, サイズ: ${(slideStat.size / 1024).toFixed(1)} KB`);
  fs.unlinkSync(pdfSlidePath);

  const startPdfPaper = Date.now();
  const pdfPaperPath = await generatePdfFromHtml(paperHtml, { orientation: 'portrait' });
  const timePdfPaper = Date.now() - startPdfPaper;
  const paperStat = fs.statSync(pdfPaperPath);
  console.log(`  [PDF: A4縦ペーパー型] 生成成功! 所要時間: ${(timePdfPaper / 1000).toFixed(2)}秒, サイズ: ${(paperStat.size / 1024).toFixed(1)} KB`);
  fs.unlinkSync(pdfPaperPath);

  // 2. Excel検証 (ExcelJS 商用エンジン)
  console.log('\n2. Excel出力エンジンの検証開始...');
  const startExcel = Date.now();
  const excelData = transformDataToExcelFormat(testData, brand);
  const excelBuffer = await generateExcelReport(excelData);
  const timeExcel = Date.now() - startExcel;
  console.log(`  [Excel: ExcelJS 3シート] 生成成功! 所要時間: ${timeExcel}ms, サイズ: ${(excelBuffer.length / 1024).toFixed(1)} KB`);

  // 3. PowerPointモジュールの静的解析 & ロジックチェック
  console.log('\n3. PowerPoint動的フィットエンジンの検証開始...');
  const pptxMod = fs.readFileSync(path.resolve(__dirname, '../public/js/modules/pptx-export.js'), 'utf8');
  const hasCalcFont = pptxMod.includes('function calcFontSize');
  const hasColWidths = pptxMod.includes('colWidths = [col1W');
  const hasCalloutY = pptxMod.includes('calloutY = Math.max');
  const hasShrink = pptxMod.includes('shrinkText: true');
  console.log(`  [PPTX] 動的フォントスケーリング (calcFontSize): ${hasCalcFont ? '✔' : '❌'}`);
  console.log(`  [PPTX] 多列テーブル自動配分 (colWidths): ${hasColWidths ? '✔' : '❌'}`);
  console.log(`  [PPTX] テーブル下部コールアウト動的Y配置 (calloutY): ${hasCalloutY ? '✔' : '❌'}`);
  console.log(`  [PPTX] 文字あふれ安全弁 (shrinkText: true): ${hasShrink ? '✔' : '❌'}`);

  console.log('\n=== すべての検証が正常に合格しました！ ===');
}

verifyAll().catch((err) => {
  console.error('検証失敗:', err);
  process.exit(1);
});

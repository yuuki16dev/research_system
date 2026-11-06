'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const excel = require(path.join(ROOT, 'server', 'excel.js'));

test('new commercial excel: generateCommercialExcel builds 4-sheet workbook with zero data loss', async () => {
  const sampleData = {
    title: '次世代商用推論基盤の比較検証',
    theme: 'AI推論最適化',
    publisher: 'Research Studio Pro',
    confidenceScore: 94,
    summary: '一次情報に忠実な推論パフォーマンスおよびコスト対効果の詳細分析。',
    metrics: [
      { label: 'TTFT中央値', value: '180ms', note: '業界最高水準' },
      { label: '推論コスト削減率', value: '38%', note: 'バッチ処理時' },
    ],
    decision: {
      verdict: 'go',
      question: '次世代基盤への全面移行承認',
      asks: ['移行プロジェクト予算の承認', '専任エンジニアのアサイン'],
    },
    table: {
      caption: '主要推論基盤ベンチマーク比較',
      columns: ['基盤名', '初回応答(TTFT)', 'スループット', '単価/1M tok', '判定'],
      rows: [
        ['Gemini 1.5 Pro', '180ms', '120 tok/s', '$1.25', '◎ 推奨'],
        ['Claude 3.5 Sonnet', '210ms', '115 tok/s', '$3.00', '○ 適合'],
        ['GPT-4o', '250ms', '95 tok/s', '$2.50', '○ 適合'],
      ],
    },
    sections: [
      {
        heading: '第1章：市場背景とアーキテクチャ特性',
        body: '最新の大規模言語モデル推論基盤における最適化手法の発展は著しく、TTFT（Time To First Token）の短縮がUXの鍵となっています。',
        bullets: ['KVキャッシュ圧縮技術の進歩', '投機的デコーディングの実装拡大'],
      },
      {
        heading: '第2章：コスト・性能トレードオフの定量的評価',
        body: '単価あたりのトークン生成スループットを計測した結果、バッチ推論においては著しい効率化が観測されました。',
      },
    ],
    sources: [
      { id: 'S1', title: '推論基盤ベンチマーク白書', publisher: 'AI Institute', score: 96, url: 'https://example.com/ai-report' },
      { id: 'S2', title: '次世代LLMコスト分析', publisher: 'Tech Research', score: 91, url: 'https://example.com/cost-analysis' },
    ],
  };

  // 1. ワークブック生成
  const wb = await excel.generateCommercialExcel(sampleData);
  assert.ok(wb instanceof ExcelJS.Workbook, 'Must return ExcelJS.Workbook');

  // 2. シート構成の検証（01〜04の連番付きエグゼクティブ構成）
  const sheetNames = wb.worksheets.map((ws) => ws.name);
  assert.deepStrictEqual(sheetNames, [
    '01_Executive_Summary',
    '02_Comparison_Matrix',
    '03_Detailed_Report',
    '04_Sources_Data',
  ]);

  // 3. データ欠落ゼロ（No Data Loss）の自動検証
  const lossCheck = excel.verifyNoDataLoss(sampleData, wb);
  assert.strictEqual(lossCheck.ok, true, `Must have zero data loss, missing: ${JSON.stringify(lossCheck.missing)}`);
  assert.ok(lossCheck.checked >= 30, 'Must check all data fields');

  // 4. 動的数式とリンクの検証
  const wsSum = wb.getWorksheet('01_Executive_Summary');
  assert.ok(wsSum, 'Must retrieve 01_Executive_Summary');
  assert.ok(wsSum.getCell('B1').value.includes('次世代商用推論基盤の比較検証'));

  // 5. 比較表の動的生成検証
  const wsMat = wb.getWorksheet('02_Comparison_Matrix');
  assert.ok(wsMat, 'Must retrieve 02_Comparison_Matrix');
  assert.strictEqual(wsMat.getCell('B5').value, '基盤名');
  assert.strictEqual(wsMat.getCell('F5').value, '判定');

  // 6. 出典シートの検証
  const wsSrc = wb.getWorksheet('04_Sources_Data');
  assert.ok(wsSrc, 'Must retrieve 04_Sources_Data');
  assert.strictEqual(wsSrc.getCell('C6').value, '推論基盤ベンチマーク白書');
});

test('new commercial excel: generateExcelReport returns valid buffer using commercial engine', async () => {
  const mockData = {
    title: 'エグゼクティブバッファテスト',
    theme: '自動テスト',
    summary: '商用バッファ生成の検証。',
  };

  const buffer = await excel.generateExcelReport(mockData, { reportTheme: 'ocean' });
  assert.ok(Buffer.isBuffer(buffer), 'Output must be Buffer');
  assert.ok(buffer.length > 5000, `Buffer size must be substantial (got ${buffer.length} bytes)`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.ok(wb.worksheets.length >= 4, 'Must contain 4 commercial sheets');
  assert.ok(wb.getWorksheet('01_Executive_Summary'), 'Must contain 01_Executive_Summary');
});


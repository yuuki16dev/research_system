'use strict';

const ExcelJS = require('exceljs');

/**
 * プロフェッショナル・エクセル帳票生成エンジン
 * クイック（Standard）用およびディープ（Deep）用の高品位テンプレートに
 * リサーチデータを注入し、A4横向き印刷・ゼブラマトリクス・KPIカードを備えた
 * 商用レベルの .xlsx ファイルを生成する。
 */

const FONT_FAMILY = 'BIZ UDPGothic, Meiryo, sans-serif';

// スタイルパレット定数
const COLORS = {
  headerBg: 'FF0F172A',       // 最上部メインヘッダー（スレートブラック/濃紺）
  headerText: 'FFFFFFFF',     // 白文字
  subHeaderBg: 'FF1E293B',    // セクション見出し（ダークネイビー）
  subHeaderText: 'FFFFFFFF',
  accentBand: 'FFE0E7FF',     // アクセント帯（ペールインディゴ）
  accentText: 'FF3730A3',     // インディゴ文字
  kpiBg: 'FFF8FAFC',          // KPIカード背景（薄グレー）
  kpiValue: 'FF0284C7',       // KPI数値（スカイブルー）
  tableHeaderBg: 'FF1E293B',  // 比較テーブル見出し
  zebraBg: 'FFF8FAFC',        // テーブル偶数行
  borderLight: 'FFE2E8F0',    // 極細境界線
  borderMedium: 'FFCBD5E1',   // 中太枠線
  linkBlue: 'FF2563EB',       // リンク青
};

const BORDER_THIN = {
  top: { style: 'thin', color: { argb: COLORS.borderLight } },
  left: { style: 'thin', color: { argb: COLORS.borderLight } },
  bottom: { style: 'thin', color: { argb: COLORS.borderLight } },
  right: { style: 'thin', color: { argb: COLORS.borderLight } },
};

const BORDER_CARD = {
  top: { style: 'medium', color: { argb: COLORS.borderMedium } },
  left: { style: 'medium', color: { argb: COLORS.borderMedium } },
  bottom: { style: 'medium', color: { argb: COLORS.borderMedium } },
  right: { style: 'medium', color: { argb: COLORS.borderMedium } },
};

/**
 * 日付フォーマット
 */
function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${Y}/${M}/${D} ${h}:${m}`;
  } catch {
    return String(iso);
  }
}

/**
 * ワークシートのA4横向き印刷・グリッド線設定
 */
function setupWorksheetPrint(ws) {
  ws.views = [{ showGridLines: true }];
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.5,
      right: 0.5,
      top: 0.6,
      bottom: 0.6,
      header: 0.3,
      footer: 0.3,
    },
  };
}

/**
 * 商用レポート Excel Buffer 生成
 * @param {Object} data リサーチデータ
 * @param {Object} brand ブランド・ホワイトラベル設定
 * @returns {Promise<Buffer>}
 */
async function generateExcelReport(data, brand = {}) {
  const isDeep = Boolean(data.deepThinking) || data.depth === 'deep';
  const wb = new ExcelJS.Workbook();
  wb.creator = (brand && brand.publisherName) || 'Research Studio';
  wb.created = new Date();

  const publisher = (brand && brand.publisherName) || 'Research Studio';
  const tagline = (brand && brand.publisherTagline) || '';
  const author = (brand && brand.author) || '';
  const confidentiality = (brand && brand.confidentiality) || '';
  const disclaimer = (brand && brand.disclaimer) || '本レポートはWeb検索およびAI推論パイプラインによって収集・構造化されたリサーチ帳票です。';

  // =========================================================================
  // Sheet 1: 📊 エグゼクティブサマリー (Overview Dashboard)
  // =========================================================================
  const ws1 = wb.addWorksheet('📊 エグゼクティブサマリー');
  setupWorksheetPrint(ws1);

  // 列幅定義
  ws1.columns = [
    { width: 22 }, // A
    { width: 34 }, // B
    { width: 34 }, // C
    { width: 34 }, // D
  ];

  // 1行目: 最上部ヘッダー帯
  ws1.mergeCells('A1:D1');
  const h1 = ws1.getCell('A1');
  h1.value = `◆ ${publisher}${tagline ? ' — ' + tagline : ' — エグゼクティブ・リサーチレポート'}`;
  h1.font = { name: FONT_FAMILY, size: 14, bold: true, color: { argb: COLORS.headerText } };
  h1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  h1.alignment = { vertical: 'middle', indent: 1 };
  ws1.getRow(1).height = 36;

  // 3〜7行目: メタ情報ボックス
  const metaRows = [
    ['リサーチテーマ', data.title || data.theme || '（無題）'],
    ['作成日時', formatDate(data.createdAt)],
    ['レポート作成者', author || 'Research Studio AI Agent'],
    ['機密区分', confidentiality || '社内限定 (INTERNAL USE ONLY)'],
    ['調査スタイル / 深度', `${data.styleLabel || data.style || '標準ビジネス'} / ${isDeep ? 'ディープ推論' : 'クイック'}`],
    ['参照ソース件数', `${(data.sources && data.sources.length) || 0} 件`],
  ];

  let rIdx = 3;
  for (const [k, v] of metaRows) {
    ws1.getCell(`A${rIdx}`).value = k;
    ws1.getCell(`A${rIdx}`).font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: 'FF475569' } };
    ws1.getCell(`A${rIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws1.getCell(`A${rIdx}`).alignment = { vertical: 'middle' };
    ws1.getCell(`A${rIdx}`).border = BORDER_THIN;

    ws1.mergeCells(`B${rIdx}:D${rIdx}`);
    const vCell = ws1.getCell(`B${rIdx}`);
    vCell.value = v;
    vCell.font = { name: FONT_FAMILY, size: 10, bold: k === 'リサーチテーマ' };
    vCell.alignment = { vertical: 'middle' };
    vCell.border = BORDER_THIN;
    ws1.getRow(rIdx).height = 22;
    rIdx++;
  }

  // 10行目: エグゼクティブサマリー見出し
  rIdx += 1;
  ws1.mergeCells(`A${rIdx}:D${rIdx}`);
  const sHead = ws1.getCell(`A${rIdx}`);
  sHead.value = '【 1. エグゼクティブサマリー (要約) 】';
  sHead.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.subHeaderText } };
  sHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
  sHead.alignment = { vertical: 'middle', indent: 1 };
  ws1.getRow(rIdx).height = 26;
  rIdx++;

  // サマリー本文枠
  ws1.mergeCells(`A${rIdx}:D${rIdx + 2}`);
  const sBody = ws1.getCell(`A${rIdx}`);
  sBody.value = data.summary || '（サマリーなし）';
  sBody.font = { name: FONT_FAMILY, size: 10.5 };
  sBody.alignment = { vertical: 'top', wrapText: true };
  sBody.border = BORDER_CARD;
  ws1.getRow(rIdx).height = 25;
  ws1.getRow(rIdx + 1).height = 25;
  ws1.getRow(rIdx + 2).height = 25;
  rIdx += 3;

  // 重要指標 (KPI) カード
  if (data.metrics && data.metrics.length) {
    rIdx += 1;
    ws1.mergeCells(`A${rIdx}:D${rIdx}`);
    const kHead = ws1.getCell(`A${rIdx}`);
    kHead.value = '【 2. 重要指標・数値データ (Key Performance Indicators) 】';
    kHead.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.subHeaderText } };
    kHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
    kHead.alignment = { vertical: 'middle', indent: 1 };
    ws1.getRow(rIdx).height = 26;
    rIdx++;

    // 4列分のKPIカード枠
    const cols = ['A', 'B', 'C', 'D'];
    const kpiCount = Math.min(4, data.metrics.length);

    ws1.getRow(rIdx).height = 22;     // ラベル行
    ws1.getRow(rIdx + 1).height = 36; // 数値行
    ws1.getRow(rIdx + 2).height = 22; // 注記行

    for (let i = 0; i < kpiCount; i++) {
      const m = data.metrics[i];
      const c = cols[i];

      // ラベル
      const lCell = ws1.getCell(`${c}${rIdx}`);
      lCell.value = m.label || '指標';
      lCell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: 'FF64748B' } };
      lCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.kpiBg } };
      lCell.alignment = { horizontal: 'center', vertical: 'middle' };
      lCell.border = { top: BORDER_CARD.top, left: BORDER_CARD.left, right: BORDER_CARD.right };

      // 数値
      const valCell = ws1.getCell(`${c}${rIdx + 1}`);
      valCell.value = m.value || '—';
      valCell.font = { name: FONT_FAMILY, size: 15, bold: true, color: { argb: COLORS.kpiValue } };
      valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.kpiBg } };
      valCell.alignment = { horizontal: 'center', vertical: 'middle' };
      valCell.border = { left: BORDER_CARD.left, right: BORDER_CARD.right };

      // 注記
      const nCell = ws1.getCell(`${c}${rIdx + 2}`);
      nCell.value = m.note || '';
      nCell.font = { name: FONT_FAMILY, size: 8.5, color: { argb: 'FF94A3B8' } };
      nCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.kpiBg } };
      nCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      nCell.border = { bottom: BORDER_CARD.bottom, left: BORDER_CARD.left, right: BORDER_CARD.right };
    }
    rIdx += 3;
  }

  // 主要ハイライト (Key Points)
  if (data.keyPoints && data.keyPoints.length) {
    rIdx += 1;
    ws1.mergeCells(`A${rIdx}:D${rIdx}`);
    const kpHead = ws1.getCell(`A${rIdx}`);
    kpHead.value = '【 3. 主要ハイライト・要点整理 】';
    kpHead.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.subHeaderText } };
    kpHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.subHeaderBg } };
    kpHead.alignment = { vertical: 'middle', indent: 1 };
    ws1.getRow(rIdx).height = 26;
    rIdx++;

    data.keyPoints.forEach((kp, idx) => {
      ws1.getCell(`A${rIdx}`).value = `● Point ${idx + 1}`;
      ws1.getCell(`A${rIdx}`).font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: 'FF334155' } };
      ws1.getCell(`A${rIdx}`).alignment = { vertical: 'middle', horizontal: 'center' };
      ws1.getCell(`A${rIdx}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      ws1.getCell(`A${rIdx}`).border = BORDER_THIN;

      ws1.mergeCells(`B${rIdx}:D${rIdx}`);
      const kpCell = ws1.getCell(`B${rIdx}`);
      kpCell.value = kp;
      kpCell.font = { name: FONT_FAMILY, size: 10 };
      kpCell.alignment = { vertical: 'middle', wrapText: true };
      kpCell.border = BORDER_THIN;
      ws1.getRow(rIdx).height = 26;
      rIdx++;
    });
  }

  // 免責事項
  if (disclaimer) {
    rIdx += 1;
    ws1.mergeCells(`A${rIdx}:D${rIdx}`);
    const disc = ws1.getCell(`A${rIdx}`);
    disc.value = `※ 免責事項: ${disclaimer}`;
    disc.font = { name: FONT_FAMILY, size: 8.5, color: { argb: 'FF94A3B8' } };
    disc.alignment = { vertical: 'middle', wrapText: true };
    ws1.getRow(rIdx).height = 20;
  }

  // =========================================================================
  // Sheet 2: ⚖️ 比較マトリクス表 (Comparison Matrix)
  // =========================================================================
  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    const ws2 = wb.addWorksheet('⚖️ 比較マトリクス表');
    setupWorksheetPrint(ws2);

    const colsCount = data.table.columns.length;
    ws2.mergeCells(1, 1, 1, colsCount);
    const mHead = ws2.getCell(1, 1);
    mHead.value = `◆ ${data.title || data.theme} — 構造化比較マトリクス`;
    mHead.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.headerText } };
    mHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    mHead.alignment = { vertical: 'middle', indent: 1 };
    ws2.getRow(1).height = 32;

    // テーブルヘッダー
    const headerRow = ws2.getRow(3);
    headerRow.height = 28;
    data.table.columns.forEach((colName, cIdx) => {
      const cell = headerRow.getCell(cIdx + 1);
      cell.value = colName;
      cell.font = { name: FONT_FAMILY, size: 10.5, bold: true, color: { argb: COLORS.subHeaderText } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tableHeaderBg } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = BORDER_THIN;
    });

    // データ行（ゼブラストライプ）
    data.table.rows.forEach((row, rOffset) => {
      const currentRow = ws2.getRow(4 + rOffset);
      currentRow.height = 30;
      const isZebra = rOffset % 2 === 1;

      row.forEach((val, cIdx) => {
        const cell = currentRow.getCell(cIdx + 1);
        cell.value = val || '';
        cell.font = { name: FONT_FAMILY, size: 10, bold: cIdx === 0 };
        if (isZebra) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
        }
        cell.alignment = { vertical: 'middle', horizontal: cIdx === 0 ? 'left' : 'left', wrapText: true };
        cell.border = BORDER_THIN;
      });
    });

    // 各列の幅を自動算出
    for (let c = 1; c <= colsCount; c++) {
      let maxLen = (data.table.columns[c - 1] || '').length * 2;
      for (const row of data.table.rows) {
        const v = String(row[c - 1] || '');
        maxLen = Math.max(maxLen, Math.min(v.length * 1.5, 45));
      }
      ws2.getColumn(c).width = Math.max(18, Math.min(maxLen + 4, 48));
    }
  }

  // =========================================================================
  // Sheet 3: 🔍 深層推論・シナリオ (Deep Analysis) - Deepモード時
  // =========================================================================
  if (isDeep && data.deepThinking) {
    const dt = data.deepThinking;
    const ws3 = wb.addWorksheet('🔍 深層因果・シナリオ予測');
    setupWorksheetPrint(ws3);

    ws3.columns = [
      { width: 20 },
      { width: 28 },
      { width: 55 },
      { width: 28 },
    ];

    ws3.mergeCells('A1:D1');
    const dHead = ws3.getCell('A1');
    dHead.value = `◆ ディープリサーチ深層推論 & 将来シナリオ予測マトリクス`;
    dHead.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.headerText } };
    dHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    dHead.alignment = { vertical: 'middle', indent: 1 };
    ws3.getRow(1).height = 32;

    let dRow = 3;

    // テーブル見出し
    ws3.getRow(dRow).height = 26;
    const heads = ['分析区分', '項目 / 観点', '詳細内容・分析考察', '核心要因・トリガー'];
    heads.forEach((h, idx) => {
      const c = ws3.getCell(dRow, idx + 1);
      c.value = h;
      c.font = { name: FONT_FAMILY, size: 10.5, bold: true, color: { argb: COLORS.subHeaderText } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tableHeaderBg } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.border = BORDER_THIN;
    });
    dRow++;

    // アナリスト仮説
    if (dt.analystNote) {
      ws3.getRow(dRow).height = 40;
      ws3.getCell(`A${dRow}`).value = 'アナリスト仮説';
      ws3.getCell(`B${dRow}`).value = '本質課題と前提検証';
      ws3.getCell(`C${dRow}`).value = dt.analystNote;
      ws3.getCell(`D${dRow}`).value = '前提の妥当性精査';
      ['A', 'B', 'C', 'D'].forEach((c) => {
        const cell = ws3.getCell(`${c}${dRow}`);
        cell.font = { name: FONT_FAMILY, size: 9.5 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = BORDER_THIN;
      });
      dRow++;
    }

    // 構造的因果力学
    if (dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length) {
      dt.dynamicsAndRootCauses.forEach((d) => {
        ws3.getRow(dRow).height = 36;
        ws3.getCell(`A${dRow}`).value = '構造的因果力学';
        ws3.getCell(`B${dRow}`).value = d.topic || '';
        ws3.getCell(`C${dRow}`).value = d.mechanism || '';
        ws3.getCell(`D${dRow}`).value = d.keyFactor || '—';
        ['A', 'B', 'C', 'D'].forEach((c) => {
          const cell = ws3.getCell(`${c}${dRow}`);
          cell.font = { name: FONT_FAMILY, size: 9.5 };
          cell.alignment = { vertical: 'middle', wrapText: true };
          cell.border = BORDER_THIN;
        });
        dRow++;
      });
    }

    // 多角トレードオフ
    if (dt.tradeoffs && dt.tradeoffs.length) {
      dt.tradeoffs.forEach((t) => {
        ws3.getRow(dRow).height = 36;
        ws3.getCell(`A${dRow}`).value = '多角トレードオフ';
        ws3.getCell(`B${dRow}`).value = t.axis || '';
        ws3.getCell(`C${dRow}`).value = `【推進論】${t.proSide || ''}\n【慎重論】${t.conSide || ''}`;
        ws3.getCell(`D${dRow}`).value = t.synthesis || '—';
        ['A', 'B', 'C', 'D'].forEach((c) => {
          const cell = ws3.getCell(`${c}${dRow}`);
          cell.font = { name: FONT_FAMILY, size: 9.5 };
          cell.alignment = { vertical: 'middle', wrapText: true };
          cell.border = BORDER_THIN;
        });
        dRow++;
      });
    }

    // 将来シナリオ予測
    if (dt.scenarios) {
      const scList = [
        ['メイン予測 (60%)', dt.scenarios.mainScenario || '', '確率 60%'],
        ['加速/上振れ (25%)', dt.scenarios.upsideScenario || '', '確率 25%'],
        ['停滞/下振れ (15%)', dt.scenarios.downsideScenario || '', '確率 15%'],
      ];
      scList.forEach(([scTitle, scText, scProb]) => {
        ws3.getRow(dRow).height = 36;
        ws3.getCell(`A${dRow}`).value = '将来シナリオ予測';
        ws3.getCell(`B${dRow}`).value = scTitle;
        ws3.getCell(`C${dRow}`).value = scText;
        ws3.getCell(`D${dRow}`).value = scProb;
        ['A', 'B', 'C', 'D'].forEach((c) => {
          const cell = ws3.getCell(`${c}${dRow}`);
          cell.font = { name: FONT_FAMILY, size: 9.5 };
          cell.alignment = { vertical: 'middle', wrapText: true };
          cell.border = BORDER_THIN;
        });
        dRow++;
      });
    }

    // 実行戦略ロードマップ
    if (dt.roadmap && dt.roadmap.length) {
      dt.roadmap.forEach((r) => {
        ws3.getRow(dRow).height = 36;
        ws3.getCell(`A${dRow}`).value = '実行戦略ロードマップ';
        ws3.getCell(`B${dRow}`).value = r.phase || '';
        ws3.getCell(`C${dRow}`).value = (r.actions || []).join(' / ');
        ws3.getCell(`D${dRow}`).value = `重点: ${r.focus || '—'}`;
        ['A', 'B', 'C', 'D'].forEach((c) => {
          const cell = ws3.getCell(`${c}${dRow}`);
          cell.font = { name: FONT_FAMILY, size: 9.5 };
          cell.alignment = { vertical: 'middle', wrapText: true };
          cell.border = BORDER_THIN;
        });
        dRow++;
      });
    }
  }

  // =========================================================================
  // Sheet 4: 🔗 収集ソース一覧 (References & Fact-checking)
  // =========================================================================
  if (data.sources && data.sources.length) {
    const wsSources = wb.addWorksheet('🔗 収集ソース一覧');
    setupWorksheetPrint(wsSources);

    wsSources.columns = [
      { width: 8 },  // No.
      { width: 34 }, // タイトル
      { width: 20 }, // ドメイン
      { width: 14 }, // 信頼度
      { width: 44 }, // 参照URL
      { width: 55 }, // 要約抜粋
    ];

    wsSources.mergeCells('A1:F1');
    const srcHead = wsSources.getCell('A1');
    srcHead.value = `◆ 収集・ファクトチェック参照ソース一覧 (${data.sources.length}件)`;
    srcHead.font = { name: FONT_FAMILY, size: 13, bold: true, color: { argb: COLORS.headerText } };
    srcHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
    srcHead.alignment = { vertical: 'middle', indent: 1 };
    wsSources.getRow(1).height = 32;

    const sHeadRow = wsSources.getRow(3);
    sHeadRow.height = 26;
    const srcHeaders = ['No.', 'タイトル', 'ドメイン', '信頼度', '参照URL (クリック可)', '引用・要約抜粋'];
    srcHeaders.forEach((h, idx) => {
      const c = sHeadRow.getCell(idx + 1);
      c.value = h;
      c.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: COLORS.subHeaderText } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.tableHeaderBg } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.border = BORDER_THIN;
    });

    data.sources.forEach((s, idx) => {
      const r = wsSources.getRow(4 + idx);
      r.height = 28;
      const isZebra = idx % 2 === 1;

      // No
      const c1 = r.getCell(1);
      c1.value = s.index || idx + 1;
      c1.alignment = { horizontal: 'center', vertical: 'middle' };

      // タイトル
      const c2 = r.getCell(2);
      c2.value = s.title || '';
      c2.alignment = { vertical: 'middle', wrapText: true };

      // ドメイン
      const c3 = r.getCell(3);
      c3.value = s.domain || '';
      c3.alignment = { vertical: 'middle', horizontal: 'center' };

      // スコア
      const c4 = r.getCell(4);
      c4.value = s.score ? `${Math.round(s.score * 100)}%` : '85%';
      c4.alignment = { horizontal: 'center', vertical: 'middle' };

      // URL (ハイパーリンク)
      const c5 = r.getCell(5);
      if (s.url) {
        c5.value = {
          text: s.url,
          hyperlink: s.url,
          tooltip: 'ブラウザで開く',
        };
        c5.font = { name: FONT_FAMILY, size: 9.5, color: { argb: COLORS.linkBlue }, underline: true };
      } else {
        c5.value = '—';
      }
      c5.alignment = { vertical: 'middle' };

      // 抜粋
      const c6 = r.getCell(6);
      c6.value = s.snippet || '';
      c6.alignment = { vertical: 'middle', wrapText: true };

      // 全セルのスタイル適用
      for (let col = 1; col <= 6; col++) {
        const cell = r.getCell(col);
        if (col !== 5) {
          cell.font = { name: FONT_FAMILY, size: 9.5, bold: col === 1 };
        }
        if (isZebra) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebraBg } };
        }
        cell.border = BORDER_THIN;
      }
    });
  }

  // バッファを生成して返却
  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  generateExcelReport,
};

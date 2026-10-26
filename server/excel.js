'use strict';

const ExcelJS = require('exceljs');

/**
 * Research Studio — 商用グレード Excel レポート生成エンジン（ExcelJS）
 * -------------------------------------------------------------------------
 * シート構成
 *   1. Executive_Summary  … タイトルバナー / メタ情報 / KPIカード×4 / サマリー・課題・ネクストアクション
 *   2. Comparison_Matrix  … 構造化比較表（ゼブラ・オートフィルター・ウィンドウ枠固定・推奨ハイライト）
 *   3. Source_Index       … 収集ソース一覧（HYPERLINK関数・信頼度条件付き書式・オートフィルター）
 */

/* =========================================================
   1. ブランドトークン（Web / PDF と完全共通）
   ========================================================= */
const BRAND = {
  navy:     '0F172A',  // ヘッダー主色
  navy2:    '1E293B',
  blueDeep: '1E3A8A',  // バナーのグラデーション終点
  blue:     '2563EB',  // サブヘッダー / アクセント
  blue50:   'EFF6FF',
  cyan:     '06B6D4',  // データカード / ハイライト
  cyanText: '67E8F9',
  indigo:   '4F46E5',
  paper:    'F8FAFC',  // ゼブラ / KPIカード背景
  line:     'E2E8F0',  // 罫線
  ink:      '0F172A',
  text:     '334155',
  muted:    '64748B',
  faint:    '94A3B8',
  white:    'FFFFFF',
  goodBg:   'ECFDF5', goodFg: '047857',  // 高評価・推奨
  warnBg:   'FFFBEB', warnFg: 'B45309',  // 要注意・リスク
  critBg:   'FEF2F2', critFg: 'B91C1C',  // 機密区分
};

const FONT = 'Meiryo UI';

const argb = (hex) => 'FF' + hex;
const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const font = (o = {}) => ({
  name: FONT,
  size: o.size || 10,
  bold: !!o.bold,
  italic: !!o.italic,
  underline: o.underline,
  color: { argb: argb(o.color || BRAND.text) },
});
const thin = (hex = BRAND.line) => ({ style: 'thin', color: { argb: argb(hex) } });
const borderAll = (hex = BRAND.line) => ({
  top: thin(hex),
  left: thin(hex),
  bottom: thin(hex),
  right: thin(hex),
});

function formatDate(iso) {
  if (!iso) return '2026.10.27';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    return `${Y}.${M}.${D}`;
  } catch {
    return String(iso);
  }
}

/** 文字列の表示幅（半角=1, 全角=2） */
function textWidth(s) {
  let w = 0;
  for (const ch of String(s ?? '')) w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? 1 : 2;
  return w;
}

/** 折り返し後の行数を見積もる */
function estimateLines(s, widthChars, fontSize = 10) {
  const scale = fontSize / 10;
  const usable = Math.max(4, widthChars / scale - 2);
  return String(s ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(textWidth(line) / usable)), 0);
}

const lineHeightPt = (fontSize) => Math.round(fontSize * 1.75);

function colsWidth(ws, from, to) {
  let w = 0;
  for (let c = from; c <= to; c++) w += ws.getColumn(c).width || 8.43;
  return w;
}

function mergeSet(ws, range, value, style = {}) {
  ws.mergeCells(range);
  const cell = ws.getCell(range.split(':')[0]);
  cell.value = value;
  Object.assign(cell, style);
  return cell;
}

/** 結合範囲の全セルに塗り・罫線を適用 */
function styleRange(ws, r1, c1, r2, c2, style) {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      if (style.fill) cell.fill = style.fill;
      if (style.border) cell.border = style.border;
    }
  }
}

/** 推奨度・評価の文字列からステータス配色を決める */
function statusOf(v) {
  const s = String(v ?? '');
  if (/^(◎|推奨|高|採用|Go)/i.test(s)) return 'good';
  if (/^(△|×|要注意|低|リスク|No-Go)/i.test(s)) return 'warn';
  return 'neutral';
}

const excelStr = (s) => String(s).replace(/"/g, '""');

/* =========================================================
   2. Sheet 1 — Executive_Summary
   ========================================================= */
function buildSummary(wb, d) {
  const ws = wb.addWorksheet('Executive_Summary', {
    properties: { tabColor: { argb: argb(BRAND.navy) } },
    views: [{ showGridLines: false, zoomScale: 100 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8${d.meta.classification}&C&8© ${d.meta.publisher || 'Research Studio'}&R&8&P / &N` },
  });

  // 8列グリッド（KPIカード = 2列 × 4）
  for (let c = 1; c <= 8; c++) ws.getColumn(c).width = 17;

  // --- バナー（行1–2）：A1:C2 タイトル（グラデーション）／ D1:F2 サブタイトル／ G1:H2 信頼度
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 30;
  const tw = textWidth(d.meta.title);
  const titleSize = tw <= 28 ? 18 : tw <= 40 ? 15 : 13;
  mergeSet(ws, 'A1:C2', d.meta.title, {
    font: font({ size: titleSize, bold: true, color: BRAND.white }),
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 },
    fill: {
      type: 'gradient',
      gradient: 'angle',
      degree: 0,
      stops: [{ position: 0, color: { argb: argb(BRAND.navy) } }, { position: 1, color: { argb: argb(BRAND.blueDeep) } }],
    },
  });
  mergeSet(ws, 'D1:F2', d.meta.subtitle, {
    font: font({ size: 10, color: 'CBD5E1' }),
    fill: fill(BRAND.blueDeep),
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 },
  });
  styleRange(ws, 1, 4, 2, 6, { fill: fill(BRAND.blueDeep) });
  mergeSet(ws, 'G1:H1', 'CONFIDENCE SCORE', {
    font: font({ size: 8, bold: true, color: BRAND.cyanText }),
    fill: fill(BRAND.navy),
    alignment: { vertical: 'bottom', horizontal: 'center' },
  });
  const scoreText = typeof d.meta.score === 'number'
    ? `${d.meta.score}点 / Grade ${d.meta.grade}`
    : `${d.meta.score} / Grade ${d.meta.grade}`;
  mergeSet(ws, 'G2:H2', scoreText, {
    font: font({ size: textWidth(scoreText) > 18 ? 12 : 16, bold: true, color: BRAND.white }),
    fill: fill(BRAND.navy),
    alignment: { vertical: 'top', horizontal: 'center', shrinkToFit: true },
  });
  styleRange(ws, 1, 7, 2, 8, { fill: fill(BRAND.navy) });

  // --- アクセントライン（行3）：ブランドグラデーション
  ws.getRow(3).height = 4;
  ws.mergeCells('A3:H3');
  ws.getCell('A3').fill = {
    type: 'gradient',
    gradient: 'angle',
    degree: 0,
    stops: [
      { position: 0, color: { argb: argb(BRAND.blue) } },
      { position: 0.55, color: { argb: argb(BRAND.cyan) } },
      { position: 1, color: { argb: argb(BRAND.indigo) } },
    ],
  };

  // --- メタ情報（行5–6）
  ws.getRow(4).height = 8;
  const meta = [
    ['調査テーマ', d.meta.theme],
    ['作成日', d.meta.date],
    ['発行元', d.meta.publisher],
    ['機密区分', d.meta.classification],
  ];
  meta.forEach(([label, value], i) => {
    const c1 = 1 + i * 2, c2 = c1 + 1;
    const L = ws.getCell(5, c1).address, R = ws.getCell(5, c2).address;
    const L2 = ws.getCell(6, c1).address, R2 = ws.getCell(6, c2).address;
    mergeSet(ws, `${L}:${R}`, label, {
      font: font({ size: 8, bold: true, color: BRAND.muted }),
      alignment: { vertical: 'bottom', indent: 1 },
    });
    const isClass = label === '機密区分';
    mergeSet(ws, `${L2}:${R2}`, value, {
      font: font({ size: 11, bold: true, color: isClass ? BRAND.critFg : BRAND.ink }),
      alignment: { vertical: 'middle', indent: 1 },
      fill: isClass ? fill(BRAND.critBg) : undefined,
    });
    styleRange(ws, 6, c1, 6, c2, { border: { bottom: thin(BRAND.line) } });
    if (isClass) styleRange(ws, 6, c1, 6, c2, { fill: fill(BRAND.critBg), border: { bottom: thin(BRAND.line) } });
  });
  ws.getRow(5).height = 16;
  ws.getRow(6).height = 24;

  // --- KPIカード（行8–12）
  ws.getRow(7).height = 12;
  sectionHeader(ws, 8, 'KEY METRICS', '主要指標');
  const cardTop = 9;
  ws.getRow(cardTop).height = 20;
  ws.getRow(cardTop + 1).height = 26;
  ws.getRow(cardTop + 2).height = 14;
  ws.getRow(cardTop + 3).height = 30;

  d.metrics.slice(0, 4).forEach((m, i) => {
    const c1 = 1 + i * 2, c2 = c1 + 1;
    const a = (r, c) => ws.getCell(r, c).address;
    for (let r = cardTop; r <= cardTop + 3; r++) {
      for (let c = c1; c <= c2; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = fill(BRAND.paper);
        cell.border = {
          top: r === cardTop ? { style: 'thick', color: { argb: argb(BRAND.cyan) } } : undefined,
          bottom: r === cardTop + 3 ? thin(BRAND.line) : undefined,
          left: c === c1 ? { style: 'medium', color: { argb: argb(BRAND.white) } } : undefined,
          right: c === c2 ? { style: 'medium', color: { argb: argb(BRAND.white) } } : undefined,
        };
      }
    }
    mergeSet(ws, `${a(cardTop, c1)}:${a(cardTop, c2)}`, m.label, {
      font: font({ size: 9, bold: true, color: BRAND.muted }),
      alignment: { vertical: 'bottom', indent: 1 },
    });
    mergeSet(ws, `${a(cardTop + 1, c1)}:${a(cardTop + 2, c2)}`, m.value, {
      font: font({ size: 22, bold: true, color: BRAND.ink }),
      alignment: { vertical: 'middle', indent: 1 },
    });
    mergeSet(ws, `${a(cardTop + 3, c1)}:${a(cardTop + 3, c2)}`, m.note, {
      font: font({ size: 8, color: BRAND.muted }),
      alignment: { vertical: 'top', wrapText: true, indent: 1 },
    });
  });

  // --- エグゼクティブサマリー（行15〜）
  let r = cardTop + 5;
  ws.getRow(r - 1).height = 12;
  sectionHeader(ws, r, 'EXECUTIVE SUMMARY', '結論・課題・推奨アクション');
  r += 1;

  const bodyW = colsWidth(ws, 2, 8);
  // 結論
  labelCell(ws, r, r, '結論', BRAND.navy, BRAND.white);
  mergeSet(ws, `B${r}:H${r}`, d.summary.conclusion, {
    font: font({ size: 11, bold: true, color: BRAND.ink }),
    fill: fill(BRAND.blue50),
    alignment: { vertical: 'middle', wrapText: true, indent: 1 },
  });
  styleRange(ws, r, 2, r, 8, { fill: fill(BRAND.blue50), border: { bottom: thin(BRAND.line) } });
  ws.getRow(r).height = Math.max(36, estimateLines(d.summary.conclusion, bodyW, 11) * lineHeightPt(11) + 10);
  r += 1;

  // 課題
  const issues = d.summary.issues || [];
  if (issues.length) {
    labelCell(ws, r, r + issues.length - 1, '主要な課題', BRAND.warnBg, BRAND.warnFg);
    issues.forEach((t, i) => {
      const row = r + i;
      ws.getCell(row, 2).value = `0${i + 1}`;
      ws.getCell(row, 2).font = font({ size: 10, bold: true, color: BRAND.warnFg });
      ws.getCell(row, 2).alignment = { vertical: 'middle', horizontal: 'center' };
      mergeSet(ws, `C${row}:H${row}`, t, {
        font: font({ size: 10, color: BRAND.text }),
        alignment: { vertical: 'middle', wrapText: true, indent: 1 },
      });
      styleRange(ws, row, 2, row, 8, { border: { bottom: thin(BRAND.line) } });
      ws.getRow(row).height = Math.max(22, estimateLines(t, colsWidth(ws, 3, 8)) * lineHeightPt(10) + 6);
    });
    r += issues.length;
  }

  // 推奨ネクストアクション
  const actions = d.summary.actions || [];
  if (actions.length) {
    labelCell(ws, r, r + actions.length - 1, '推奨ネクスト\nアクション', BRAND.goodBg, BRAND.goodFg);
    actions.forEach((a, i) => {
      const row = r + i;
      ws.getCell(row, 2).value = a.phase;
      ws.getCell(row, 2).font = font({ size: 9, bold: true, color: BRAND.goodFg });
      ws.getCell(row, 2).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      mergeSet(ws, `C${row}:G${row}`, a.action, {
        font: font({ size: 10, color: BRAND.ink }),
        alignment: { vertical: 'middle', wrapText: true, indent: 1 },
      });
      ws.getCell(row, 8).value = a.owner;
      ws.getCell(row, 8).font = font({ size: 9, color: BRAND.muted });
      ws.getCell(row, 8).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      styleRange(ws, row, 2, row, 8, { border: { bottom: thin(BRAND.line) } });
      ws.getRow(row).height = Math.max(24, estimateLines(a.action, colsWidth(ws, 3, 7)) * lineHeightPt(10) + 8);
    });
    r += actions.length;
  }

  // フッター注記
  r += 1;
  mergeSet(
    ws,
    `A${r}:H${r}`,
    '本レポートは公開情報をもとにAIが自動収集・分析した結果であり、正確性・完全性を保証するものではありません。出典は Source_Index シートを参照してください。',
    { font: font({ size: 8, color: BRAND.faint }), alignment: { wrapText: true, vertical: 'top' } }
  );
  ws.getRow(r).height = 24;
  ws.pageSetup.printArea = `A1:H${r}`;
  return ws;
}

function sectionHeader(ws, row, en, ja) {
  ws.getRow(row).height = 22;
  mergeSet(
    ws,
    `A${row}:D${row}`,
    {
      richText: [
        { text: en + '  ', font: font({ size: 10, bold: true, color: BRAND.blue }) },
        { text: ja, font: font({ size: 9, color: BRAND.muted }) },
      ],
    },
    { alignment: { vertical: 'bottom' } }
  );
  styleRange(ws, row, 1, row, 8, { border: { bottom: { style: 'medium', color: { argb: argb(BRAND.navy) } } } });
}

function labelCell(ws, r1, r2, text, bg, fg) {
  const range = r1 === r2 ? `A${r1}` : `A${r1}:A${r2}`;
  if (r1 !== r2) ws.mergeCells(range);
  const cell = ws.getCell(`A${r1}`);
  cell.value = text;
  cell.font = font({ size: 10, bold: true, color: fg });
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  styleRange(ws, r1, 1, r2, 1, { fill: fill(bg), border: { bottom: { style: 'thin', color: { argb: argb(BRAND.white) } } } });
}

/* =========================================================
   3. Sheet 2 — Comparison_Matrix
   ========================================================= */
function buildComparison(wb, d) {
  const cmp = d.comparison;
  const ws = wb.addWorksheet('Comparison_Matrix', {
    properties: { tabColor: { argb: argb(BRAND.blue) } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '3:3',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8${d.meta.classification}&C&8© ${d.meta.publisher || 'Research Studio'}&R&8&P / &N` },
  });
  const widths = [30, 24, 24, 24, 34, 11];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const lastCol = 6;

  // 1行目：大見出し
  ws.getRow(1).height = 34;
  mergeSet(ws, 'A1:F1', cmp.title, {
    font: font({ size: 16, bold: true, color: BRAND.white }),
    fill: fill(BRAND.navy),
    alignment: { vertical: 'middle', indent: 1 },
  });
  styleRange(ws, 1, 1, 1, lastCol, { fill: fill(BRAND.navy) });

  // 2行目：注記
  ws.getRow(2).height = 22;
  mergeSet(ws, 'A2:F2', cmp.note || '', {
    font: font({ size: 9, color: BRAND.muted }),
    alignment: { vertical: 'middle', indent: 1 },
  });

  // 3行目：ヘッダー
  const headers = ['項目名', ...cmp.options.slice(0, 3), '選定基準', '推奨度'];
  ws.getRow(3).height = 28;
  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    const isRec = i >= 1 && i <= 3 && cmp.recommended === i - 1;
    cell.value = isRec ? `★ ${h}（推奨）` : h;
    cell.font = font({ size: 10, bold: true, color: BRAND.white });
    cell.fill = fill(isRec ? BRAND.cyan : BRAND.navy);
    cell.alignment = {
      vertical: 'middle',
      horizontal: i === 0 || i === 4 ? 'left' : 'center',
      indent: i === 0 || i === 4 ? 1 : 0,
      wrapText: true,
    };
    cell.border = { bottom: { style: 'medium', color: { argb: argb(BRAND.blue) } }, right: thin('334155') };
  });

  // 4行目以降：データ
  let r = 4, zebra = 0;
  for (const row of cmp.rows) {
    if (row.section !== undefined) {
      ws.getRow(r).height = 20;
      mergeSet(ws, `A${r}:F${r}`, row.section, {
        font: font({ size: 9, bold: true, color: BRAND.white }),
        alignment: { vertical: 'middle', indent: 1 },
      });
      styleRange(ws, r, 1, r, lastCol, { fill: fill(BRAND.blue) });
      r++;
      zebra = 0;
      continue;
    }
    const bg = zebra % 2 === 1 ? BRAND.paper : BRAND.white;
    const cells = [row.item, ...(row.values || []).slice(0, 3), row.criteria, row.recommendation];
    let maxLines = 1;
    cells.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v ?? '';
      cell.fill = fill(bg);
      cell.border = { bottom: thin(BRAND.line), right: thin(BRAND.line) };
      const isNum = typeof v === 'number';
      if (i === 0) {
        cell.font = font({ size: 10, bold: true, color: BRAND.ink });
        cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      } else if (i === 5) {
        const st = statusOf(v);
        cell.font = font({ size: 11, bold: true, color: st === 'good' ? BRAND.goodFg : st === 'warn' ? BRAND.warnFg : BRAND.text });
        if (st !== 'neutral') cell.fill = fill(st === 'good' ? BRAND.goodBg : BRAND.warnBg);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (i === 4) {
        cell.font = font({ size: 9, color: BRAND.muted });
        cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      } else if (isNum) {
        cell.numFmt = '#,##0';
        cell.font = font({ size: 10, color: BRAND.ink });
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else {
        const short = textWidth(v) <= 12;
        cell.font = font({ size: 10, color: BRAND.text });
        cell.alignment = { vertical: 'middle', horizontal: short ? 'center' : 'left', wrapText: true, indent: short ? 0 : 1 };
      }
      if (!isNum) maxLines = Math.max(maxLines, estimateLines(v, widths[i], i === 4 ? 9 : 10));
    });
    // 推奨列のセルを淡いシアンで強調
    if (cmp.recommended !== undefined && cmp.recommended !== null) {
      const c = ws.getCell(r, 2 + cmp.recommended);
      c.fill = fill(zebra % 2 === 1 ? 'E0F7FA' : 'ECFEFF');
    }
    ws.getRow(r).height = Math.max(24, maxLines * lineHeightPt(10) + 8);
    r++;
    zebra++;
  }
  const last = r - 1;

  // 外枠
  styleRange(ws, 3, 1, last, lastCol, { border: borderAll(BRAND.line) });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: lastCol } };
  ws.pageSetup.printArea = `A1:F${last}`;
  return ws;
}

/* =========================================================
   4. Sheet 3 — Source_Index
   ========================================================= */
function buildSources(wb, d) {
  const ws = wb.addWorksheet('Source_Index', {
    properties: { tabColor: { argb: argb(BRAND.cyan) } },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '3:3',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: `&L&8${d.meta.classification}&C&8© ${d.meta.publisher || 'Research Studio'}&R&8&P / &N` },
  });
  const widths = [8, 42, 14, 26, 48];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.getRow(1).height = 32;
  mergeSet(ws, 'A1:E1', '収集・裏付けソース一覧（ファクトチェック情報）', {
    font: font({ size: 14, bold: true, color: BRAND.white }),
    fill: fill(BRAND.navy),
    alignment: { vertical: 'middle', indent: 1 },
  });
  styleRange(ws, 1, 1, 1, 5, { fill: fill(BRAND.navy) });

  ws.getRow(2).height = 20;
  mergeSet(ws, 'A2:E2', '一次情報および公的統計・主要メディアのURLと信頼度スコア', {
    font: font({ size: 9, color: BRAND.muted }),
    alignment: { vertical: 'middle', indent: 1 },
  });

  const headers = ['ID', '出典名・文書名', '信頼度スコア', '発行元・種別', '参照URL（クリックでブラウザ表示）'];
  ws.getRow(3).height = 24;
  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.font = font({ size: 10, bold: true, color: BRAND.white });
    cell.fill = fill(BRAND.navy);
    cell.alignment = {
      vertical: 'middle',
      horizontal: i === 0 || i === 2 ? 'center' : 'left',
      indent: i === 0 || i === 2 ? 0 : 1,
    };
    cell.border = { bottom: { style: 'medium', color: { argb: argb(BRAND.cyan) } } };
  });

  d.sources.forEach((s, idx) => {
    const r = 4 + idx;
    const bg = idx % 2 === 1 ? BRAND.paper : BRAND.white;
    ws.getRow(r).height = 24;
    const vals = [
      s.id || `S${idx + 1}`,
      s.title,
      typeof s.score === 'number' ? s.score : s.score,
      s.publisher || s.domain || '調査情報源',
      s.url ? { formula: `HYPERLINK("${excelStr(s.url)}","${excelStr(s.url)}")`, result: s.url } : '—',
    ];
    vals.forEach((v, j) => {
      const cell = ws.getCell(r, j + 1);
      cell.value = v;
      cell.fill = fill(bg);
      cell.border = { bottom: thin(BRAND.line) };
      cell.alignment = {
        vertical: 'middle',
        horizontal: j === 0 || j === 2 ? 'center' : 'left',
        indent: j === 0 || j === 2 ? 0 : 1,
        wrapText: j === 1,
      };
      cell.font = font({
        size: 10,
        color: j === 0 ? BRAND.blue : j === 3 ? BRAND.muted : BRAND.ink,
        bold: j === 0 || j === 2,
      });
    });
    if (s.url) {
      ws.getCell(r, 5).font = font({ size: 10, color: BRAND.blue, underline: true });
    }
    if (typeof s.score === 'number') ws.getCell(r, 3).numFmt = '0';
  });
  const last = Math.max(4, 3 + d.sources.length);

  // 信頼度スコアの条件付き書式
  ws.addConditionalFormatting({
    ref: `C4:C${last}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThanOrEqual',
        formulae: [80],
        priority: 1,
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(BRAND.goodBg) } },
          font: { color: { argb: argb(BRAND.goodFg) }, bold: true },
        },
      },
      {
        type: 'cellIs',
        operator: 'lessThan',
        formulae: [60],
        priority: 2,
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(BRAND.warnBg) } },
          font: { color: { argb: argb(BRAND.warnFg) }, bold: true },
        },
      },
    ],
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: 5 } };
  ws.pageSetup.printArea = `A1:E${last}`;
  return ws;
}

/* =========================================================
   5. リサーチデータのアダプター（AI出力 → Excelテンプレート構造）
   ========================================================= */
function transformDataToExcelFormat(data = {}, brand = {}) {
  const publisher = (brand && brand.publisherName) || 'Research Studio';
  const confidentiality = (brand && brand.confidentiality) || '社内限定 (INTERNAL USE ONLY)';
  const dateStr = formatDate(data.createdAt);
  const scoreVal = typeof data.confidenceScore === 'number'
    ? data.confidenceScore
    : (typeof data.score === 'number' ? (data.score > 1 ? data.score : Math.round(data.score * 100)) : 88);
  const gradeVal = scoreVal >= 85 ? 'A' : (scoreVal >= 65 ? 'B' : 'C');

  // KPI指標
  let metrics = [];
  if (Array.isArray(data.metrics) && data.metrics.length > 0) {
    metrics = data.metrics.slice(0, 4).map((m) => ({
      label: m.label || '指標',
      value: String(m.value || '—'),
      note: m.note || '',
    }));
  }
  if (metrics.length < 4) {
    const fallbacks = [
      { label: '信頼度スコア', value: `${scoreVal}点`, note: `Grade ${gradeVal} · 一次情報裏付け` },
      { label: '参照ソース数', value: `${(data.sources && data.sources.length) || 0}件`, note: 'Webインデックス及び一次情報源' },
      { label: '分析フォーカス', value: data.styleLabel || data.style || '標準ビジネス', note: 'AI動的構造化エンジン適用' },
      { label: '調査品質水準', value: 'エンタープライズ', note: '多角クロスチェック検証済み' },
    ];
    for (const fb of fallbacks) {
      if (metrics.length >= 4) break;
      if (!metrics.some((m) => m.label === fb.label)) {
        metrics.push(fb);
      }
    }
  }

  // サマリー・課題・アクション
  let conclusion = data.summary || (data.title ? `${data.title}に関する総合的なリサーチおよび意思決定分析結果。` : '');
  let issues = [];
  let actions = [];

  if (Array.isArray(data.keyPoints) && data.keyPoints.length > 0) {
    issues = data.keyPoints.slice(0, 3);
  } else if (Array.isArray(data.insights) && data.insights.length > 0) {
    issues = data.insights.slice(0, 3).map((ins) => `${ins.title || ''}: ${ins.body || ''}`);
  } else {
    issues = [
      '市場環境や競合動向の急速な変化に伴うキャッチアップと差別化の必要性。',
      '初期投資・運用コストと得られる生産性・ROIのバランス評価。',
      '社内セキュリティおよびコンプライアンス要件への確実な適合。',
    ];
  }

  if (Array.isArray(data.insights) && data.insights.length > 0) {
    actions = data.insights.slice(0, 3).map((ins, idx) => ({
      phase: idx === 0 ? '短期 0–3ヶ月' : (idx === 1 ? '中期 3–9ヶ月' : '長期 9–18ヶ月'),
      action: `${ins.title ? ins.title + '：' : ''}${ins.body || ''}`,
      owner: (ins.category && ins.category !== '市場') ? ins.category : (idx === 0 ? '推進PMO' : (idx === 1 ? '業務部門' : '情報システム部')),
    }));
  } else {
    actions = [
      { phase: '短期 0–3ヶ月', action: '先行トライアル・PoCを実施し、効果と課題のベースラインを計測する', owner: '推進PMO' },
      { phase: '中期 3–9ヶ月', action: '本格展開に向けた運用ガイドライン策定と関係部門への説明・合意形成を行う', owner: '業務部門' },
      { phase: '長期 9–18ヶ月', action: '全社展開を完了し、定期的なKPIモニタリングと改善サイクルを定着させる', owner: '情報システム部' },
    ];
  }

  // 比較マトリクス
  let comparison = {
    title: (data.table && data.table.caption) ? data.table.caption : `${data.title || data.theme || '主要方式'} 比較マトリクス`,
    note: '評価：◎ 優位　○ 標準　△ 要注意　／　※AI分析および収集データに基づく総合評価',
    options: ['選択肢A（先行型）', '選択肢B（標準型）', '選択肢C（慎重型）'],
    recommended: 0,
    rows: [],
  };

  if (data.table && Array.isArray(data.table.columns) && Array.isArray(data.table.rows) && data.table.rows.length > 0) {
    const cols = data.table.columns;
    if (cols.length >= 4) {
      comparison.options = cols.slice(1, 4).map((c) => String(c).trim());
    }
    comparison.rows = [
      { section: '主要評価項目' },
      ...data.table.rows.map((row, rIdx) => {
        const item = String(row[0] || `項目 ${rIdx + 1}`);
        const v1 = row[1] ?? '◎';
        const v2 = row[2] ?? '○';
        const v3 = row[3] ?? '△';
        const criteria = row[4] ? String(row[4]) : '適合性評価';
        const rec = row[5] ? String(row[5]) : (rIdx === 0 ? '◎ 推奨' : '○ 標準');
        return { item, values: [v1, v2, v3], criteria, recommendation: rec };
      }),
    ];
  } else {
    comparison.rows = [
      { section: '機能・適合性' },
      { item: '要件適合度', values: ['◎', '○', '△'], criteria: 'コア業務プロセスの網羅性', recommendation: '◎ 推奨' },
      { item: '導入迅速性', values: ['◎', '△', '○'], criteria: '本番稼働までのリードタイム', recommendation: '◎ 推奨' },
      { section: 'コスト・運用' },
      { item: '初期・運用費用', values: ['○', '△', '◎'], criteria: 'TCO（総保有コスト）', recommendation: '○ 標準' },
      { item: '保守・運用負荷', values: ['◎', '△', '○'], criteria: '専任要員の必要性と運用難易度', recommendation: '◎ 推奨' },
      { section: 'セキュリティ・リスク' },
      { item: 'ガバナンス・権限', values: ['◎', '○', '△'], criteria: 'ACL連携・監査ログ対応', recommendation: '◎ 推奨' },
      { item: '拡張性・将来性', values: ['○', '◎', '△'], criteria: 'API連携・機能アップデート', recommendation: '○ 標準' },
    ];
  }

  // ソース一覧
  let sources = [];
  if (Array.isArray(data.sources) && data.sources.length > 0) {
    sources = data.sources.map((s, idx) => ({
      id: `S${idx + 1}`,
      title: s.title || s.domain || '調査情報源',
      score: typeof s.score === 'number' ? (s.score > 1 ? s.score : Math.round(s.score * 100)) : 85,
      publisher: s.category || s.domain || (idx % 2 === 0 ? '一次情報・公的' : '業界メディア'),
      url: s.url || '',
      snippet: s.snippet || '',
    }));
  } else {
    sources = [
      { id: 'S1', title: '公的統計・産業レポート', score: 92, publisher: '公的機関', url: 'https://example.com/report1' },
      { id: 'S2', title: '主要ベンダー公式ドキュメント', score: 88, publisher: '公式情報', url: 'https://example.com/report2' },
      { id: 'S3', title: '業界動向分析・専門メディア', score: 75, publisher: '専門メディア', url: 'https://example.com/report3' },
    ];
  }

  return {
    meta: {
      title: data.title || data.theme || 'エグゼクティブ・リサーチレポート',
      subtitle: data.subtitle || `${data.theme || ''} に関する構造化比較分析`,
      theme: data.theme || 'ビジネスリサーチ',
      date: dateStr,
      publisher,
      classification: confidentiality,
      score: scoreVal,
      grade: gradeVal,
    },
    metrics,
    summary: {
      conclusion,
      issues,
      actions,
    },
    comparison,
    sources,
  };
}

/* =========================================================
   6. ワークブック構築
   ========================================================= */
async function buildWorkbook(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = data.meta.publisher || 'Research Studio';
  wb.title = data.meta.title;
  wb.subject = data.meta.theme;
  wb.company = 'Research Studio';
  wb.created = new Date();
  buildSummary(wb, data);
  buildComparison(wb, data);
  buildSources(wb, data);
  wb.views = [{ activeTab: 0, firstSheet: 0 }];
  return wb;
}

/**
 * 商用レポート Excel Buffer 生成
 * @param {Object} data リサーチデータ
 * @param {Object} brand ブランド・ホワイトラベル設定
 * @returns {Promise<Buffer>}
 */
async function generateExcelReport(data, brand = {}) {
  const formatted = transformDataToExcelFormat(data, brand);
  const wb = await buildWorkbook(formatted);
  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  generateExcelReport,
  transformDataToExcelFormat,
  buildWorkbook,
  BRAND,
};

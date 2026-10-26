#!/usr/bin/env node
/**
 * Research Studio — Excel レポート生成スクリプト（ExcelJS）
 * ------------------------------------------------------------
 * シート構成
 *   1. Executive_Summary  … タイトルバナー / メタ情報 / KPIカード×4 / サマリー・課題・ネクストアクション
 *   2. Comparison_Matrix  … 構造化比較表（ゼブラ・オートフィルター・ウィンドウ枠固定）
 *   3. Source_Index       … 出典一覧（HYPERLINK関数でクリック可能なURL）
 *
 * 使い方
 *   npm install exceljs@4.4.0
 *   node generate_template.js                       → research_studio_sample.xlsx（サンプルデータ）
 *   node generate_template.js --template            → research_studio_template.xlsx（{{placeholder}} 入り）
 *   node generate_template.js --data data.json -o report.xlsx
 *
 * アプリから使う場合
 *   const { buildWorkbook } = require('./generate_template');
 *   const wb = await buildWorkbook(reportData);   // reportData は SAMPLE_DATA と同じ構造
 *   await wb.xlsx.writeFile('report.xlsx');        // または wb.xlsx.writeBuffer()
 */
'use strict';

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/* =========================================================
   1. ブランドトークン（Web / PDF と共通）
   ========================================================= */
const C = {
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

/* 指定フォント：和文を含むため Meiryo UI を既定に（BIZ UDPGothic / Segoe UI に変更可） */
const FONT = 'Meiryo UI';

const argb = (hex) => 'FF' + hex;
const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const font = (o = {}) => ({ name: FONT, size: o.size || 10, bold: !!o.bold, italic: !!o.italic,
  underline: o.underline, color: { argb: argb(o.color || C.text) } });
const thin = (hex = C.line) => ({ style: 'thin', color: { argb: argb(hex) } });
const borderAll = (hex = C.line) => ({ top: thin(hex), left: thin(hex), bottom: thin(hex), right: thin(hex) });

/* =========================================================
   2. データ構造（この形で値を渡せば、そのままブックが生成される）
   ========================================================= */
const SAMPLE_DATA = {
  meta: {
    title: '社内ナレッジ検索への生成AI（RAG）導入評価',
    subtitle: '主要3方式の比較分析と段階的導入ロードマップ',
    theme: 'ナレッジマネジメント / 生成AI',
    date: '2026-10-27',
    publisher: 'Research Studio',
    classification: 'CONFIDENTIAL',
    score: 94,
    grade: 'A',
  },
  metrics: [
    { label: '国内市場規模',  value: '1.2兆円',   note: '2026年見込み · 調査会社推計 [1]' },
    { label: '市場成長率',    value: '+18.5%',    note: '年平均成長率（2026–2030） [1]' },
    { label: '導入コスト',    value: '月額9.8万', note: '150名規模・SaaS型の中央値 [3]' },
    { label: '信頼度',        value: '92%',       note: '一次情報で裏付けた論点の比率' },
  ],
  summary: {
    conclusion: 'SaaS型AI検索で小さく始め、3ヶ月のパイロットで検索時間30%短縮を確認できた段階で全社展開へ進むべきである。機密性の高い部門のみ、9ヶ月目以降に自社構築RAGへ移行する二段構えが、リスク調整後の期待値を最大化する。',
    issues: [
      '閲覧権限のない文書が回答に混入するリスク。ACL連携が方式選定の必須要件になる。',
      '回答精度は文書の鮮度・重複・メタデータに左右される。導入前の文書整備が成否を分ける。',
      '従量課金のため、利用拡大に比例してランニングコストが増える。',
    ],
    actions: [
      { phase: '短期 0–3ヶ月',  action: 'SaaS型を2部門・150名で試験導入し、検索時間と正答率のベースラインを計測する', owner: '情報システム部' },
      { phase: '中期 3–9ヶ月',  action: '全部門へ展開し、部門ごとに文書オーナーを任命。ACL同期を月次で監査する',     owner: '推進PMO' },
      { phase: '長期 9–18ヶ月', action: '機密部門のみ自社構築RAGへ移行し、業務システムとの連携を進める',             owner: '情報システム部' },
    ],
  },
  comparison: {
    title: '主要3方式の比較マトリクス',
    note: '評価：◎ 優位　○ 標準　△ 要注意　／　金額は税抜・150名利用時の概算',
    options: ['SaaS型AI検索', '自社構築RAG', '既存検索＋LLM連携'],
    recommended: 0,                          // 推奨する選択肢のインデックス（ヘッダーをシアンで強調）
    rows: [
      { section: '機能' },
      { item: '回答精度（社内QA正答率）',   values: ['○ 85%', '◎ 91%', '△ 68%'],       criteria: '正答率80%以上',                 recommendation: '◎' },
      { item: '閲覧権限（ACL）の継承',      values: ['◎ 標準対応', '○ 実装が必要', '◎ 標準対応'], criteria: '既存の権限を自動で引き継げること', recommendation: '◎' },
      { item: '出典リンクの表示',           values: ['◎', '◎', '○'],                   criteria: '回答の根拠を検証できること',     recommendation: '○' },
      { section: '費用' },
      { item: '初期費用（円）',             values: [500000, 18000000, 3000000],         criteria: '初年度予算2,000万円以内',         recommendation: '◎' },
      { item: '月額費用（円）',             values: [980000, 420000, 650000],            criteria: '3年総額で比較',                   recommendation: '○' },
      { item: '3年総保有コスト（円）',      values: [35780000, 33120000, 26400000],      criteria: '効果額との比較で判断',            recommendation: '○' },
      { section: '運用・リスク' },
      { item: '稼働までの期間',             values: ['2週間', '4–6ヶ月', '1–2ヶ月'],     criteria: '3ヶ月以内にパイロット開始',       recommendation: '◎' },
      { item: '必要な運用体制',             values: ['兼任1名', '専任2名以上', '兼任1名'], criteria: '既存人員で運用できること',       recommendation: '○' },
      { item: 'ベンダーロックイン',         values: ['△ 移行手段が限定的', '◎ 自社保有', '○'], criteria: 'データのエクスポート可否',   recommendation: '△' },
    ],
  },
  sources: [
    { id: 1, domain: 'market.example.com',      score: 92, title: '国内AIソリューション市場規模予測 2026–2030',     url: 'https://market.example.com/reports/ai-solutions-2026' },
    { id: 2, domain: 'papers.example.org',      score: 95, title: '検索拡張生成（RAG）の評価手法に関する技術報告', url: 'https://papers.example.org/rag-evaluation' },
    { id: 3, domain: 'tech.example.net',        score: 78, title: '企業向けAI検索サービス 製品比較ガイド',         url: 'https://tech.example.net/enterprise-ai-search' },
    { id: 4, domain: 'stats.example.go.jp',     score: 97, title: '企業におけるAI活用実態調査 2026',               url: 'https://stats.example.go.jp/ai-survey-2026' },
    { id: 5, domain: 'security.example.or.jp',  score: 90, title: '生成AI導入に伴う情報セキュリティインシデント事例集', url: 'https://security.example.or.jp/genai-incidents' },
    { id: 6, domain: 'blog.example.com',        score: 52, title: 'AI検索ツール乗り換えの実体験レポート',           url: 'https://blog.example.com/ai-search-migration' },
  ],
};

/** {{placeholder}} 入りの雛形データ（--template で出力） */
const PLACEHOLDER_DATA = {
  meta: { title: '{{title}}', subtitle: '{{subtitle}}', theme: '{{theme}}', date: '{{date}}',
    publisher: '{{publisher}}', classification: '{{classification}}', score: '{{score}}', grade: '{{grade}}' },
  metrics: [1, 2, 3, 4].map((i) => ({ label: `{{metric${i}.label}}`, value: `{{m${i}}}`, note: `{{metric${i}.note}}` })),
  summary: {
    conclusion: '{{summary.conclusion}}',
    issues: ['{{summary.issues[0]}}', '{{summary.issues[1]}}', '{{summary.issues[2]}}'],
    actions: [0, 1, 2].map((i) => ({ phase: `{{actions[${i}].phase}}`, action: `{{actions[${i}].action}}`, owner: `{{actions[${i}].owner}}` })),
  },
  comparison: {
    title: '{{comparison.title}}', note: '{{comparison.note}}',
    options: ['{{options[0]}}', '{{options[1]}}', '{{options[2]}}'], recommended: 0,
    rows: [
      { section: '{{table.section}}' },
      { item: '{{table[].item}}', values: ['{{value A}}', '{{value B}}', '{{value C}}'], criteria: '{{table[].criteria}}', recommendation: '{{◎/○/△}}' },
    ],
  },
  sources: [{ id: 1, domain: '{{sources[].domain}}', score: '{{score}}', title: '{{sources[].title}}', url: 'https://example.com/{{sources[].url}}' }],
};

/* =========================================================
   3. ユーティリティ
   ========================================================= */
/** 表示幅（全角=2, 半角=1）。Excel の列幅単位は半角1文字 ≒ 1 */
function textWidth(s) {
  let w = 0;
  for (const ch of String(s ?? '')) w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? 1 : 2;
  return w;
}
/** 折り返し後の行数を見積もる（結合セルは自動で高さが変わらないため） */
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
/** 結合範囲の全セルに塗り・罫線を適用（結合セルの外枠を正しく描画するため） */
function styleRange(ws, r1, c1, r2, c2, style) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const cell = ws.getCell(r, c);
    if (style.fill) cell.fill = style.fill;
    if (style.border) cell.border = style.border;
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
   4. Sheet 1 — Executive_Summary
   ========================================================= */
function buildSummary(wb, d) {
  const ws = wb.addWorksheet('Executive_Summary', {
    properties: { tabColor: { argb: argb(C.navy) } },
    views: [{ showGridLines: false, zoomScale: 100 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&8${d.meta.classification}&C&8© Research Studio&R&8&P / &N` },
  });
  // 8列グリッド（KPIカード = 2列 × 4）
  for (let c = 1; c <= 8; c++) ws.getColumn(c).width = 17;

  // --- バナー（行1–2）：A1:C2 タイトル（グラデーション）／ D1:F2 サブタイトル／ G1:H2 信頼度
  ws.getRow(1).height = 30; ws.getRow(2).height = 30;
  // A1:C2 に収まるよう、タイトルの長さでサイズを段階調整
  const tw = textWidth(d.meta.title);
  const titleSize = tw <= 28 ? 18 : tw <= 40 ? 15 : 13;
  mergeSet(ws, 'A1:C2', d.meta.title, {
    font: font({ size: titleSize, bold: true, color: C.white }),
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 },
    fill: { type: 'gradient', gradient: 'angle', degree: 0,
      stops: [{ position: 0, color: { argb: argb(C.navy) } }, { position: 1, color: { argb: argb(C.blueDeep) } }] },
  });
  mergeSet(ws, 'D1:F2', d.meta.subtitle, {
    font: font({ size: 10, color: 'CBD5E1' }), fill: fill(C.blueDeep),
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 },
  });
  styleRange(ws, 1, 4, 2, 6, { fill: fill(C.blueDeep) });
  mergeSet(ws, 'G1:H1', 'CONFIDENCE SCORE', {
    font: font({ size: 8, bold: true, color: C.cyanText }), fill: fill(C.navy),
    alignment: { vertical: 'bottom', horizontal: 'center' },
  });
  const scoreText = typeof d.meta.score === 'number' ? `${d.meta.score}点 / Grade ${d.meta.grade}` : `${d.meta.score} / Grade ${d.meta.grade}`;
  mergeSet(ws, 'G2:H2', scoreText, {
    font: font({ size: textWidth(scoreText) > 18 ? 12 : 16, bold: true, color: C.white }), fill: fill(C.navy),
    alignment: { vertical: 'top', horizontal: 'center', shrinkToFit: true },
  });
  styleRange(ws, 1, 7, 2, 8, { fill: fill(C.navy) });

  // --- アクセントライン（行3）：ブランドグラデーション
  ws.getRow(3).height = 4;
  ws.mergeCells('A3:H3');
  ws.getCell('A3').fill = { type: 'gradient', gradient: 'angle', degree: 0, stops: [
    { position: 0, color: { argb: argb(C.blue) } }, { position: 0.55, color: { argb: argb(C.cyan) } }, { position: 1, color: { argb: argb(C.indigo) } }] };

  // --- メタ情報（行5–6）
  ws.getRow(4).height = 8;
  const meta = [['調査テーマ', d.meta.theme], ['作成日', d.meta.date], ['発行元', d.meta.publisher], ['機密区分', d.meta.classification]];
  meta.forEach(([label, value], i) => {
    const c1 = 1 + i * 2, c2 = c1 + 1;
    const L = ws.getCell(5, c1).address, R = ws.getCell(5, c2).address;
    const L2 = ws.getCell(6, c1).address, R2 = ws.getCell(6, c2).address;
    mergeSet(ws, `${L}:${R}`, label, { font: font({ size: 8, bold: true, color: C.muted }), alignment: { vertical: 'bottom', indent: 1 } });
    const isClass = label === '機密区分';
    mergeSet(ws, `${L2}:${R2}`, value, {
      font: font({ size: 11, bold: true, color: isClass ? C.critFg : C.ink }),
      alignment: { vertical: 'middle', indent: 1 },
      fill: isClass ? fill(C.critBg) : undefined,
    });
    styleRange(ws, 6, c1, 6, c2, { border: { bottom: thin(C.line) } });
    if (isClass) styleRange(ws, 6, c1, 6, c2, { fill: fill(C.critBg), border: { bottom: thin(C.line) } });
  });
  ws.getRow(5).height = 16; ws.getRow(6).height = 24;

  // --- KPIカード（行8–12）
  ws.getRow(7).height = 12;
  sectionHeader(ws, 8, 'KEY METRICS', '主要指標');
  const cardTop = 9;
  ws.getRow(cardTop).height = 20; ws.getRow(cardTop + 1).height = 26; ws.getRow(cardTop + 2).height = 14; ws.getRow(cardTop + 3).height = 30;
  d.metrics.slice(0, 4).forEach((m, i) => {
    const c1 = 1 + i * 2, c2 = c1 + 1;
    const a = (r, c) => ws.getCell(r, c).address;
    // 背景・外枠（カード間は白の太線で余白を表現）
    for (let r = cardTop; r <= cardTop + 3; r++) for (let c = c1; c <= c2; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = fill(C.paper);
      cell.border = {
        top: r === cardTop ? { style: 'thick', color: { argb: argb(C.cyan) } } : undefined,
        bottom: r === cardTop + 3 ? thin(C.line) : undefined,
        left: c === c1 ? { style: 'medium', color: { argb: argb(C.white) } } : undefined,
        right: c === c2 ? { style: 'medium', color: { argb: argb(C.white) } } : undefined,
      };
    }
    mergeSet(ws, `${a(cardTop, c1)}:${a(cardTop, c2)}`, m.label, { font: font({ size: 9, bold: true, color: C.muted }), alignment: { vertical: 'bottom', indent: 1 } });
    mergeSet(ws, `${a(cardTop + 1, c1)}:${a(cardTop + 2, c2)}`, m.value, { font: font({ size: 22, bold: true, color: C.ink }), alignment: { vertical: 'middle', indent: 1 } });
    mergeSet(ws, `${a(cardTop + 3, c1)}:${a(cardTop + 3, c2)}`, m.note, { font: font({ size: 8, color: C.muted }), alignment: { vertical: 'top', wrapText: true, indent: 1 } });
  });

  // --- エグゼクティブサマリー（行15〜）
  let r = cardTop + 5;
  ws.getRow(r - 1).height = 12;
  sectionHeader(ws, r, 'EXECUTIVE SUMMARY', '結論・課題・推奨アクション');
  r += 1;

  const bodyW = colsWidth(ws, 2, 8);
  // 結論
  labelCell(ws, r, r, '結論', C.navy, C.white);
  mergeSet(ws, `B${r}:H${r}`, d.summary.conclusion, {
    font: font({ size: 11, bold: true, color: C.ink }), fill: fill(C.blue50),
    alignment: { vertical: 'middle', wrapText: true, indent: 1 },
  });
  styleRange(ws, r, 2, r, 8, { fill: fill(C.blue50), border: { bottom: thin(C.line) } });
  ws.getRow(r).height = Math.max(36, estimateLines(d.summary.conclusion, bodyW, 11) * lineHeightPt(11) + 10);
  r += 1;

  // 課題
  const issues = d.summary.issues || [];
  if (issues.length) {
    labelCell(ws, r, r + issues.length - 1, '主要な課題', C.warnBg, C.warnFg);
    issues.forEach((t, i) => {
      const row = r + i;
      ws.getCell(row, 2).value = `0${i + 1}`;
      ws.getCell(row, 2).font = font({ size: 10, bold: true, color: C.warnFg });
      ws.getCell(row, 2).alignment = { vertical: 'middle', horizontal: 'center' };
      mergeSet(ws, `C${row}:H${row}`, t, { font: font({ size: 10, color: C.text }), alignment: { vertical: 'middle', wrapText: true, indent: 1 } });
      styleRange(ws, row, 2, row, 8, { border: { bottom: thin(C.line) } });
      ws.getRow(row).height = Math.max(22, estimateLines(t, colsWidth(ws, 3, 8)) * lineHeightPt(10) + 6);
    });
    r += issues.length;
  }

  // 推奨ネクストアクション
  const actions = d.summary.actions || [];
  if (actions.length) {
    labelCell(ws, r, r + actions.length - 1, '推奨ネクスト\nアクション', C.goodBg, C.goodFg);
    actions.forEach((a, i) => {
      const row = r + i;
      ws.getCell(row, 2).value = a.phase;
      ws.getCell(row, 2).font = font({ size: 9, bold: true, color: C.goodFg });
      ws.getCell(row, 2).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      mergeSet(ws, `C${row}:G${row}`, a.action, { font: font({ size: 10, color: C.ink }), alignment: { vertical: 'middle', wrapText: true, indent: 1 } });
      ws.getCell(row, 8).value = a.owner;
      ws.getCell(row, 8).font = font({ size: 9, color: C.muted });
      ws.getCell(row, 8).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      styleRange(ws, row, 2, row, 8, { border: { bottom: thin(C.line) } });
      ws.getRow(row).height = Math.max(24, estimateLines(a.action, colsWidth(ws, 3, 7)) * lineHeightPt(10) + 8);
    });
    r += actions.length;
  }

  // フッター注記
  r += 1;
  mergeSet(ws, `A${r}:H${r}`,
    '本レポートは公開情報をもとにAIが自動収集・分析した結果であり、正確性・完全性を保証するものではありません。出典は Source_Index シートを参照してください。',
    { font: font({ size: 8, color: C.faint }), alignment: { wrapText: true, vertical: 'top' } });
  ws.getRow(r).height = 24;
  ws.pageSetup.printArea = `A1:H${r}`;
  return ws;
}

function sectionHeader(ws, row, en, ja) {
  ws.getRow(row).height = 22;
  mergeSet(ws, `A${row}:D${row}`, { richText: [
    { text: en + '  ', font: font({ size: 10, bold: true, color: C.blue }) },
    { text: ja, font: font({ size: 9, color: C.muted }) },
  ] }, { alignment: { vertical: 'bottom' } });
  styleRange(ws, row, 1, row, 8, { border: { bottom: { style: 'medium', color: { argb: argb(C.navy) } } } });
}
function labelCell(ws, r1, r2, text, bg, fg) {
  const range = r1 === r2 ? `A${r1}` : `A${r1}:A${r2}`;
  if (r1 !== r2) ws.mergeCells(range);
  const cell = ws.getCell(`A${r1}`);
  cell.value = text;
  cell.font = font({ size: 10, bold: true, color: fg });
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  styleRange(ws, r1, 1, r2, 1, { fill: fill(bg), border: { bottom: { style: 'thin', color: { argb: argb(C.white) } } } });
}

/* =========================================================
   5. Sheet 2 — Comparison_Matrix
   ========================================================= */
function buildComparison(wb, d) {
  const cmp = d.comparison;
  const ws = wb.addWorksheet('Comparison_Matrix', {
    properties: { tabColor: { argb: argb(C.blue) } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&8${d.meta.classification}&C&8© Research Studio&R&8&P / &N` },
  });
  const widths = [30, 24, 24, 24, 34, 11];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const lastCol = 6;

  // 1行目：大見出し
  ws.getRow(1).height = 34;
  mergeSet(ws, 'A1:F1', cmp.title, {
    font: font({ size: 16, bold: true, color: C.white }), fill: fill(C.navy),
    alignment: { vertical: 'middle', indent: 1 },
  });
  styleRange(ws, 1, 1, 1, lastCol, { fill: fill(C.navy) });
  // 2行目：注記
  ws.getRow(2).height = 22;
  mergeSet(ws, 'A2:F2', cmp.note || '', { font: font({ size: 9, color: C.muted }), alignment: { vertical: 'middle', indent: 1 } });

  // 3行目：ヘッダー
  const headers = ['項目名', ...cmp.options.slice(0, 3), '選定基準', '推奨度'];
  ws.getRow(3).height = 28;
  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    const isRec = i >= 1 && i <= 3 && cmp.recommended === i - 1;
    cell.value = isRec ? `★ ${h}（推奨）` : h;
    cell.font = font({ size: 10, bold: true, color: C.white });
    cell.fill = fill(isRec ? C.cyan : C.navy);
    cell.alignment = { vertical: 'middle', horizontal: i === 0 || i === 4 ? 'left' : 'center', indent: i === 0 || i === 4 ? 1 : 0, wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: argb(C.blue) } }, right: thin('334155') };
  });

  // 4行目以降：データ
  let r = 4, zebra = 0;
  for (const row of cmp.rows) {
    if (row.section !== undefined) {           // サブヘッダー行（Royal Blue）
      ws.getRow(r).height = 20;
      mergeSet(ws, `A${r}:F${r}`, row.section, { font: font({ size: 9, bold: true, color: C.white }), alignment: { vertical: 'middle', indent: 1 } });
      styleRange(ws, r, 1, r, lastCol, { fill: fill(C.blue) });
      r++; zebra = 0; continue;
    }
    const bg = zebra % 2 === 1 ? C.paper : C.white;
    const cells = [row.item, ...(row.values || []).slice(0, 3), row.criteria, row.recommendation];
    let maxLines = 1;
    cells.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = v ?? '';
      cell.fill = fill(bg);
      cell.border = { bottom: thin(C.line), right: thin(C.line) };
      const isNum = typeof v === 'number';
      if (i === 0) {
        cell.font = font({ size: 10, bold: true, color: C.ink });
        cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      } else if (i === 5) {
        const st = statusOf(v);
        cell.font = font({ size: 11, bold: true, color: st === 'good' ? C.goodFg : st === 'warn' ? C.warnFg : C.text });
        if (st !== 'neutral') cell.fill = fill(st === 'good' ? C.goodBg : C.warnBg);
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (i === 4) {
        cell.font = font({ size: 9, color: C.muted });
        cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      } else if (isNum) {
        cell.numFmt = '#,##0';
        cell.font = font({ size: 10, color: C.ink });
        cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
      } else {
        const short = textWidth(v) <= 12;
        cell.font = font({ size: 10, color: C.text });
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
    r++; zebra++;
  }
  const last = r - 1;

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: lastCol } };
  ws.pageSetup.printArea = `A1:F${last}`;
  return ws;
}

/* =========================================================
   6. Sheet 3 — Source_Index
   ========================================================= */
function buildSources(wb, d) {
  const ws = wb.addWorksheet('Source_Index', {
    properties: { tabColor: { argb: argb(C.cyan) } },
    views: [{ state: 'frozen', ySplit: 3, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L&8${d.meta.classification}&C&8© Research Studio&R&8&P / &N` },
  });
  const urlMax = Math.max(30, ...d.sources.map((s) => textWidth(s.url) + 2));
  const titleMax = Math.max(36, ...d.sources.map((s) => textWidth(s.title) + 2));
  const widths = [10, 26, 13, Math.min(titleMax, 60), Math.min(urlMax, 60)];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  ws.getRow(1).height = 34;
  mergeSet(ws, 'A1:E1', '引用元・エビデンス一覧', { font: font({ size: 16, bold: true, color: C.white }), fill: fill(C.navy), alignment: { vertical: 'middle', indent: 1 } });
  styleRange(ws, 1, 1, 1, 5, { fill: fill(C.navy) });
  ws.getRow(2).height = 22;
  mergeSet(ws, 'A2:E2', `信頼度スコア：80以上＝高（緑）　60–79＝中　60未満＝要注意（橙）　／　全${d.sources.length}件`,
    { font: font({ size: 9, color: C.muted }), alignment: { vertical: 'middle', indent: 1 } });

  const headers = ['出典ID', '情報源ドメイン', '信頼度スコア', '記事タイトル', 'URL'];
  ws.getRow(3).height = 26;
  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.font = font({ size: 10, bold: true, color: C.white });
    cell.fill = fill(C.navy);
    cell.alignment = { vertical: 'middle', horizontal: i === 0 || i === 2 ? 'center' : 'left', indent: i === 0 || i === 2 ? 0 : 1 };
    cell.border = { bottom: { style: 'medium', color: { argb: argb(C.blue) } } };
  });

  d.sources.forEach((s, i) => {
    const r = 4 + i;
    const bg = i % 2 === 1 ? C.paper : C.white;
    const row = ws.getRow(r);
    row.height = Math.max(22, estimateLines(s.title, widths[3]) * lineHeightPt(10) + 6);
    const vals = [
      `[${s.id}]`,
      s.domain,
      s.score,
      s.title,
      // HYPERLINK関数：result を入れておくと再計算前でも表示される
      { formula: `HYPERLINK("${excelStr(s.url)}","${excelStr(s.url)}")`, result: s.url },
    ];
    vals.forEach((v, j) => {
      const cell = ws.getCell(r, j + 1);
      cell.value = v;
      cell.fill = fill(bg);
      cell.border = { bottom: thin(C.line) };
      cell.alignment = { vertical: 'middle', horizontal: j === 0 || j === 2 ? 'center' : 'left', indent: j === 0 || j === 2 ? 0 : 1, wrapText: j === 3 };
      cell.font = font({ size: 10, color: j === 0 ? C.blue : j === 1 ? C.muted : C.ink, bold: j === 0 || j === 2 });
    });
    ws.getCell(r, 5).font = font({ size: 10, color: C.blue, underline: true });
    if (typeof s.score === 'number') ws.getCell(r, 3).numFmt = '0';
  });
  const last = 3 + d.sources.length;

  // 信頼度スコアの条件付き書式（値を書き換えても色が追従する）
  ws.addConditionalFormatting({
    ref: `C4:C${last}`,
    rules: [
      { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [80], priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(C.goodBg) } }, font: { color: { argb: argb(C.goodFg) }, bold: true } } },
      { type: 'cellIs', operator: 'lessThan', formulae: [60], priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(C.warnBg) } }, font: { color: { argb: argb(C.warnFg) }, bold: true } } },
    ],
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: last, column: 5 } };
  ws.pageSetup.printArea = `A1:E${last}`;
  return ws;
}

/* =========================================================
   7. エントリーポイント
   ========================================================= */
async function buildWorkbook(data = SAMPLE_DATA) {
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

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  let data = SAMPLE_DATA, out = 'research_studio_sample.xlsx';
  if (args.includes('--template')) { data = PLACEHOLDER_DATA; out = 'research_studio_template.xlsx'; }
  if (get('--data')) { data = JSON.parse(fs.readFileSync(get('--data'), 'utf8')); out = 'research_studio_report.xlsx'; }
  if (get('-o')) out = get('-o');
  const wb = await buildWorkbook(data);
  await wb.xlsx.writeFile(out);
  console.log('Generated:', path.resolve(out));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildWorkbook, SAMPLE_DATA, PLACEHOLDER_DATA, BRAND: C };

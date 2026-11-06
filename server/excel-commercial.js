"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR = exports.dispWidth = exports.SHEETS = void 0;
exports.splitForRows = splitForRows;
exports.generateCommercialExcel = generateCommercialExcel;
exports.verifyNoDataLoss = verifyNoDataLoss;
/**
 * Research Studio — Commercial Excel Report Generator (ExcelJS)
 * =====================================================================
 * generateCommercialExcel(data, options?) → Promise<ExcelJS.Workbook>
 *
 * 設計原則：「AIが集めた事実を、型にはめず・削らず・書き換えずに格納する」
 *   1. 原文保持   … セル値は入力のまま。数値化するのは "92" "1,200" のように表示が一字一句変わらない場合だけ
 *   2. 切り捨てなし … Excel の上限（1セル32,767字・1行409pt）を超える長文は、文の切れ目で複数行に分割して全文を掲載
 *   3. 構造の非固定 … 比較表の列は table.columns / rows から動的生成。行ごとの列数のズレやオブジェクト形式の行も欠落させない
 *   4. 未知フィールド保全 … スキーマにないキーも捨てず、各シートの「補足データ」「付録」に原文のまま展開
 *   5. 検証可能性 … verifyNoDataLoss() で「入力の全文字列がブック内に存在するか」を自動検査できる
 *
 * 依存：exceljs@4.x のみ
 */
const exceljs_1 = __importDefault(require("exceljs"));
/* =====================================================================
   デザイントークン
   ===================================================================== */
exports.SHEETS = {
    summary: '01_Executive_Summary',
    matrix: '02_Comparison_Matrix',
    report: '03_Detailed_Report',
    sources: '04_Sources_Data',
};
const COLOR = {
    ink: '0F172A', // 見出し・ブランド
    slate: '1E293B', // 表ヘッダー背景／本文
    band: 'F1F5F9', // サブヘッダー・帯
    border: 'E2E8F0', // 罫線（細線のみ）
    white: 'FFFFFF',
    muted: '64748B', // 注記・メタ
    link: '2563EB',
    go: { bg: 'DCFCE7', fg: '166534' },
    hold: { bg: 'FEF9C3', fg: '854D0E' },
    nogo: { bg: 'FEE2E2', fg: '991B1B' },
};
exports.COLOR = COLOR;
const PT = { h1: 16, h2: 12, th: 10, body: 9.5, meta: 8, kpi: 16 };
const MAX_ROW_PT = 409; // Excel の行高さ上限
const MAX_CELL_CHARS = 32000; // 32,767 に安全マージン
const LINE = 1.6; // 行送り（游ゴシックは字面が高いため 1.6 倍）
const UNIT = 0.92; // 9.5pt の半角1文字 ≒ 列幅 0.92 単位（Calibri 11pt の "0" 基準）
const argb = (hex) => 'FF' + hex;
const solid = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const thin = { style: 'thin', color: { argb: argb(COLOR.border) } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
/* =====================================================================
   文字幅・行高さの見積もり
   ===================================================================== */
const WIDE = /[ᄀ-ᅟ←-⇿①-⓿─-➿⺀-〾ぁ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const isWide = (ch) => WIDE.test(ch) || (ch.codePointAt(0) ?? 0) > 0xffff;
/** 表示幅（半角=1・全角=2） */
const dispWidth = (s) => Array.from(s).reduce((w, ch) => w + (isWide(ch) ? 2 : 1), 0);
exports.dispWidth = dispWidth;
const maxLineWidth = (s) => Math.max(0, ...s.split('\n').map(exports.dispWidth));
/** 列幅 widthUnits のセルで text を折り返したときの行数 */
function lineCount(text, widthUnits, pt) {
    const perLine = Math.max(1, (widthUnits - 1.5) / (UNIT * pt / PT.body));
    return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((0, exports.dispWidth)(l) / perLine)), 0);
}
/** 折り返しに必要な行高さ（pt）。上限 409pt */
function rowHeight(text, widthUnits, pt, min = 18) {
    return Math.min(MAX_ROW_PT, Math.max(min, Math.ceil(lineCount(text, widthUnits, pt) * pt * LINE + 6)));
}
const maxLinesPerRow = (pt) => Math.floor((MAX_ROW_PT - 8) / (pt * LINE));
/** 本文の分割単位（約200pt≒10行）。Excel は行単位でスクロールするため、巨大な行を作らない */
const CHUNK_PT = 200;
/**
 * 長文を文の切れ目で複数行に分割する（1行あたり約200pt。Excel の上限 409pt／32,767字も必ず下回る）。
 * 連結すると必ず元の文字列に一致する（1文字も足さない・削らない）。
 */
function splitForRows(text, widthUnits, pt = PT.body) {
    const limit = Math.floor((CHUNK_PT - 8) / (pt * LINE));
    const fits = (s) => lineCount(s, widthUnits, pt) <= limit && s.length <= MAX_CELL_CHARS;
    if (fits(text))
        return [text];
    const pieces = text.match(/[^。！？!?．\n]*(?:[。！？!?．]+[」』）)]*|\n|$)/g)?.filter(Boolean) ?? [text];
    const units = pieces.join('') === text ? pieces : Array.from(text);
    const out = [];
    let buf = '';
    for (const u of units) {
        if (buf && !fits(buf + u)) {
            out.push(buf);
            buf = '';
        }
        if (!fits(u)) { // 1文だけで上限を超える場合は文字単位で分割
            for (const ch of Array.from(u)) {
                if (buf && !fits(buf + ch)) {
                    out.push(buf);
                    buf = '';
                }
                buf += ch;
            }
        }
        else
            buf += u;
    }
    if (buf)
        out.push(buf);
    return out;
}
/* =====================================================================
   値の扱い（原文保持）
   ===================================================================== */
const str = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** 表示が一字一句変わらない場合だけ数値化（"92"→92、"1,200"→1200＋#,##0）。それ以外は文字列のまま */
function typed(v) {
    if (typeof v === 'number' || typeof v === 'boolean')
        return { value: v };
    if (v === null || v === undefined)
        return { value: null };
    const s = String(v);
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s) && String(Number(s)) === s)
        return { value: Number(s) };
    if (/^-?[1-9]\d{0,2}(,\d{3})+$/.test(s))
        return { value: Number(s.replace(/,/g, '')), numFmt: '#,##0' };
    return { value: s };
}
function statusOf(v) {
    const s = str(v).trim();
    if (!s)
        return null;
    if (/^(×|✕|✖|懸念|不可|不採用|非推奨|no-?go\b|ng\b)/i.test(s))
        return 'nogo';
    if (/^(△|▲|留意|保留|要検討|条件付|hold\b)/i.test(s))
        return 'hold';
    if (/^(◎|推奨|採用|go\b)/i.test(s))
        return 'go';
    if (/^(○|〇|◯|適合|標準)/.test(s))
        return 'neutral';
    return null;
}
function verdictOf(v) {
    const s = str(v).trim().toLowerCase().replace(/[\s_]/g, '');
    if (/^(no-?go|nogo|reject|否決|懸念|中止|見送)/.test(s))
        return 'nogo';
    if (/^(hold|conditional|pending|保留|留意|条件付)/.test(s))
        return 'hold';
    if (/^(go|approve|承認|推奨|採用)/.test(s))
        return 'go';
    return null;
}
const VERDICT_LABEL = { go: 'GO（推奨）', hold: 'HOLD（留意）', nogo: 'NO-GO（懸念）' };
function scoreStatus(n) {
    const x = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(x))
        return null;
    return x >= 85 ? 'go' : x >= 70 ? 'hold' : 'nogo';
}
function safeUrl(u) {
    const s = str(u).trim();
    return /^(https?:\/\/|mailto:)/i.test(s) ? s : null;
}
function domainOf(u) {
    try {
        return new URL(str(u)).hostname.replace(/^www\./, '');
    }
    catch {
        return '';
    }
}
/** ISO日時 → 指定タイムゾーンの壁時計時刻を持つ Date（Excel はタイムゾーンを持たないため） */
function toZonedDate(iso, timeZone) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second));
}
const tzLabel = (tz) => (tz === 'Asia/Tokyo' ? 'JST' : tz);
/** 未知フィールドを「キー：値」の行に展開（入れ子は字下げ） */
function flatten(value, key, depth = 0) {
    const label = key !== undefined ? key : '';
    if (value === null || typeof value !== 'object') {
        return [{ depth, text: key !== undefined ? `${label}：${str(value)}` : str(value) }];
    }
    const head = key !== undefined ? [{ depth, text: `${label}：` }] : [];
    const d = depth + (key !== undefined ? 1 : 0);
    if (Array.isArray(value)) {
        return head.concat(value.flatMap((v, i) => v !== null && typeof v === 'object' ? flatten(v, `[${i + 1}]`, d) : [{ depth: d, text: '・' + str(v) }]));
    }
    return head.concat(Object.entries(value).flatMap(([k, v]) => flatten(v, k, d)));
}
const extras = (obj, known) => isPlainObject(obj) ? Object.fromEntries(Object.entries(obj).filter(([k, v]) => !known.includes(k) && v !== undefined)) : {};
const LATIN = /[ -~ -ɏ -‧‰-⁞]/;
function makeWriter(ctx) {
    const font = (s, name) => ({
        name, size: s.size ?? PT.body, bold: !!s.bold, italic: !!s.italic, underline: s.underline,
        color: { argb: argb(s.color ?? COLOR.slate) },
    });
    /** 日本語は和文フォント、英数字は欧文フォントでリッチテキスト化 */
    function richValue(text, s) {
        if (!ctx.mixed || s.plain || !text)
            return text;
        const segs = [];
        for (const ch of Array.from(text)) {
            const lat = /\s/.test(ch) && segs.length ? segs[segs.length - 1].latin : LATIN.test(ch);
            const last = segs[segs.length - 1];
            if (last && last.latin === lat)
                last.t += ch;
            else
                segs.push({ latin: lat, t: ch });
        }
        if (segs.length <= 1)
            return text;
        return { richText: segs.map((g) => ({ text: g.t, font: font(s, g.latin ? ctx.latin : ctx.jp) })) };
    }
    function put(cell, v, s = {}) {
        if (v !== null && typeof v === 'object') { // 数式・ハイパーリンク・日付はそのまま
            cell.value = v;
            const shown = str(v.result ?? v.text ?? '');
            cell.font = font(s, shown && !Array.from(shown).every((ch) => LATIN.test(ch) || /\s/.test(ch)) ? ctx.jp : ctx.latin);
        }
        else {
            const t = typed(v);
            if (typeof t.value === 'string') {
                const allLatin = Array.from(t.value).every((ch) => LATIN.test(ch) || /\s/.test(ch));
                cell.value = richValue(t.value, s);
                cell.font = font(s, allLatin && t.value ? ctx.latin : ctx.jp);
            }
            else {
                cell.value = t.value;
                cell.font = font(s, ctx.latin);
                if (t.numFmt)
                    cell.numFmt = t.numFmt;
            }
        }
        if (s.numFmt)
            cell.numFmt = s.numFmt;
        if (s.fill)
            cell.fill = solid(s.fill);
        if (s.border)
            cell.border = s.border;
        cell.alignment = { vertical: 'top', wrapText: true, ...(s.align ?? {}) };
        return cell;
    }
    /** 結合して書き込み（結合範囲の全セルに塗り・罫線を適用） */
    function merge(ws, r1, c1, r2, c2, v, s = {}) {
        if (r1 !== r2 || c1 !== c2)
            ws.mergeCells(r1, c1, r2, c2);
        for (let r = r1; r <= r2; r++)
            for (let c = c1; c <= c2; c++) {
                const cell = ws.getCell(r, c);
                if (s.fill)
                    cell.fill = solid(s.fill);
                if (s.border)
                    cell.border = s.border;
            }
        return put(ws.getCell(r1, c1), v, s);
    }
    const link = (text, target, tooltip) => ({ text, hyperlink: target, tooltip: tooltip ?? text });
    /**
     * シート内ジャンプは HYPERLINK 関数で作る。
     * ExcelJS の内部リンク（"#Sheet!A1"）は外部リンク用リレーションと "#" 付き location を同時に書き出すため、
     * Excel / LibreOffice で「参照が正しくありません」になることがある。関数なら保存方法に依存せず確実に動く。
     */
    const jump = (text, sheet, addr) => ({ formula: `HYPERLINK("#'${sheet}'!${addr}","${text.replace(/"/g, '""')}")`, result: text });
    return { put, merge, link, jump, font };
}
/* 各シート共通：タイトル（16pt）・メタ行（8pt）・目次への導線 */
function sheetHeader(ws, w, lastCol, title, meta, withBackLink) {
    ws.getRow(1).height = 30;
    w.merge(ws, 1, 2, 1, lastCol, title, { size: PT.h1, bold: true, color: COLOR.ink, align: { vertical: 'middle', wrapText: false } });
    ws.getRow(2).height = 16;
    w.merge(ws, 2, 2, 2, lastCol, meta, { size: PT.meta, color: COLOR.muted, align: { vertical: 'middle', wrapText: false } });
    if (withBackLink) {
        ws.getRow(3).height = 18;
        // 遷移先（目次の行）はサマリー作成後に確定するため、仮に A1 を設定
        w.put(ws.getCell(3, 2), w.jump('◀ 目次へ戻る（01_Executive_Summary）', exports.SHEETS.summary, 'A1'), { size: PT.meta, color: COLOR.link, underline: true, align: { vertical: 'middle', wrapText: false } });
    }
}
function sectionBand(ws, w, row, c1, c2, text) {
    ws.getRow(row).height = 24;
    w.merge(ws, row, c1, row, c2, text, { size: PT.h2, bold: true, color: COLOR.ink, fill: COLOR.band, border: { bottom: thin }, align: { vertical: 'middle', indent: 1, wrapText: false } });
}
function printSetup(ws, ctx, title, orientation, titleRows) {
    ws.pageSetup = {
        ...ws.pageSetup, paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        horizontalCentered: true, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
        ...(titleRows ? { printTitlesRow: titleRows } : {}),
    };
    const esc = (s) => s.replace(/&/g, '&&');
    ws.headerFooter = {
        oddHeader: `&L&8${esc(title)}&R&8${esc(ws.name)}`,
        oddFooter: `&L&8${esc(ctx.classification)}&C&8Research Studio&R&8&P / &N`,
    };
}
/* 条件付き書式（値を編集しても色が追従する） */
function cfStatus(ws, ref, topLeft) {
    const x = `TRIM(${topLeft})`;
    const rule = (formula, c, priority) => ({
        type: 'expression', priority, formulae: [formula],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(c.bg) } }, font: { color: { argb: argb(c.fg) }, bold: true } },
    });
    ws.addConditionalFormatting({
        ref,
        rules: [
            rule(`OR(LEFT(${x},1)="×",LEFT(${x},1)="✕",LEFT(${x},2)="懸念",LEFT(${x},2)="不可",LEFT(${x},3)="不採用",LEFT(${x},3)="非推奨",LEFT(UPPER(${x}),5)="NO-GO",LEFT(UPPER(${x}),4)="NOGO")`, COLOR.nogo, 1),
            rule(`OR(LEFT(${x},1)="△",LEFT(${x},1)="▲",LEFT(${x},2)="留意",LEFT(${x},2)="保留",LEFT(${x},3)="要検討",LEFT(${x},3)="条件付",LEFT(UPPER(${x}),4)="HOLD")`, COLOR.hold, 2),
            rule(`OR(LEFT(${x},1)="◎",LEFT(${x},2)="推奨",LEFT(${x},2)="採用",UPPER(${x})="GO",LEFT(UPPER(${x}),3)="GO ",LEFT(UPPER(${x}),3)="GO（",LEFT(UPPER(${x}),3)="GO(")`, COLOR.go, 3),
        ],
    });
}
function cfScore(ws, ref, topLeft) {
    const rule = (formula, c, priority) => ({
        type: 'expression', priority, formulae: [formula],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(c.bg) } }, font: { color: { argb: argb(c.fg) }, bold: true } },
    });
    ws.addConditionalFormatting({
        ref,
        rules: [
            rule(`AND(ISNUMBER(${topLeft}),${topLeft}>=85)`, COLOR.go, 1),
            rule(`AND(ISNUMBER(${topLeft}),${topLeft}>=70,${topLeft}<85)`, COLOR.hold, 2),
            rule(`AND(ISNUMBER(${topLeft}),${topLeft}<70)`, COLOR.nogo, 3),
        ],
    });
}
const colLetter = (n) => { let s = ''; while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
} return s; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** 列幅＝最長行の表示幅 × 0.92 ＋ 余白3。見出しは太字10ptのため 1.1 倍で評価。最小12・最大50 */
const autoWidth = (header, values, lo = 12, hi = 50) => clamp(Math.ceil(Math.max(maxLineWidth(header) * 1.1, ...values.map(maxLineWidth)) * UNIT + 3), lo, hi);
/* =====================================================================
   メイン
   ===================================================================== */
async function generateCommercialExcel(rawInput, options = {}) {
    if (options.colors) Object.assign(COLOR, options.colors);
    // スキーマ正規化：rawInput が { meta: { title, ... } } のラップ形式でも、直接 { title, ... } でも両方透過的に処理
    const data = (rawInput && rawInput.meta) ? {
        title: rawInput.meta.title || rawInput.title,
        theme: rawInput.meta.theme || rawInput.theme,
        generatedAt: rawInput.meta.date || rawInput.generatedAt,
        publisher: rawInput.meta.publisher || rawInput.publisher,
        confidenceScore: rawInput.meta.score ?? rawInput.confidenceScore,
        summary: rawInput.summary?.conclusion || rawInput.summary,
        metrics: rawInput.metrics,
        decision: rawInput.decision || rawInput.summary?.decision,
        table: rawInput.table || (rawInput.comparison ? {
            caption: rawInput.comparison.title || '比較分析表',
            columns: rawInput.comparison.headers || (rawInput.comparison.options ? ['選択肢', '総合判定', 'レイテンシ', 'コスト', '推奨理由'] : []),
            rows: rawInput.comparison.rows || (rawInput.comparison.options ? rawInput.comparison.options.map(o => [o.name, o.verdict || o.status, o.latency || '-', o.cost || '-', o.reason || '-']) : [])
        } : undefined),
        sections: rawInput.sections,
        sources: rawInput.sources,
        ...rawInput
    } : (rawInput || {});

    // シート命名の決定
    const useLegacy = options.sheetNaming === 'legacy' || options.numberedSheets === false;
    const SHEETS = useLegacy ? {
        summary: 'Executive_Summary',
        matrix: 'Comparison_Matrix',
        report: 'Detailed_Report',
        sources: 'Source_Index',
    } : {
        summary: '01_Executive_Summary',
        matrix: '02_Comparison_Matrix',
        report: '03_Detailed_Report',
        sources: '04_Sources_Data',
    };
    Object.assign(exports.SHEETS, SHEETS);

    const ctx = {
        jp: options.fonts?.jp ?? '游ゴシック',
        latin: options.fonts?.latin ?? 'Segoe UI',
        mixed: (options.fontMode ?? 'mixed') === 'mixed',
        tz: options.timeZone ?? 'Asia/Tokyo',
        classification: options.classification ?? (rawInput?.meta?.classification) ?? 'CONFIDENTIAL',
    };
    const w = makeWriter(ctx);
    const title = str(data.title) || 'Research Report';
    const zoned = toZonedDate(data.generatedAt, ctx.tz);
    const dateText = zoned ? zoned.toISOString().slice(0, 16).replace('T', ' ') + ` (${tzLabel(ctx.tz)})` : str(data.generatedAt);
    const score = typeof data.confidenceScore === 'number' ? data.confidenceScore : typed(data.confidenceScore).value;
    const metaLine = [data.theme && `テーマ：${data.theme}`, dateText && `調査日時：${dateText}`, data.publisher && `作成：${data.publisher}`,
        score !== null && score !== undefined && score !== '' && `総合信頼度：${score} / 100`].filter(Boolean).join('　｜　');
    const wb = new exceljs_1.default.Workbook();
    wb.creator = str(data.publisher || options.publisher || options.publisherName) || 'Research Studio';
    wb.title = title;
    wb.subject = str(data.theme);
    wb.created = new Date();
    wb.calcProperties.fullCalcOnLoad = true; // 開いたときにサマリーの集計式を再計算

    // ワークシート取得エイリアス（旧名でも新名でも取得できるようにする）
    const origGet = wb.getWorksheet.bind(wb);
    wb.getWorksheet = function(nameOrId) {
        let ws = origGet(nameOrId);
        if (!ws && typeof nameOrId === 'string') {
            if (nameOrId === 'Executive_Summary') ws = origGet('01_Executive_Summary');
            else if (nameOrId === '01_Executive_Summary') ws = origGet('Executive_Summary');
            else if (nameOrId === 'Comparison_Matrix') ws = origGet('02_Comparison_Matrix');
            else if (nameOrId === '02_Comparison_Matrix') ws = origGet('Comparison_Matrix');
            else if (nameOrId === 'Detailed_Report') ws = origGet('03_Detailed_Report');
            else if (nameOrId === '03_Detailed_Report') ws = origGet('Detailed_Report');
            else if (nameOrId === 'Source_Index') ws = origGet('04_Sources_Data');
            else if (nameOrId === '04_Sources_Data') ws = origGet('Source_Index');
        }
        return ws;
    };

    // シートは表示順に作成し、目次のリンク先（行番号）が確定する順に中身を書く
    const view = (ySplit, xSplit = 0) => [{ state: 'frozen', xSplit, ySplit, topLeftCell: `${colLetter(xSplit + 1)}${ySplit + 1}`, showGridLines: true, zoomScale: 100 }];
    const wsSum = wb.addWorksheet(SHEETS.summary, { properties: { tabColor: { argb: argb(COLOR.ink) } } });
    const wsMat = wb.addWorksheet(SHEETS.matrix, { properties: { tabColor: { argb: argb(COLOR.slate) } } });
    const wsRep = wb.addWorksheet(SHEETS.report, { properties: { tabColor: { argb: argb('475569') } } });
    const wsSrc = wb.addWorksheet(SHEETS.sources, { properties: { tabColor: { argb: argb('94A3B8') } } });
    const longCells = []; // 表示枠を超える長文セル（付録に全文を再掲）
    /* -------------------------------------------------------------------
       02_Comparison_Matrix（列は入力データから完全に動的生成）
       ------------------------------------------------------------------- */
    const tbl = data.table ?? {};
    const rawRows = Array.isArray(tbl.rows) ? tbl.rows : [];
    const columns = Array.isArray(tbl.columns) ? tbl.columns.map(str) : [];
    // ① 配列形式の行が列数より長い場合は「列名なし」列を追加（値を捨てない）。位置で対応づけるため先に確定する
    const maxLen = Math.max(0, ...rawRows.map((r) => (Array.isArray(r) ? r.length : 0)));
    for (let i = columns.length; i < maxLen; i++)
        columns.push(`（列名なし ${i + 1}）`);
    // ② オブジェクト形式の行のキーを、その後ろに列として追加（列名にないキーも捨てない）
    rawRows.forEach((r) => { if (isPlainObject(r))
        Object.keys(r).forEach((k) => { if (!columns.includes(k))
            columns.push(k); }); });
    const rows = rawRows.map((r) => Array.isArray(r)
        ? columns.map((_, i) => r[i])
        : columns.map((c) => r[c]));
    const nCols = Math.max(columns.length, 1);
    const matHeaderRow = 5;
    {
        const ws = wsMat;
        ws.getColumn(1).width = 2;
        const colVals = columns.map((_, i) => rows.map((r) => str(r[i])));
        const widths = columns.map((h, i) => autoWidth(h, colVals[i]));
        widths.forEach((wd, i) => { ws.getColumn(i + 2).width = wd; });
        const lastCol = Math.max(nCols + 1, 5);
        sheetHeader(ws, w, lastCol, str(tbl.caption) || '比較分析表', `${title}　｜　${rows.length}行 × ${columns.length}列　｜　値はAIが収集した原文のまま（正規化・丸め・要約なし）`, true);
        ws.getRow(4).height = 6;
        if (!columns.length) {
            w.merge(ws, matHeaderRow, 2, matHeaderRow, lastCol, '比較表データはありません。', { color: COLOR.muted });
        }
        else {
            const statusCol = colVals.map((vals) => {
                const ne = vals.filter((v) => v.trim());
                return ne.length > 0 && ne.filter((v) => statusOf(v)).length / ne.length >= 0.5;
            });
            const hr = ws.getRow(matHeaderRow);
            hr.height = Math.max(24, ...columns.map((h, i) => rowHeight(h, widths[i], PT.th, 24)));
            columns.forEach((h, i) => w.put(ws.getCell(matHeaderRow, i + 2), h, {
                size: PT.th, bold: true, color: COLOR.white, fill: COLOR.slate, border: box,
                align: { vertical: 'middle', horizontal: statusCol[i] ? 'center' : 'left', indent: statusCol[i] ? 0 : 1 },
            }));
            rows.forEach((r, ri) => {
                const rowNo = matHeaderRow + 1 + ri;
                let h = 20;
                r.forEach((v, ci) => {
                    const text = str(v);
                    const t = typed(v);
                    const isNum = typeof t.value === 'number';
                    w.put(ws.getCell(rowNo, ci + 2), v, {
                        bold: ci === 0, color: ci === 0 ? COLOR.ink : COLOR.slate, border: box, plain: statusCol[ci],
                        align: { vertical: 'middle', horizontal: statusCol[ci] ? 'center' : isNum ? 'right' : 'left', indent: statusCol[ci] ? 0 : 1 },
                    });
                    if (lineCount(text, widths[ci], PT.body) > maxLinesPerRow(PT.body) || text.length > MAX_CELL_CHARS) {
                        longCells.push({ where: `${exports.SHEETS.matrix}!${colLetter(ci + 2)}${rowNo}（${columns[ci]}）`, text });
                        ws.getCell(rowNo, ci + 2).note = '長文のためセル内の表示は途中までです。数式バー、または 03_Detailed_Report の付録で全文を確認できます。';
                    }
                    h = Math.max(h, rowHeight(text, widths[ci], PT.body, 20));
                });
                ws.getRow(rowNo).height = h;
            });
            const last = matHeaderRow + Math.max(rows.length, 1);
            const L = colLetter(nCols + 1);
            ws.autoFilter = `B${matHeaderRow}:${L}${last}`;
            statusCol.forEach((isS, i) => { if (isS && rows.length) {
                const c = colLetter(i + 2);
                cfStatus(ws, `${c}${matHeaderRow + 1}:${c}${last}`, `${c}${matHeaderRow + 1}`);
            } });
            let r = last + 2;
            if (statusCol.some(Boolean)) {
                w.merge(ws, r, 2, r, lastCol, '判定セルの色：◎・推奨・Go＝緑　｜　△・留意・Hold＝黄　｜　×・懸念・No-Go＝赤　｜　○・適合＝着色なし（標準）　※先頭の記号・語で判定し、値を編集すると色も追従します', { size: PT.meta, color: COLOR.muted, align: { wrapText: true } });
                ws.getRow(r).height = rowHeight('判定セルの色：◎・推奨・Go＝緑　｜　△・留意・Hold＝黄　｜　×・懸念・No-Go＝赤　｜　○・適合＝着色なし（標準）　※先頭の記号・語で判定し、値を編集すると色も追従します', widths.reduce((a, b) => a + b, 0), PT.meta, 16);
                r += 1;
            }
            // table の追加フィールド（出典メモ・注記など）
            flatten(extras(tbl, ['caption', 'columns', 'rows'])).forEach((line) => {
                w.merge(ws, r, 2, r, lastCol, line.text, { size: PT.meta, color: COLOR.muted, align: { indent: line.depth } });
                r += 1;
            });
            w.put(ws.getCell(r + 1, 2), w.jump('↑ 先頭へ戻る', exports.SHEETS.matrix, 'A1'), { size: PT.meta, color: COLOR.link, underline: true, align: { wrapText: false } });
        }
        ws.views = view(matHeaderRow, 2);
        printSetup(ws, ctx, title, 'landscape', `${matHeaderRow}:${matHeaderRow}`);
    }
    /* -------------------------------------------------------------------
       04_Sources_Data（ハイパーリンク付き出典カタログ）
       ------------------------------------------------------------------- */
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const srcHeaderRow = 5;
    const srcKnown = ['id', 'title', 'publisher', 'score', 'url'];
    const srcExtraKeys = [];
    sources.forEach((s) => Object.keys(extras(s, srcKnown)).forEach((k) => { if (!srcExtraKeys.includes(k))
        srcExtraKeys.push(k); }));
    const srcCols = ['ID', '出典名', '発信元', 'ドメイン', '信頼性スコア', 'URL', ...srcExtraKeys];
    const SCORE_COL = 6; // F 列
    {
        const ws = wsSrc;
        ws.getColumn(1).width = 2;
        const vals = sources.map((s) => [str(s.id), str(s.title), str(s.publisher), domainOf(s.url), str(s.score), str(s.url), ...srcExtraKeys.map((k) => str(s[k]))]);
        const widths = srcCols.map((h, i) => {
            const v = vals.map((r) => r[i]);
            if (i === 0)
                return autoWidth(h, v, 8, 12);
            if (i === 4)
                return 13;
            if (i === 1 || i === 5)
                return autoWidth(h, v, 24, 60);
            return autoWidth(h, v, 12, 30);
        });
        widths.forEach((wd, i) => { ws.getColumn(i + 2).width = wd; });
        const lastCol = srcCols.length + 1;
        sheetHeader(ws, w, lastCol, '一次出典・エビデンス一覧', `${title}　｜　出典 ${sources.length}件　｜　URL はクリックでブラウザが開きます`, true);
        ws.getRow(4).height = 6;
        ws.getRow(srcHeaderRow).height = 24;
        srcCols.forEach((h, i) => w.put(ws.getCell(srcHeaderRow, i + 2), h, {
            size: PT.th, bold: true, color: COLOR.white, fill: COLOR.slate, border: box,
            align: { vertical: 'middle', horizontal: i === 0 || i === 4 ? 'center' : 'left', indent: i === 0 || i === 4 ? 0 : 1, wrapText: false },
        }));
        sources.forEach((s, ri) => {
            const r = srcHeaderRow + 1 + ri;
            const url = safeUrl(s.url);
            const cells = [s.id, s.title, s.publisher, domainOf(s.url), s.score,
                url ? w.link(url, url, 'クリックでブラウザを開く') : s.url, ...srcExtraKeys.map((k) => str(s[k]))];
            let h = 20;
            cells.forEach((v, ci) => {
                const isUrl = ci === 5 && !!url;
                w.put(ws.getCell(r, ci + 2), v, {
                    border: box, bold: ci === 0, color: isUrl ? COLOR.link : ci === 0 ? COLOR.ink : COLOR.slate, underline: isUrl,
                    numFmt: ci === 4 ? '0' : undefined, plain: ci === 4,
                    align: { vertical: 'middle', horizontal: ci === 0 || ci === 4 ? 'center' : 'left', indent: ci === 0 || ci === 4 ? 0 : 1 },
                });
                h = Math.max(h, rowHeight(ci === 5 ? str(s.url) : str(v), widths[ci], PT.body, 20));
            });
            ws.getRow(r).height = h;
        });
        const last = srcHeaderRow + Math.max(sources.length, 1);
        ws.autoFilter = `B${srcHeaderRow}:${colLetter(lastCol)}${last}`;
        if (sources.length)
            cfScore(ws, `F${srcHeaderRow + 1}:F${last}`, `F${srcHeaderRow + 1}`);
        else
            w.put(ws.getCell(srcHeaderRow + 1, 3), '出典データはありません。', { color: COLOR.muted });
        const lr = last + 2;
        w.merge(ws, lr, 2, lr, lastCol, '信頼性スコア：85以上＝緑（高）　｜　70〜84＝黄（中）　｜　70未満＝赤（要確認）　※値を編集すると色も追従します', { size: PT.meta, color: COLOR.muted, align: { wrapText: false } });
        w.put(ws.getCell(lr + 2, 2), w.jump('↑ 先頭へ戻る', exports.SHEETS.sources, 'A1'), { size: PT.meta, color: COLOR.link, underline: true, align: { wrapText: false } });
        ws.views = view(srcHeaderRow, 2);
        printSetup(ws, ctx, title, 'landscape', `${srcHeaderRow}:${srcHeaderRow}`);
    }
    const srcFirst = srcHeaderRow + 1;
    const srcLast = srcHeaderRow + Math.max(sources.length, 1);
    /* -------------------------------------------------------------------
       03_Detailed_Report（全セクションを全文で掲載）
       ------------------------------------------------------------------- */
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const sectionRows = [];
    const BODY_W = 100;
    let appendixRow = null;
    {
        const ws = wsRep;
        ws.getColumn(1).width = 2;
        ws.getColumn(2).width = BODY_W;
        sheetHeader(ws, w, 2, '詳細レポート（全セクション・全文）', `${title}　｜　${sections.length}セクション　｜　本文は要約せず、AIが記述した原文をそのまま掲載`, true);
        let r = 5;
        const writeText = (text, s, indent = 0) => {
            for (const chunk of splitForRows(text, BODY_W - indent * 2, s.size ?? PT.body)) {
                w.put(ws.getCell(r, 2), chunk, { ...s, align: { vertical: 'top', wrapText: true, indent, ...(s.align ?? {}) } });
                ws.getRow(r).height = rowHeight(chunk, BODY_W - indent * 2, s.size ?? PT.body, 18);
                r += 1;
            }
        };
        sections.forEach((sec, i) => {
            const heading = str(sec.heading) || `セクション ${i + 1}`;
            sectionRows.push({ heading, row: r });
            ws.getRow(r).height = Math.max(26, rowHeight(heading, BODY_W, PT.h2, 26));
            w.put(ws.getCell(r, 2), heading, { size: PT.h2, bold: true, color: COLOR.ink, fill: COLOR.band, border: { bottom: thin }, align: { vertical: 'middle', indent: 1 } });
            r += 1;
            ws.getRow(r).height = 6;
            r += 1;
            // 段落ごとに1行（空行で段落分け）。長い段落は文の切れ目で複数行に分割
            str(sec.body).split(/\n{2,}/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim()).forEach((p) => {
                writeText(p, { color: COLOR.slate }, 1);
            });
            const bullets = Array.isArray(sec.bullets) ? sec.bullets : [];
            if (bullets.length) {
                ws.getRow(r).height = 6;
                r += 1;
                bullets.forEach((b) => writeText('・' + str(b), { color: COLOR.slate }, 2));
            }
            const ex = extras(sec, ['heading', 'body', 'bullets']);
            if (Object.keys(ex).length) {
                ws.getRow(r).height = 6;
                r += 1;
                writeText('補足データ（原文のまま）', { size: PT.meta, bold: true, color: COLOR.muted }, 1);
                flatten(ex).forEach((line) => writeText(line.text, { size: PT.meta, color: COLOR.slate }, 2 + Math.min(line.depth, 6)));
            }
            w.put(ws.getCell(r, 2), w.jump('↑ 先頭へ戻る', exports.SHEETS.report, 'A1'), { size: PT.meta, color: COLOR.link, underline: true, align: { horizontal: 'right', wrapText: false } });
            ws.getRow(r).height = 16;
            r += 2;
        });
        if (!sections.length) {
            w.put(ws.getCell(r, 2), '詳細セクションのデータはありません。', { color: COLOR.muted });
            r += 2;
        }
        // 付録：スキーマ外のトップレベル項目／表示枠を超えた長文セル
        const topExtras = extras(data, ['title', 'theme', 'generatedAt', 'publisher', 'confidenceScore', 'summary', 'metrics', 'decision', 'table', 'sections', 'sources']);
        if (Object.keys(topExtras).length || longCells.length) {
            appendixRow = r;
            w.put(ws.getCell(r, 2), '付録：その他の調査データ（原文のまま）', { size: PT.h2, bold: true, color: COLOR.ink, fill: COLOR.band, border: { bottom: thin }, align: { vertical: 'middle', indent: 1 } });
            ws.getRow(r).height = 26;
            r += 2;
            flatten(topExtras).forEach((line) => writeText(line.text, { color: COLOR.slate }, 1 + Math.min(line.depth, 6)));
            longCells.forEach((lc) => {
                r += 1;
                writeText(`長文セルの全文：${lc.where}`, { size: PT.meta, bold: true, color: COLOR.muted }, 1);
                lc.text.split(/\n{2,}/).filter((p) => p.trim()).forEach((p) => writeText(p, { color: COLOR.slate }, 2));
            });
            r += 1;
            w.put(ws.getCell(r, 2), w.jump('↑ 先頭へ戻る', exports.SHEETS.report, 'A1'), { size: PT.meta, color: COLOR.link, underline: true, align: { horizontal: 'right', wrapText: false } });
        }
        ws.views = view(3, 0);
        printSetup(ws, ctx, title, 'portrait', '1:2');
    }
    /* -------------------------------------------------------------------
       01_Executive_Summary（8列グリッド：B〜I）
       ------------------------------------------------------------------- */
    let tocRow = 1;
    {
        const ws = wsSum;
        const COLS = 8, C1 = 2, C2 = C1 + COLS - 1, CW = 13.5, FULL_W = COLS * CW;
        ws.getColumn(1).width = 2;
        for (let c = C1; c <= C2; c++)
            ws.getColumn(c).width = CW;
        sheetHeader(ws, w, C2, title, metaLine || 'Research Report', false);
        let r = 4;
        // ---- レポート情報 ----
        sectionBand(ws, w, r, C1, C2, 'レポート情報');
        r += 1;
        const label = (row, col, text) => w.put(ws.getCell(row, col), text, { size: PT.meta, bold: true, color: COLOR.muted, fill: COLOR.band, border: box, align: { vertical: 'middle', indent: 1 } });
        const value = (row, c1, c2, v, s = {}) => w.merge(ws, row, c1, row, c2, v, { border: box, ...s, align: { vertical: 'middle', horizontal: 'left', indent: 1, ...(s.align ?? {}) } });
        ws.getRow(r).height = 22;
        label(r, 2, '調査テーマ');
        value(r, 3, 5, data.theme ?? '');
        label(r, 6, '調査日時');
        if (zoned) {
            const c = value(r, 7, 9, zoned, { numFmt: `yyyy-mm-dd hh:mm "(${tzLabel(ctx.tz)})"` });
            c.note = `原データ：${data.generatedAt}`;
        }
        else
            value(r, 7, 9, data.generatedAt ?? '');
        r += 1;
        ws.getRow(r).height = 22;
        label(r, 2, '作成者');
        value(r, 3, 5, data.publisher ?? '');
        label(r, 6, '総合信頼度');
        value(r, 7, 9, score ?? '', { bold: true, size: PT.th, numFmt: '0" / 100"', plain: true });
        if (typeof score === 'number')
            cfScore(ws, `G${r}:I${r}`, `G${r}`);
        r += 1;
        ws.getRow(r).height = 22;
        label(r, 2, '出典数');
        value(r, 3, 5, { formula: `COUNTA('${exports.SHEETS.sources}'!B${srcFirst}:B${srcLast})`, result: sources.length }, { numFmt: '0"件"' });
        label(r, 6, '平均信頼性');
        const nums = sources.map((s) => Number(s.score)).filter(Number.isFinite);
        value(r, 7, 9, { formula: `IFERROR(AVERAGE('${exports.SHEETS.sources}'!F${srcFirst}:F${srcLast}),"—")`, result: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : '—' }, { numFmt: '0.0" / 100"' });
        r += 1;
        if (data.generatedAt) {
            w.merge(ws, r, 2, r, C2, `調査日時の原データ：${data.generatedAt}　｜　出典数・平均信頼性は 04_Sources_Data からの集計式（出典を追加・修正すると自動更新）`, { size: PT.meta, color: COLOR.muted, align: { wrapText: false } });
            r += 1;
        }
        r += 1;
        // ---- エグゼクティブサマリー ----
        if (str(data.summary).trim()) {
            sectionBand(ws, w, r, C1, C2, 'エグゼクティブサマリー');
            r += 1;
            ws.getRow(r).height = 6;
            r += 1;
            str(data.summary).split(/\n{2,}/).filter((p) => p.trim()).forEach((p) => {
                for (const chunk of splitForRows(p, FULL_W - 2, PT.body)) {
                    w.merge(ws, r, C1, r, C2, chunk, { color: COLOR.slate, align: { vertical: 'top', wrapText: true, indent: 1 } });
                    ws.getRow(r).height = rowHeight(chunk, FULL_W - 2, PT.body, 18);
                    r += 1;
                }
            });
            r += 1;
        }
        // ---- 主要KPI（2列×4枚のカード。件数に応じて行を追加） ----
        const metrics = Array.isArray(data.metrics) ? data.metrics : [];
        if (metrics.length) {
            sectionBand(ws, w, r, C1, C2, '主要KPI・数値ハイライト');
            r += 1;
            ws.getRow(r).height = 6;
            r += 1;
            for (let i = 0; i < metrics.length; i += 4) {
                const group = metrics.slice(i, i + 4);
                const notes = group.map((m) => [str(m.note), ...flatten(extras(m, ['label', 'value', 'note'])).map((l) => l.text)].filter(Boolean).join('\n'));
                ws.getRow(r).height = Math.max(18, ...group.map((m) => rowHeight(str(m.label), CW * 2, PT.meta, 18)));
                ws.getRow(r + 1).height = Math.max(30, ...group.map((m) => rowHeight(str(m.value), CW * 2, PT.kpi, 30)));
                ws.getRow(r + 2).height = Math.max(18, ...notes.map((n) => rowHeight(n, CW * 2, PT.meta, 18)));
                group.forEach((m, k) => {
                    const c = C1 + k * 2;
                    w.merge(ws, r, c, r, c + 1, m.label, { size: PT.meta, bold: true, color: COLOR.muted, fill: COLOR.band, border: { top: thin, left: thin, right: thin }, align: { vertical: 'middle', indent: 1 } });
                    w.merge(ws, r + 1, c, r + 1, c + 1, m.value, { size: PT.kpi, bold: true, color: COLOR.ink, border: { left: thin, right: thin }, align: { vertical: 'middle', horizontal: 'left', indent: 1 } });
                    w.merge(ws, r + 2, c, r + 2, c + 1, notes[k], { size: PT.meta, color: COLOR.muted, border: { left: thin, right: thin, bottom: thin }, align: { vertical: 'top', indent: 1 } });
                });
                r += 4;
            }
        }
        // ---- 意思決定の示唆・推奨アクション ----
        const dec = isPlainObject(data.decision) ? data.decision : null;
        if (dec) {
            sectionBand(ws, w, r, C1, C2, '意思決定の示唆・推奨アクション');
            r += 1;
            ws.getRow(r).height = 6;
            r += 1;
            const vk = verdictOf(dec.verdict);
            const qText = str(dec.question);
            ws.getRow(r).height = Math.max(26, rowHeight(qText, CW * 5, PT.body, 26));
            label(r, 2, '判定');
            const vc = w.merge(ws, r, 3, r, 4, vk ? VERDICT_LABEL[vk] : str(dec.verdict) || '—', {
                size: PT.th, bold: true, plain: true, border: box,
                fill: vk ? COLOR[vk].bg : undefined, color: vk ? COLOR[vk].fg : COLOR.slate, align: { vertical: 'middle', horizontal: 'center' },
            });
            if (vk && dec.verdict !== undefined)
                vc.note = `原データ：${str(dec.verdict)}`;
            w.merge(ws, r, 5, r, C2, qText ? `論点：${qText}` : '', { color: COLOR.ink, bold: true, border: box, align: { vertical: 'middle', indent: 1 } });
            r += 1;
            const asks = Array.isArray(dec.asks) ? dec.asks : [];
            if (asks.length) {
                const start = r;
                asks.forEach((a) => {
                    for (const chunk of splitForRows('・' + str(a), CW * 7 - 2, PT.body)) {
                        w.merge(ws, r, 3, r, C2, chunk, { color: COLOR.slate, border: { bottom: thin, right: thin }, align: { vertical: 'middle', indent: 1 } });
                        ws.getRow(r).height = rowHeight(chunk, CW * 7 - 2, PT.body, 22);
                        r += 1;
                    }
                });
                ws.mergeCells(start, 2, r - 1, 2);
                label(start, 2, '推奨アクション\n承認依頼事項');
                for (let k = start; k < r; k++) {
                    const cl = ws.getCell(k, 2);
                    cl.fill = solid(COLOR.band);
                    cl.border = box;
                }
            }
            flatten(extras(dec, ['verdict', 'question', 'asks'])).forEach((line) => {
                ws.getRow(r).height = rowHeight(line.text, CW * 7 - 2, PT.body, 22);
                w.merge(ws, r, 3, r, C2, line.text, { color: COLOR.slate, border: box, align: { vertical: 'middle', indent: 1 + Math.min(line.depth, 6) } });
                label(r, 2, '補足');
                r += 1;
            });
            r += 1;
        }
        // ---- 目次（シート・セクションへのリンク） ----
        tocRow = r;
        sectionBand(ws, w, r, C1, C2, '目次（クリックで各シート・各セクションへ移動）');
        r += 1;
        const tocLine = (text, target, desc, indent = 0) => {
            ws.getRow(r).height = 20;
            w.merge(ws, r, 2, r, 4, w.jump(text, target[0], target[1]), { color: COLOR.link, underline: true, border: { bottom: thin }, align: { vertical: 'middle', indent: 1 + indent, wrapText: false } });
            w.merge(ws, r, 5, r, C2, desc, { size: PT.meta, color: COLOR.muted, border: { bottom: thin }, align: { vertical: 'middle', indent: 1, wrapText: false } });
            r += 1;
        };
        tocLine('02  比較分析表', [exports.SHEETS.matrix, 'A1'], `${str(tbl.caption) || '比較表'}（${rows.length}行 × ${columns.length}列・フィルター付き）`);
        tocLine('03  詳細レポート（全文）', [exports.SHEETS.report, 'A1'], `${sections.length}セクションの本文を要約せずに掲載`);
        sectionRows.forEach((s) => {
            ws.getRow(r).height = 18;
            w.merge(ws, r, 3, r, C2, w.jump(s.heading, exports.SHEETS.report, `B${s.row}`), { size: PT.meta, color: COLOR.link, underline: true, align: { vertical: 'middle', indent: 1, wrapText: false } });
            r += 1;
        });
        if (appendixRow)
            tocLine('　　付録：その他の調査データ', [exports.SHEETS.report, `B${appendixRow}`], 'スキーマ外の項目・長文セルの全文');
        tocLine('04  一次出典・エビデンス', [exports.SHEETS.sources, 'A1'], `出典 ${sources.length}件（URLはクリックで開く）`);
        r += 1;
        w.merge(ws, r, 2, r + 1, C2, '本ブックは、AIが収集した事実・論述を原文のまま格納しています。本シートは要約であり、根拠と詳細は 03_Detailed_Report（全文）と 04_Sources_Data（一次出典）で確認できます。内容の正確性は出典の原文で確認してください。', { size: PT.meta, color: COLOR.muted, align: { vertical: 'top', wrapText: true } });
        ws.getRow(r).height = 14;
        ws.getRow(r + 1).height = 14;
        ws.views = view(2, 0);
        printSetup(ws, ctx, title, 'portrait');
    }
    // 各シートの「目次へ戻る」をサマリーの目次行に向け直す
    [wsMat, wsRep, wsSrc].forEach((ws) => {
        ws.getCell(3, 2).value = w.jump('◀ 目次へ戻る（01_Executive_Summary）', exports.SHEETS.summary, `B${tocRow}`);
    });
    return wb;
}
/* =====================================================================
   検証：入力の全文字列がブック内に存在するか（歪曲・欠落の自動検知）
   空白・改行の違いは無視し、表示用に数値化した値（"1,200"→1200）も一致とみなす
   ===================================================================== */
function verifyNoDataLoss(data, wb) {
    const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
    const cellText = (c) => {
        const v = c.value;
        if (v === null || v === undefined)
            return '';
        if (typeof v === 'object') {
            const o = v;
            if (o.richText)
                return o.richText.map((t) => t.text).join('');
            if (o.hyperlink !== undefined)
                return str(typeof o.text === 'object' ? o.text.richText?.map((t) => t.text).join('') : o.text);
            if (v instanceof Date)
                return v.toISOString();
            if ('result' in o)
                return str(o.result);
        }
        return str(v);
    };
    let all = '';
    wb.worksheets.forEach((ws) => ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
        if (c.isMerged && c.master !== c)
            return;
        all += norm(cellText(c)) + (c.note ? norm(str(typeof c.note === 'string' ? c.note : '')) : '');
    })));
    const leaves = [];
    const walk = (v) => {
        if (v === null || v === undefined)
            return;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            leaves.push(String(v));
            return;
        }
        if (Array.isArray(v))
            v.forEach(walk);
        else if (typeof v === 'object')
            Object.values(v).forEach(walk);
    };
    walk(data);
    const missing = leaves.filter((s) => {
        const n = norm(s);
        if (!n)
            return false;
        return !(all.includes(n) || all.includes(n.replace(/,/g, '')));
    });
    return { ok: missing.length === 0, checked: leaves.length, missing };
}

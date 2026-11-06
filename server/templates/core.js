/* =====================================================================
   Research Studio — Report Core JS（A/B/C 共通）
   - データ読込：window.RS_DATA ＞ id="report-data" の JSON ブロック
   - 文字列はすべて RS.esc() を通して挿入（AI生成文の < や & でHTMLが壊れない）
   - 表の列幅は内容の文字量から「重要列優先」で自動配分
   ===================================================================== */
(function (global) {
  'use strict';
  var RS = {};

  RS.loadData = function () {
    if (global.RS_DATA) return global.RS_DATA;
    var el = document.getElementById('report-data');
    return JSON.parse(el ? el.textContent : '{}');
  };
  RS.arr = function (v) { return Array.isArray(v) ? v : []; };
  RS.str = function (v) { return v === null || v === undefined ? '' : String(v); };
  RS.esc = function (v) {
    return RS.str(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  /** 空行で段落分け、単独改行は <br> */
  RS.paras = function (text, cls) {
    return RS.str(text).split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + RS.esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  };
  RS.safeUrl = function (u) { var s = RS.str(u).trim(); return /^https?:\/\//i.test(s) ? s : ''; };
  RS.domain = function (u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return RS.str(u); } };
  /** 見出し先頭の「1.」「2)」「第3章」などを除去（テンプレート側で自動採番するため） */
  RS.stripNum = function (h) { return RS.str(h).replace(/^\s*(第?\d+[章節]?[\.\)．、:：]?|[IVX]+\.)\s*/, ''); };
  /** 表示幅：半角=1、全角=2 */
  RS.textWidth = function (s) {
    var w = 0, t = RS.str(s);
    for (var i = 0; i < t.length; i++) w += /[\u0000-ɏ -⁯｡-ﾟ]/.test(t[i]) ? 1 : 2;
    return w;
  };
  RS.clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  /** 評価の判定：a=優位 b=標準 c=要注意 d=不可 */
  RS.status = function (v) {
    var s = RS.str(v).trim();
    if (!s) return null;
    if (/^(◎|推奨|採用|最適|高評価|GO\b)/.test(s)) return 'a';
    if (/^(○|〇|◯|検討|標準|良好)/.test(s)) return 'b';
    if (/^(△|▲|保留|要注意|要検討|条件付)/.test(s)) return 'c';
    if (/^(×|✕|✖|不採用|非推奨|NG\b|NO-?GO\b)/i.test(s)) return 'd';
    return null;
  };
  RS.rate = function (v) {
    var s = RS.str(v).trim(), st = RS.status(s);
    if (!st) return RS.esc(s);
    var m = s.match(/^([◎○〇◯△▲×✕✖])\s*(.*)$/);
    if (m) return '<span class="rate rate-' + st + '"><i>' + m[1] + '</i>' + RS.esc(m[2]) + '</span>';
    return '<span class="rate rate-' + st + '">' + RS.esc(s) + '</span>';
  };
  RS.isNumeric = function (v) {
    return /^[\s約~～≈]*[-−+]?[$¥€£]?\s*[-−+]?\d[\d,.]*\s*(%|％|ms|s|秒|件|点|円|万円?|億円?|倍|x|pt|h|時間|日|ヶ月|か月|年|GB|TB|MB|tokens?|USD|JPY)?(\s*\/\s*\S{1,4})?\s*$/i.test(RS.str(v));
  };
  RS.scoreClass = function (s) { var n = Number(s); return n >= 85 ? 'hi' : n >= 70 ? 'mid' : 'lo'; };
  RS.scoreLabel = function (s) { var n = Number(s); return n >= 85 ? '高' : n >= 70 ? '中' : '要確認'; };
  /** KPI値の長さに応じた文字サイズ段階 */
  RS.valueSize = function (v) { var w = RS.textWidth(v); return w > 14 ? 'v-xl' : w > 10 ? 'v-l' : w > 7 ? 'v-m' : ''; };

  /** 信頼度リング（SVG）。r=15 の円周 94.25 */
  RS.ring = function (score, opt) {
    opt = opt || {};
    var s = RS.clamp(Number(score) || 0, 0, 100), c = 94.25;
    var arc = s > 0 ? '<circle cx="18" cy="18" r="15" fill="none" stroke="' + (opt.color || '#06b6d4') + '" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="' + (s / 100 * c).toFixed(2) + ' ' + c + '" transform="rotate(-90 18 18)"/>' : '';
    return '<span class="ring" style="width:' + (opt.size || '14mm') + ';height:' + (opt.size || '14mm') + '">' +
      '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="' + (opt.track || 'rgba(148,163,184,.28)') + '" stroke-width="3.2"/>' + arc + '</svg>' +
      '<b style="font-size:' + (opt.font || '11pt') + ';color:' + (opt.text || '#fff') + '">' + RS.esc(Number(score) || 0) + '</b></span>';
  };

  /* -------------------------------------------------------------------
     列幅の自動配分（重要列優先）
     - 平均文字量と最大文字量の加重値を 0.72 乗で圧縮 → 長文列が幅を独占しない
     - 1列目（項目名）は 1.25 倍で優先
     - 列数に応じた最低幅（%）を保証し、記号だけの列でも潰れない
     ------------------------------------------------------------------- */
  /*  列幅の自動配分（重要列優先）
      ・colSpec：各列の「必要幅」と「重み」を文字量から算出（半角=1, 全角=2 の単位）
          - 短い列（数値・評価記号・10文字以内）… 最大値が1行に収まる幅を必要幅として確保
          - 長文列 … 文字量を 0.72 乗で圧縮した重み（1列が幅を独占しない）。1列目は 1.25 倍
      ・alloc：表の実幅 W（半角何文字分か）に合わせて配分
          - 全列の希望幅の合計が W 以下 → 全列を比例拡大（短い表で1列目だけが間延びしない）
          - 超える → 短い列を優先確保し、残りを長文列で重み配分（最低 9 文字）
      ・layoutTables：描画後に実際の表幅と文字サイズから W を測り直して <col> を更新 */
  RS.colSpec = function (cols, rows, n, kinds) {
    var spec = { need: [], desire: [], weight: [], short: [] };
    for (var i = 0; i < n; i++) {
      var lens = rows.map(function (r) { return RS.textWidth(r[i]); });
      var head = RS.textWidth(cols[i]);
      var max = Math.max.apply(null, [1].concat(lens));
      var avg = lens.length ? lens.reduce(function (a, b) { return a + b; }, 0) / lens.length : head;
      var kind = kinds ? kinds[i] : 'text';
      var short = i > 0 && (kind === 'num' || kind === 'rating' || max <= 10);
      var icon = kind === 'rating' ? 3.5 : 0;            // 評価記号の丸アイコンぶん
      spec.short.push(short);
      // 見出しは5全角文字（10単位）までは1行に収める。それより長い見出しは折り返しを許容
      spec.need.push(short ? Math.max(max + icon, Math.min(head, 10), 4) : 0);
      spec.desire.push(Math.max(avg * 0.6 + max * 0.4 + icon, Math.min(head, 10), 6));
      spec.weight.push(short ? 0 : Math.pow(Math.max(avg * 0.6 + max * 0.4, head, 6), 0.72) * (i === 0 ? 1.25 : 1));
    }
    return spec;
  };
  /* pad = セル左右パディング＋余裕（単位：半角文字） */
  RS.alloc = function (spec, W, pad) {
    pad = pad === undefined ? 3 : pad;
    var desire = spec.desire.map(function (x) { return x + pad; });
    var desireSum = desire.reduce(function (a, b) { return a + b; }, 0);
    if (desireSum <= W) return RS.normalize(desire);
    var textMin = 8 + pad, textCount = spec.short.filter(function (x) { return !x; }).length;
    var need = spec.need.map(function (x, i) { return spec.short[i] ? x + pad : 0; }), shortSum = need.reduce(function (a, b) { return a + b; }, 0);
    var cap = W - textCount * textMin;
    if (shortSum > cap) { var f = Math.max(cap, W * 0.35) / shortSum; need = need.map(function (x) { return x * f; }); shortSum *= f; }
    var rest = W - shortSum, wsum = spec.weight.reduce(function (a, b) { return a + b; }, 0) || 1;
    return RS.normalize(need.map(function (x, i) { return spec.short[i] ? x : Math.max(textMin, rest * spec.weight[i] / wsum); }));
  };
  /** 実幅で列幅を再計算（A はオートフィットで文字サイズが変わるたびに呼ぶ） */
  RS.layoutTables = function (root) {
    (root || document).querySelectorAll('table.rs-table[data-colspec]').forEach(function (t) {
      var w = t.getBoundingClientRect().width; if (!w) return;
      var cell = t.querySelector('td') || t, cs = getComputedStyle(cell);
      var unit = (parseFloat(cs.fontSize) || 12) * 0.62;   // 半角1文字の実幅（欧文の平均字幅 ≒ 0.62em）
      var pad = (parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) / unit + 1;
      var spec = JSON.parse(t.getAttribute('data-colspec'));
      var shares = RS.alloc(spec, w / unit, pad);
      t.querySelectorAll('col').forEach(function (c, i) { c.style.width = shares[i].toFixed(2) + '%'; });
    });
  };
  RS.normalize = function (a) { var t = a.reduce(function (x, y) { return x + y; }, 0) || 1; return a.map(function (x) { return x / t * 100; }); };

  /**
   * 汎用テーブル生成
   * tbl: { columns: [], rows: [[]], columnWeights?: [], recommendedRow?: number }
   * opt: { split: bool（スライドの行分割対象）, cellHtml: fn(value, colIndex, row) }
   */
  RS.table = function (tbl, opt) {
    opt = opt || {};
    var cols = RS.arr(tbl.columns);
    var rows = RS.arr(tbl.rows).map(function (r) { return RS.arr(r); });
    var n = Math.max.apply(null, [cols.length, 1].concat(rows.map(function (r) { return r.length; })));
    var density = n >= 7 ? 'dense' : n >= 5 ? 'compact' : 'normal';

    // 列タイプ判定（6割以上が該当すればその列を数値／評価列とみなす）
    var kinds = [];
    for (var i = 0; i < n; i++) {
      var vals = rows.map(function (r) { return r[i]; }).filter(function (v) { return RS.str(v).trim() !== ''; });
      var num = vals.filter(RS.isNumeric).length, rate = vals.filter(function (v) { return RS.status(v) && RS.textWidth(v) <= 18; }).length;
      kinds.push(i > 0 && vals.length && rate / vals.length >= 0.6 ? 'rating' : i > 0 && vals.length && num / vals.length >= 0.6 ? 'num' : 'text');
    }
    // 表の横幅（半角文字数）：テンプレートが渡す基準値を、密度による文字縮小ぶん補正
    var W = (opt.widthChars || 110) / (density === 'dense' ? 0.86 : density === 'compact' ? 0.93 : 1);
    var fixed = RS.arr(tbl.columnWeights).length === n;
    var spec = fixed ? null : RS.colSpec(cols, rows, n, kinds);
    var shares = fixed ? RS.normalize(tbl.columnWeights.map(Number)) : RS.alloc(spec, W);
    var rec = typeof tbl.recommendedRow === 'number' ? tbl.recommendedRow : -1;
    if (rec < 0 && kinds[n - 1] === 'rating') rec = rows.findIndex(function (r) { return RS.status(r[n - 1]) === 'a'; });

    var h = '<table class="rs-table" data-cols="' + n + '" data-density="' + density + '"' +
      (spec ? ' data-colspec="' + RS.esc(JSON.stringify({ need: spec.need, desire: spec.desire, weight: spec.weight.map(function (x) { return +x.toFixed(3); }), short: spec.short })) + '"' : '') + '>';
    h += '<colgroup>' + shares.map(function (s) { return '<col style="width:' + s.toFixed(2) + '%">'; }).join('') + '</colgroup>';
    h += '<thead><tr>' + Array.from({ length: n }, function (_, i) { return '<th class="c-' + kinds[i] + '">' + RS.esc(cols[i]) + '</th>'; }).join('') + '</tr></thead>';
    h += '<tbody' + (opt.split ? ' data-split' : '') + '>';
    rows.forEach(function (r, ri) {
      h += '<tr' + (opt.split ? ' data-item' : '') + (ri === rec ? ' class="is-rec"' : '') + '>';
      for (var i = 0; i < n; i++) {
        var v = r[i];
        var inner = opt.cellHtml ? opt.cellHtml(v, i, r) : null;
        if (inner === null || inner === undefined) inner = kinds[i] === 'rating' ? RS.rate(v) : RS.esc(v).replace(/\n/g, '<br>');
        h += '<td class="c-' + kinds[i] + '">' + inner + '</td>';
      }
      h += '</tr>';
    });
    h += '</tbody></table>';
    var hasRating = kinds.indexOf('rating') >= 0;
    return { html: h, hasRating: hasRating, cols: n };
  };

  RS.levelBadge = function (v) { var n = RS.level3(v); return '<span class="lv l' + n + '">' + ['', '低', '中', '高'][n] + '</span>'; };

  RS.ratingLegend = function () {
    return '<div class="legend"><span class="rate rate-a"><i>◎</i>優位・推奨</span><span class="rate rate-b"><i>○</i>標準・検討</span><span class="rate rate-c"><i>△</i>要注意・保留</span><span class="rate rate-d"><i>×</i>不可</span></div>';
  };

  /** 出典テーブル用データ */
  RS.sourceTable = function (sources) {
    return {
      columns: ['ID', 'タイトル', '発行元', '信頼度', 'URL'],
      rows: RS.arr(sources).map(function (s) { return [s.id, s.title, s.publisher, s.score, s.url]; }),
      columnWeights: [7, 40, 16, 10, 27]
    };
  };
  RS.sourceCell = function (v, i) {
    if (i === 3 && v !== undefined && v !== '') return '<span class="score-pill ' + RS.scoreClass(v) + '">' + RS.esc(v) + '</span>';
    if (i === 4) { var u = RS.safeUrl(v); return u ? '<a class="url" href="' + RS.esc(u) + '">' + RS.esc(u.replace(/^https?:\/\//, '')) + '</a>' : RS.esc(v); }
    if (i === 0) return '<span style="color:var(--blue)">' + RS.esc(v) + '</span>';
    return null;
  };

  /** 判定（Go/No-Go）の正規化 */
  RS.verdict = function (v) {
    var s = RS.str(v).toUpperCase().replace(/[\s_-]/g, '');
    if (/^(CONDITIONAL|CONDITIONALGO|CGO|条件付)/.test(s) || /条件付/.test(RS.str(v))) return 'cgo';
    if (/^(NOGO|NG|REJECT|否決|不承認)/.test(s)) return 'nogo';
    if (/^(HOLD|保留|PENDING)/.test(s)) return 'hold';
    if (/^(GO|APPROVE|承認)/.test(s)) return 'go';
    return null;
  };
  RS.verdictLabel = { go: 'GO', cgo: '条件付き GO', hold: '保留', nogo: 'NO-GO' };

  /** リスクの影響度・発生可能性を 1〜3 に正規化（1〜5 や 高/中/低 も受け付ける） */
  RS.level3 = function (v) {
    if (typeof v === 'number') return v > 3 ? RS.clamp(Math.ceil(v / 5 * 3), 1, 3) : RS.clamp(Math.round(v), 1, 3);
    var s = RS.str(v);
    return /高|high|大/i.test(s) ? 3 : /低|low|小/i.test(s) ? 1 : 2;
  };

  /** 描画完了シグナル（Puppeteer の waitForFunction 用） */
  RS.ready = function (layout) {
    global.__RS_LAYOUT__ = layout;
    global.__RS_READY__ = true;
    document.documentElement.setAttribute('data-rs-ready', 'true');
    if (layout && !layout.ok) console.warn('[Research Studio] layout warnings:', JSON.stringify(layout));
  };

  /** フロー型（B/C）の横はみ出し検査：本文幅を超える要素を列挙 */
  RS.checkHorizontal = function (root) {
    var r = root.getBoundingClientRect(), cs = getComputedStyle(root);
    var right = r.right - parseFloat(cs.paddingRight) + 1, left = r.left + parseFloat(cs.paddingLeft) - 1;
    var bad = [];
    root.querySelectorAll('*').forEach(function (el) {
      if (el.closest('.bleed')) return;
      var b = el.getBoundingClientRect();
      if (b.width && (b.right > right || b.left < left)) bad.push((el.className || el.tagName).toString().slice(0, 40));
    });
    return bad;
  };

  global.RS = RS;
})(window);

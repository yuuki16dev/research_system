// ==========================================================================
// レポート描画モジュール：構造化レポート、ソート・検索可能テーブル、目次、出典リンク
// ==========================================================================

import { esc, icon, fmtDate, hydrateIcons, toast, copyText } from './ui.js';
import { tableToTSV } from './exporters.js';

let currentReportSources = [];
let currentSourcesMap = new Map();

/** 本文中の [1][2] 等の引用番号を、Perplexity風ホバープレビュー可能なリンクに置換する */
export function linkifyCitations(text) {
  if (!text) return '';
  const escaped = esc(text);
  return escaped.replace(/\[(\d+)\]/g, (match, n) => {
    const src = currentSourcesMap.get(Number(n));
    const titleAttr = src ? esc(src.title) : `ソース [${n}]`;
    return `<a class="cite" href="#src-${n}" data-cite="${n}" title="${titleAttr}">[${n}]</a>`;
  });
}

/** 信頼度スコアに応じたクラス */
function scoreClass(score) {
  if (score >= 75) return { text: 's-hi', bg: 's-hi-bg' };
  if (score >= 50) return { text: 's-md', bg: 's-md-bg' };
  return { text: 's-lo', bg: 's-lo-bg' };
}

/**
 * リサーチ結果をDOMに描画
 */
export function renderReport(data, container) {
  if (!data || !container) return;

  currentReportSources = data.sources || [];
  currentSourcesMap = new Map();
  if (data.sources) {
    data.sources.forEach((s) => currentSourcesMap.set(Number(s.index), s));
  }

  const createdStr = fmtDate(data.createdAt);
  const durationSec = (data.durationMs / 1000).toFixed(1);

  let html = '';

  // 1. レポートヘッダーカード
  html += `
  <section class="card glass report-hero" id="sec-hero">
    <div class="rh-meta">
      <span class="tag"><span data-icon="target"></span>${esc(data.theme)}</span>
      <span class="tag"><span data-icon="layers"></span>${esc(data.scopeLabel)}</span>
      <span class="tag tag-period"><span data-icon="calendar"></span>期間: ${esc(data.periodLabel || '直近1年（最新推奨）')}</span>
      <span class="tag"><span data-icon="zap"></span>${esc(data.depthLabel)}</span>
      <span class="tag"><span data-icon="clock"></span>${esc(createdStr)} (${durationSec}秒)</span>
    </div>
    <h2>${esc(data.title)}</h2>
    ${data.subtitle ? `<p class="subtitle">${esc(data.subtitle)}</p>` : ''}
    ${
      data.notices && data.notices.length
        ? data.notices
            .map(
              (n) => `
        <div class="notice">
          <span data-icon="alert"></span>
          <span>${esc(n)}</span>
        </div>`
            )
            .join('')
        : ''
    }
  </section>
  `;

  // 2. エグゼクティブサマリー & 主要ハイライト (Bento Grid Showcase)
  html += `
  <section class="card glass bento-summary-section" id="sec-summary">
    <div class="card-head">
      <div class="ch-icon"><span data-icon="sparkles"></span></div>
      <div class="ch-titles">
        <h3>エグゼクティブサマリー &amp; キーハイライト</h3>
        <p class="ch-sub">リサーチ全体の核心結論・重要数値・示唆を30秒で把握できるエグゼクティブ要約です。</p>
      </div>
      <span class="ch-num">01</span>
    </div>

    <!-- 30秒でわかる結論ヒーローカード -->
    <div class="bento-takeaway-card">
      <div class="btc-badge"><span data-icon="zap"></span>30秒でわかる結論</div>
      <div class="summary-text btc-text">${linkifyCitations(data.summary)}</div>
    </div>

    ${
      data.metrics && data.metrics.length
        ? `
      <div class="bento-metrics-wrap">
        <h4 class="sub-block-title"><span data-icon="chart"></span>重要データ指標 &amp; 定量ハイライト</h4>
        <div class="metrics metrics-bento">
          ${data.metrics
            .map(
              (m) => `
            <div class="metric metric-bento-card">
              <div class="metric-label">${esc(m.label)}</div>
              <div class="metric-value">${esc(m.value)}</div>
              ${m.note ? `<div class="metric-note">${linkifyCitations(m.note)}</div>` : ''}
            </div>`
            )
            .join('')}
        </div>
      </div>`
        : ''
    }

    ${
      data.keyPoints && data.keyPoints.length
        ? `
      <div class="bento-keypoints-wrap" style="margin-top: 24px;">
        <h4 class="sub-block-title"><span data-icon="target"></span>最重要キーポイント &amp; アクション示唆</h4>
        <ul class="keypoints keypoints-bento">
          ${data.keyPoints
            .map(
              (kp, idx) => `
            <li class="kp-bento-item">
              <span class="kp-n">${idx + 1}</span>
              <div class="kp-content">${linkifyCitations(kp)}</div>
            </li>`
            )
            .join('')}
        </ul>
      </div>`
        : ''
    }
  </section>
  `;

  // 2.5 ディープ専用：深層思考 & 構造的因果力学
  if (data.deepThinking) {
    const dt = data.deepThinking;
    html += `
    <section class="card glass card-deep-thinking" id="sec-deep-dynamics">
      <div class="card-head">
        <div class="ch-icon ch-icon-purple"><span data-icon="sparkles"></span></div>
        <h3>アナリストの深層推論 &amp; 構造的因果力学</h3>
        <span class="badge-deep-only">ディープ専用分析</span>
      </div>

      ${
        dt.analystNote
          ? `
      <div class="analyst-hypothesis-box">
        <div class="ah-title"><span data-icon="target"></span>核心的仮説・通説の批判的再定義</div>
        <p class="ah-core">${esc(dt.analystNote.coreHypothesis)}</p>
        ${
          dt.analystNote.criticalQuestions && dt.analystNote.criticalQuestions.length
            ? `
        <div class="ah-questions-label">検証された批判的クエスチョン</div>
        <ul class="ah-questions">
          ${dt.analystNote.criticalQuestions.map((q) => `<li>${linkifyCitations(q)}</li>`).join('')}
        </ul>`
            : ''
        }
        ${dt.analystNote.analyticalMethod ? `<div class="ah-method"><small>分析アプローチ: ${esc(dt.analystNote.analyticalMethod)}</small></div>` : ''}
      </div>`
          : ''
      }

      ${
        dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length
          ? `
      <div class="dynamics-block" style="margin-top: 24px;">
        <h4 class="sub-block-title"><span data-icon="layers"></span>なぜこの課題・事象が生じているのか（構造的因果メカニズム）</h4>
        <div class="dynamics-grid">
          ${dt.dynamicsAndRootCauses
            .map(
              (d) => `
          <div class="dynamic-item">
            <div class="dynamic-head">
              <strong>${esc(d.topic)}</strong>
              ${d.keyFactor ? `<span class="dynamic-factor">核心要因: ${esc(d.keyFactor)}</span>` : ''}
            </div>
            <p>${linkifyCitations(d.mechanism)}</p>
          </div>`
            )
            .join('')}
        </div>
      </div>`
          : ''
      }
    </section>

    ${
      dt.tradeoffs && dt.tradeoffs.length
        ? `
    <section class="card glass card-deep-tradeoffs" id="sec-deep-tradeoffs">
      <div class="card-head">
        <div class="ch-icon ch-icon-amber"><span data-icon="chart"></span></div>
        <h3>多角トレードオフ &amp; 対立軸マトリクス</h3>
        <span class="badge-deep-only">ディープ専用分析</span>
      </div>
      <p class="section-intro">表面的なメリットの羅列を排し、推進派 vs 慎重派の論拠と、背後にある隠れたコスト・リスクを突き合わせて統合評価しています。</p>
      <div class="tradeoffs-grid">
        ${dt.tradeoffs
          .map(
            (t) => `
        <div class="tradeoff-card">
          <div class="tc-axis">
            <span class="tc-badge">対立軸</span>
            <strong>${esc(t.axis)}</strong>
          </div>
          <div class="tc-columns">
            <div class="tc-side pro">
              <div class="tc-side-head"><span data-icon="check"></span>推進派の論拠・メリット</div>
              <p>${linkifyCitations(t.proSide)}</p>
            </div>
            <div class="tc-side con">
              <div class="tc-side-head"><span data-icon="alert"></span>慎重派の論拠・潜在リスク</div>
              <p>${linkifyCitations(t.conSide)}</p>
            </div>
          </div>
          ${
            t.synthesis
              ? `
          <div class="tc-synthesis">
            <div class="tc-synthesis-head"><span data-icon="bulb"></span>アナリストの統合判断・最適アプローチ</div>
            <p>${linkifyCitations(t.synthesis)}</p>
          </div>`
              : ''
          }
        </div>`
          )
          .join('')}
      </div>
    </section>`
        : ''
    }
    `;
  }

  // 3. 構造化比較表 (インタラクティブソート & リアルタイム検索 & ワンクリックTSVコピー)
  if (data.table && data.table.columns && data.table.columns.length && data.table.rows && data.table.rows.length) {
    html += `
    <section class="card glass" id="sec-table">
      <div class="card-head">
        <div class="ch-icon"><span data-icon="chart"></span></div>
        <h3>構造化比較マトリクス</h3>
        <span class="ch-num">${data.deepThinking ? '04' : '02'}</span>
      </div>
      <div class="table-tools">
        <div class="table-caption">${esc(data.table.caption || '収集データ比較一覧')}（${data.table.rows.length}項目）</div>
        <div class="table-actions">
          <button type="button" class="btn btn-sm btn-ghost btn-copy-tsv" id="btn-copy-table-tsv" title="Excelやスプレッドシートに直接貼り付けできるTSV形式でコピー">
            <span data-icon="copy"></span>
            <span>表をコピー (TSV)</span>
          </button>
        </div>
        <div class="table-filter">
          <span data-icon="search"></span>
          <input type="text" class="input" id="table-search-input" placeholder="表内をキーワード絞り込み…" />
        </div>
      </div>
      <div class="table-wrap">
        <table class="matrix" id="report-matrix-table">
          <thead>
            <tr>
              ${data.table.columns
                .map(
                  (col, colIdx) => `
                <th data-col="${colIdx}">
                  <button type="button" title="${esc(col)} で並び替え">
                    <span>${esc(col)}</span>
                    <span class="sort-ind">${icon('sort')}</span>
                  </button>
                </th>`
                )
                .join('')}
            </tr>
          </thead>
          <tbody id="matrix-tbody">
            ${renderTableRows(data.table.rows, data.table.columns)}
          </tbody>
        </table>
        <div id="table-empty-msg" class="table-empty" style="display: none;">該当するデータが見つかりませんでした</div>
      </div>
    </section>
    `;
  }

  // 4. 詳細解説 & 分析
  if (data.sections && data.sections.length) {
    html += `
    <section class="card glass" id="sec-sections">
      <div class="card-head">
        <div class="ch-icon"><span data-icon="layers"></span></div>
        <h3>詳細解説・多角分析</h3>
        <span class="ch-num">${data.deepThinking ? '05' : '03'}</span>
      </div>
      ${data.sections
        .map(
          (sec) => `
        <article class="section-block">
          <div class="section-block-head">
            <h4>${esc(sec.heading)}</h4>
            <button type="button" class="btn btn-xs btn-ghost btn-deepdive-sec" data-heading="${esc(sec.heading)}" title="このテーマについてAIと深掘り調査">
              <span data-icon="sparkles"></span>
              <span>深掘り</span>
            </button>
          </div>
          <p>${linkifyCitations(sec.body)}</p>
          ${
            sec.bullets && sec.bullets.length
              ? `
            <ul>
              ${sec.bullets.map((b) => `<li>${linkifyCitations(b)}</li>`).join('')}
            </ul>`
              : ''
          }
        </article>`
        )
        .join('')}
    </section>
    `;
  }

  // 5. 示唆・提言・アクションプラン
  if (data.insights && data.insights.length) {
    html += `
    <section class="card glass" id="sec-insights">
      <div class="card-head">
        <div class="ch-icon"><span data-icon="bulb"></span></div>
        <h3>示唆・提言（Key Insights）</h3>
        <span class="ch-num">${data.deepThinking ? '06' : '04'}</span>
      </div>
      <div class="insights">
        ${data.insights
          .map(
            (ins) => `
          <div class="insight">
            <div class="insight-top">
              <span class="prio prio-${esc(ins.priority || '中')}">優先度: ${esc(ins.priority || '中')}</span>
            </div>
            <h4>${esc(ins.title)}</h4>
            <p>${esc(ins.body)}</p>
          </div>`
          )
          .join('')}
      </div>
    </section>
    `;
  }

  // 5.2 ディープ専用：将来シナリオ予測 & 戦略ロードマップ
  if (data.deepThinking && (data.deepThinking.scenarios || data.deepThinking.roadmap)) {
    const sc = data.deepThinking.scenarios;
    const rm = data.deepThinking.roadmap;
    html += `
    <section class="card glass card-deep-scenarios" id="sec-deep-scenarios">
      <div class="card-head">
        <div class="ch-icon ch-icon-cyan"><span data-icon="zap"></span></div>
        <h3>将来シナリオ予測 &amp; 実行戦略ロードマップ</h3>
        <span class="badge-deep-only">ディープ専用分析</span>
      </div>

      ${
        sc
          ? `
      <div class="scenarios-wrap">
        <h4 class="sub-block-title"><span data-icon="calendar"></span>3つの将来シナリオ予測（今後1〜3年の展開推移）</h4>
        <div class="scenarios-grid">
          <div class="sc-card main">
            <div class="sc-badge sc-main">メイン予測（高確率 60%）</div>
            <p>${linkifyCitations(sc.mainScenario)}</p>
          </div>
          <div class="sc-card upside">
            <div class="sc-badge sc-upside">加速シナリオ（上振れ 25%）</div>
            <p>${linkifyCitations(sc.upsideScenario)}</p>
          </div>
          <div class="sc-card downside">
            <div class="sc-badge sc-downside">停滞シナリオ（下振れ 15%）</div>
            <p>${linkifyCitations(sc.downsideScenario)}</p>
          </div>
        </div>
        ${
          sc.criticalTriggers && sc.criticalTriggers.length
            ? `
        <div class="sc-triggers">
          <span class="sc-triggers-label">シナリオ分岐を決定づけるトリガー指標:</span>
          ${sc.criticalTriggers.map((tr) => `<span class="trigger-chip">${linkifyCitations(tr)}</span>`).join('')}
        </div>`
            : ''
        }
      </div>`
          : ''
      }

      ${
        rm && rm.length
          ? `
      <div class="roadmap-wrap" style="margin-top: 32px;">
        <h4 class="sub-block-title"><span data-icon="trending"></span>フェーズ別 実行戦略ロードマップ</h4>
        <div class="roadmap-timeline">
          ${rm
            .map(
              (step, sIdx) => `
          <div class="roadmap-step">
            <div class="step-marker">${sIdx + 1}</div>
            <div class="step-content">
              <div class="step-phase">${esc(step.phase)}</div>
              ${step.focus ? `<div class="step-focus">重点テーマ: <strong>${esc(step.focus)}</strong></div>` : ''}
              ${
                step.actions && step.actions.length
                  ? `
              <ul class="step-actions">
                ${step.actions.map((act) => `<li>${esc(act)}</li>`).join('')}
              </ul>`
                  : ''
              }
            </div>
          </div>`
            )
            .join('')}
        </div>
      </div>`
          : ''
      }
    </section>
    `;
  }

  // 5.5 追加深掘り知見
  if (data.deepDives && data.deepDives.length) {
    html += `
    <section class="card glass card-deepdive" id="sec-deepdives">
      <div class="card-head">
        <div class="ch-icon"><span data-icon="sparkles"></span></div>
        <h3>追加深掘り知見</h3>
        <span class="ch-num">${data.deepDives.length}件</span>
      </div>
      <div class="deepdives-list">
        ${data.deepDives
          .map(
            (dd, idx) => `
          <div class="deepdive-card-item">
            <div class="dd-item-q">
              <span><strong>Q:</strong> ${esc(dd.question)}</span>
              <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove-dd="${idx}" title="この深掘り知見を削除"><span data-icon="trash"></span></button>
            </div>
            ${
              dd.quote
                ? `<blockquote class="dd-item-quote"><span data-icon="sparkles"></span>引用: “${esc(dd.quote)}”</blockquote>`
                : ''
            }
            <div class="dd-item-a">${esc(dd.answer)}</div>
            ${
              dd.keyPoints && dd.keyPoints.length
                ? `
              <ul class="dd-points">
                ${dd.keyPoints.map((kp) => `<li>${esc(kp)}</li>`).join('')}
              </ul>`
                : ''
            }
            ${
              dd.sources && dd.sources.length
                ? `
              <div class="dd-sources">
                ${dd.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.domain)} ↗</a>`).join('')}
              </div>`
                : ''
            }
          </div>`
          )
          .join('')}
      </div>
    </section>
    `;
  }

  // 6. 収集ソース一覧 & 信頼度スコア
  if (data.sources && data.sources.length) {
    html += `
    <section class="card glass" id="sec-sources">
      <div class="card-head">
        <div class="ch-icon"><span data-icon="database"></span></div>
        <h3>収集ソース一覧 &amp; 信頼度スコア</h3>
        <span class="ch-num">05</span>
      </div>
      <ul class="sources">
        ${data.sources
          .map((src) => {
            const sc = scoreClass(src.score);
            return `
          <li class="source" id="src-${src.index}">
            <span class="src-n">[${src.index}]</span>
            <div class="src-fav">
              <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(src.domain)}&sz=32" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.textContent='${esc(src.domain.slice(0, 1).toUpperCase())}'" />
            </div>
            <div class="src-main">
              <a class="src-title" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>
              <div class="src-domain">
                <span>${esc(src.domain)}</span>
                ${src.categoryBadge ? `<span class="tag tag-category" title="ドメイン分類: ${esc(src.categoryLabel || '')}"><span class="badge-icon">${esc(src.categoryBadge)}</span>${esc(src.categoryLabel || '')}</span>` : ''}
                ${src.fromMemory ? `<span class="tag tag-memory" title="過去の高信頼リサーチから参照されたドメイン"><span data-icon="sparkles"></span>知見メモリ</span>` : ''}
                ${src.publishedDate ? `<span class="tag-date" style="margin-left: 8px;">${esc(src.publishedDate.slice(0, 10))}</span>` : ''}
                ${src.snippet ? `<small style="margin-left: 8px; opacity: 0.7;">— ${esc(src.snippet.slice(0, 80))}…</small>` : ''}
              </div>
            </div>
            <div class="src-score">
              <div><span>信頼度</span> <b class="${sc.text}">${src.score}</b></div>
              <div class="score-bar"><i class="${sc.bg}" style="width: ${src.score}%;"></i></div>
            </div>
          </li>`;
          })
          .join('')}
      </ul>
    </section>
    `;
  }

  // 7. メタデータカード
  html += `
  <section class="card glass">
    <div class="meta-grid">
      <div>
        <small>調査モード</small>
        <strong>${data.mode === 'live' ? 'LIVE（Gemini + Web検索）' : 'DEMO（モック検証）'}</strong>
      </div>
      <div>
        <small>調査対象期間</small>
        <strong style="color: var(--primary-light);">${esc(data.periodLabel || '直近1年（最新推奨）')}</strong>
      </div>
      <div>
        <small>AI モデル</small>
        <strong>${esc(data.model || 'Mock Engine')}</strong>
      </div>
      <div>
        <small>検索プロバイダ</small>
        <strong>${esc(data.searchProvider || 'DuckDuckGo')}</strong>
      </div>
      <div>
        <small>収集ソース数</small>
        <strong>${data.sources ? data.sources.length : 0} 件</strong>
      </div>
    </div>
    ${
      data.queries && data.queries.length
        ? `
      <div style="margin-top: 14px;">
        <small style="color: var(--text-3); font-size: 12px; font-weight: 700; letter-spacing: 0.05em;">実行された検索クエリ</small>
        <div class="query-list">
          ${data.queries.map((q) => `<span>${esc(q)}</span>`).join('')}
        </div>
      </div>`
        : ''
    }
  </section>
  `;

  container.innerHTML = html;
  hydrateIcons(container);

  // 目次の生成
  buildTOC(data);

  // 出典リンクのスムーズスクロールとフラッシュ強調をバインド
  bindCitationClicks(container);

  // Perplexity風 出典ホバープレビューポップオーバーをバインド
  bindCitationPopover(container);

  // テーブルのソートと検索をバインド
  if (data.table && data.table.rows) {
    bindTableFeatures(data.table);
    bindTableCopyTsv(data.table);
  }

  // セクション深掘りボタンのバインド
  bindSectionDeepDives(container);

  // URLハッシュが #sec-summary の状態で開かれた場合の初期位置補正（画像1のラインへ自動調整）
  if (window.location.hash === '#sec-summary') {
    requestAnimationFrame(() => {
      const hero = document.getElementById('sec-hero');
      const exportBar = document.getElementById('export-bar');
      if (hero && exportBar) {
        const ebRect = exportBar.getBoundingClientRect();
        const ebTop = parseFloat(getComputedStyle(exportBar).top) || 86;
        const offset = ebRect.height + ebTop + 14;
        const y = Math.max(0, hero.getBoundingClientRect().top + window.pageYOffset - offset);
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  }
}

/** テーブル行のHTML生成 */
function renderTableRows(rows, columns) {
  return rows
    .map((row) => {
      return `
      <tr>
        ${row
          .map((cell, idx) => {
            const text = String(cell ?? '');
            if (['高', '中', '低'].includes(text)) {
              return `<td><span class="lv lv-${esc(text)}">${esc(text)}</span></td>`;
            }
            // 数値と単位
            return `<td>${esc(text)}</td>`;
          })
          .join('')}
      </tr>`;
    })
    .join('');
}

/** 目次（TOC）の構築とスクロール連動 */
function buildTOC(data) {
  const tocContainer = document.getElementById('result-toc');
  if (!tocContainer) return;

  const sections = [];
  sections.push({ id: 'sec-summary', label: '要約・ハイライト' });

  if (data.deepThinking) {
    sections.push({ id: 'sec-deep-dynamics', label: '深層思考・根本力学' });
    if (data.deepThinking.tradeoffs && data.deepThinking.tradeoffs.length) {
      sections.push({ id: 'sec-deep-tradeoffs', label: '多角トレードオフ' });
    }
  }

  if (data.table && data.table.rows && data.table.rows.length) {
    sections.push({ id: 'sec-table', label: '比較マトリクス' });
  }

  if (data.sections && data.sections.length) {
    sections.push({ id: 'sec-sections', label: '詳細解説・多角分析' });
  }

  if (data.insights && data.insights.length) {
    sections.push({ id: 'sec-insights', label: '示唆・提言' });
  }

  if (data.deepThinking && (data.deepThinking.scenarios || data.deepThinking.roadmap)) {
    sections.push({ id: 'sec-deep-scenarios', label: 'シナリオ・ロードマップ' });
  }

  if (data.deepDives && data.deepDives.length) {
    sections.push({ id: 'sec-deepdives', label: '追加深掘り知見' });
  }

  if (data.sources && data.sources.length) {
    sections.push({ id: 'sec-sources', label: '収集ソース' });
  }

  // 2桁の連番を動的採番
  sections.forEach((s, idx) => {
    s.num = String(idx + 1).padStart(2, '0');
  });

  tocContainer.innerHTML = `
    <div class="toc-title">INDEX</div>
    ${sections
      .map(
        (s) => `
      <a href="#${s.id}" data-target="${s.id}" data-label="${s.num} ${esc(s.label)}">
        <span class="n">${s.num}</span>
        <span>${esc(s.label)}</span>
      </a>`
      )
      .join('')}
  `;

  const links = tocContainer.querySelectorAll('a[data-target]');

  // クリック時のスムーズスクロール制御（上部固定バーのオフセットを計算）
  links.forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = a.dataset.target;

      // 「01 要約・ハイライト」の場合は、タイトル・メタタグも含めた最上部（#sec-hero）へ遡る（画像1のライン）
      const targetEl =
        targetId === 'sec-summary'
          ? document.getElementById('sec-hero') || document.getElementById('sec-summary')
          : document.getElementById(targetId);

      if (!targetEl) return;

      // スティッキーエクスポートバーの下端位置を動的に計算して正確なオフセットを算出
      const exportBar = document.getElementById('export-bar');
      let offset = 148;
      if (exportBar) {
        const ebRect = exportBar.getBoundingClientRect();
        const ebTop = parseFloat(getComputedStyle(exportBar).top) || 86;
        offset = ebRect.height + ebTop + 14;
      }

      const elementTop = targetEl.getBoundingClientRect().top + window.pageYOffset;
      const scrollToY = Math.max(0, elementTop - offset);

      window.scrollTo({
        top: scrollToY,
        behavior: 'smooth',
      });

      // 履歴を汚さずにURLハッシュを同期
      try {
        history.replaceState(null, '', `#${targetId}`);
      } catch {}

      // アクティブ状態を即時反映
      links.forEach((l) => l.classList.remove('active'));
      a.classList.add('active');
    });
  });

  // スクロール監視（#sec-hero も 01 要約・ハイライト の領域として連動）
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const activeTargetId = id === 'sec-hero' ? 'sec-summary' : id;
          links.forEach((a) => {
            if (a.dataset.target === activeTargetId) a.classList.add('active');
            else a.classList.remove('active');
          });
        }
      });
    },
    { rootMargin: '-100px 0px -60% 0px', threshold: 0.05 }
  );

  const heroEl = document.getElementById('sec-hero');
  if (heroEl) observer.observe(heroEl);

  sections.forEach((s) => {
    const el = document.getElementById(s.id);
    if (el) observer.observe(el);
  });
}

/** 出典クリック時のスクロールとハイライトアニメーション */
function bindCitationClicks(container) {
  container.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-cite]');
    if (!a) return;
    e.preventDefault();
    const citeNum = a.dataset.cite;
    const target = document.getElementById(`src-${citeNum}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('flash');
      void target.offsetWidth; // reflow
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 2500);
    }
  });
}

/** テーブルのソートとインクリメンタル検索 */
function bindTableFeatures(tableData) {
  const tbody = document.getElementById('matrix-tbody');
  const searchInput = document.getElementById('table-search-input');
  const emptyMsg = document.getElementById('table-empty-msg');
  const thList = document.querySelectorAll('#report-matrix-table th');

  let currentRows = [...tableData.rows];
  let sortCol = -1;
  let sortAsc = true;
  let filterQuery = '';

  function update() {
    let filtered = currentRows;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      filtered = currentRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(q)));
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      emptyMsg.style.display = 'block';
    } else {
      emptyMsg.style.display = 'none';
      tbody.innerHTML = renderTableRows(filtered, tableData.columns);
    }
  }

  // 検索入力
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterQuery = e.target.value.trim();
      update();
    });
  }

  // ソートクリック
  thList.forEach((th) => {
    th.addEventListener('click', () => {
      const colIdx = Number(th.dataset.col);
      if (sortCol === colIdx) {
        sortAsc = !sortAsc;
      } else {
        sortCol = colIdx;
        sortAsc = true;
      }

      thList.forEach((h) => h.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');

      currentRows.sort((a, b) => {
        let va = a[colIdx] ?? '';
        let vb = b[colIdx] ?? '';

        // 数値抽出
        const na = parseFloat(String(va).replace(/[^\d.-]/g, ''));
        const nb = parseFloat(String(vb).replace(/[^\d.-]/g, ''));
        if (!isNaN(na) && !isNaN(nb)) {
          return sortAsc ? na - nb : nb - na;
        }

        return sortAsc ? String(va).localeCompare(String(vb), 'ja') : String(vb).localeCompare(String(va), 'ja');
      });

      update();
    });
  });
}

/** Perplexity風の出典ホバープレビューポップオーバー */
let hoverCardEl = null;
let hoverTimer = null;

function getOrCreateHoverCard() {
  if (hoverCardEl) return hoverCardEl;
  hoverCardEl = document.createElement('div');
  hoverCardEl.id = 'cite-hover-card';
  hoverCardEl.className = 'cite-popover';
  hoverCardEl.style.display = 'none';
  document.body.appendChild(hoverCardEl);

  // ポップオーバー自体にマウスが入ったときは非表示を保留
  hoverCardEl.addEventListener('mouseenter', () => {
    clearTimeout(hoverTimer);
  });
  hoverCardEl.addEventListener('mouseleave', () => {
    hideHoverCard();
  });

  return hoverCardEl;
}

function hideHoverCard() {
  clearTimeout(hoverTimer);
  if (hoverCardEl) {
    hoverCardEl.style.opacity = '0';
    hoverCardEl.style.transform = 'translateY(6px)';
    hoverCardEl.style.pointerEvents = 'none';
    setTimeout(() => {
      if (hoverCardEl && hoverCardEl.style.opacity === '0') {
        hoverCardEl.style.display = 'none';
      }
    }, 200);
  }
}

function bindCitationPopover(container) {
  const card = getOrCreateHoverCard();
  const cites = container.querySelectorAll('a[data-cite]');

  cites.forEach((a) => {
    a.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
      const citeNum = Number(a.dataset.cite);
      const src = currentSourcesMap.get(citeNum);
      if (!src) return;

      const sc = scoreClass(src.score);
      card.innerHTML = `
        <div class="cp-header">
          <div class="cp-num">[${src.index}]</div>
          <div class="cp-domain-group">
            <span class="cp-domain">${esc(src.domain)}</span>
            ${src.categoryBadge ? `<span class="tag tag-category">${esc(src.categoryBadge)} ${esc(src.categoryLabel || '')}</span>` : ''}
          </div>
          <div class="cp-score ${sc.text}">信頼度: <strong>${src.score}</strong></div>
        </div>
        <a class="cp-title" href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>
        ${src.snippet ? `<div class="cp-snippet">${esc(src.snippet.slice(0, 160))}…</div>` : ''}
        <div class="cp-footer">
          <span>クリックでページ下部の出典詳細へ移動</span>
          <a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer" class="cp-link">サイトを開く ↗</a>
        </div>
      `;

      card.style.display = 'block';
      card.style.opacity = '0';
      card.style.pointerEvents = 'auto';

      // 位置計算
      const aRect = a.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;

      let top = aRect.top + scrollY - cardRect.height - 10;
      let left = aRect.left + scrollX + aRect.width / 2 - cardRect.width / 2;

      // 画面上部にはみ出す場合は下に表示
      if (top < scrollY + 10) {
        top = aRect.bottom + scrollY + 10;
      }

      // 画面左右のクランプ
      const maxLeft = document.documentElement.clientWidth - cardRect.width - 16;
      if (left < 16) left = 16;
      if (left > maxLeft) left = maxLeft;

      card.style.top = `${top}px`;
      card.style.left = `${left}px`;

      requestAnimationFrame(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      });
    });

    a.addEventListener('mouseleave', () => {
      hoverTimer = setTimeout(hideHoverCard, 250);
    });
  });
}

/** 比較表のワンクリックTSVコピー */
function bindTableCopyTsv(tableData) {
  const btn = document.getElementById('btn-copy-table-tsv');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!tableData) return;
    const tsv = tableToTSV(tableData);
    const ok = await copyText(tsv);
    if (ok) {
      toast('表データをTSV形式でコピーしました（Excelやスプレッドシートに直接貼り付け可能）', 'success');
    } else {
      toast('表データのコピーに失敗しました', 'error');
    }
  });
}

/** セクションごとの深掘りボタン */
function bindSectionDeepDives(container) {
  const btns = container.querySelectorAll('.btn-deepdive-sec');
  btns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const heading = btn.dataset.heading || '';
      document.dispatchEvent(
        new CustomEvent('open-deepdive-prompt', {
          detail: {
            heading,
            query: `「${heading}」について、具体的な事例や課題、今後の見通しを詳しく教えてください`,
          },
        })
      );
    });
  });
}

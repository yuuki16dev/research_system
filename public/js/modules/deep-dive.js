// ==========================================================================
// レポート深掘りアシスタント (Deep Dive Drawer & Text Selection Quote)
// ==========================================================================

import { $, $$, icon, hydrateIcons, openModal, closeModal, toast, esc } from '../ui.js';
import { api } from '../api.js';
import { renderReport } from '../render.js';
import { appState } from './state.js';

// ==========================================================================
// レポート深掘りアシスタント（ハイブリッド方式: スプリットビュー & 引用深掘り & レポート追加）
// ==========================================================================
export const deepDiveState = {
  history: [], // [{ question, answer, keyPoints, sources, added: boolean }]
  currentQuote: '', // 現在引用中のテキスト
  isQuerying: false, // 深掘りAI問い合わせ実行中フラグ
};

/**
 * レポートデータからAIが質問の文脈を正確に把握できる構造化コンテキスト（最大約1500文字）を生成
 */
export function buildReportStructuredContext(result) {
  if (!result) return '';
  const parts = [];

  // 1. 基本情報
  if (result.title) parts.push(`【レポート表題】${result.title}`);
  if (result.theme && result.theme !== result.title) parts.push(`【調査テーマ】${result.theme}`);

  // 2. エグゼクティブサマリー
  if (result.summary) {
    const summaryText = result.summary.length > 400 ? `${result.summary.slice(0, 400)}…` : result.summary;
    parts.push(`【エグゼクティブサマリー】\n${summaryText}`);
  }

  // 3. 重要数値・KPI (metrics)
  if (Array.isArray(result.metrics) && result.metrics.length > 0) {
    const metricLines = result.metrics.slice(0, 5).map(m => {
      const val = m.value ? `: ${m.value}` : '';
      const chg = m.change ? ` (${m.change})` : '';
      return `・${m.label || m.name || '指標'}${val}${chg}`;
    });
    parts.push(`【重要数値・主要KPI】\n${metricLines.join('\n')}`);
  }

  // 4. 比較・構造化テーブル (table)
  if (result.table && Array.isArray(result.table.headers) && Array.isArray(result.table.rows) && result.table.rows.length > 0) {
    const headers = result.table.headers.slice(0, 5).join(' | ');
    const rowLines = result.table.rows.slice(0, 4).map(r => {
      const cells = Array.isArray(r) ? r : Object.values(r);
      return cells.slice(0, 5).join(' | ');
    });
    parts.push(`【比較マトリクス表】\n| ${headers} |\n${rowLines.map(r => `| ${r} |`).join('\n')}`);
  }

  // 5. 主要インサイト (insights)
  if (Array.isArray(result.insights) && result.insights.length > 0) {
    const insightLines = result.insights.slice(0, 3).map((ins, i) => {
      const title = typeof ins === 'string' ? ins : (ins.title || ins.heading || `インサイト${i + 1}`);
      const desc = typeof ins === 'object' && ins.description ? ` - ${ins.description.slice(0, 100)}` : '';
      return `・${title}${desc}`;
    });
    parts.push(`【主要インサイト】\n${insightLines.join('\n')}`);
  }

  // 6. 各セクションの見出し一覧
  if (Array.isArray(result.sections) && result.sections.length > 0) {
    const secLines = result.sections.slice(0, 6).map(s => `・${s.heading || s.title || ''}`);
    parts.push(`【章立て・セクション】\n${secLines.join('\n')}`);
  }

  // 7. 要点 (keyPoints)
  if (Array.isArray(result.keyPoints) && result.keyPoints.length > 0) {
    parts.push(`【キーポイント】\n${result.keyPoints.slice(0, 4).map(k => `・${k}`).join('\n')}`);
  }

  const fullText = parts.join('\n\n');
  return fullText.length > 1500 ? `${fullText.slice(0, 1500)}…` : fullText;
}

export function bindDeepDiveDrawer() {
  const btnOpen = $('#btn-open-deepdive');
  const themeMini = $('#dd-theme-title');
  const messages = $('#deepdive-messages');
  const form = $('#form-deepdive');
  const input = $('#input-deepdive');
  const submitBtn = $('#btn-submit-deepdive');
  const drawerEl = $('#drawer-deepdive');
  const btnExpand = $('#btn-toggle-dd-expand');
  const quotePreview = $('#dd-quote-preview');
  const quoteTextEl = $('#dd-qp-text');
  const btnClearQuote = $('#btn-clear-quote');
  const selectionTooltip = $('#selection-quote-tooltip');
  const btnQuoteAsk = $('#btn-quote-ask');

  let activeSelectedText = '';

  // 画面幅がスプリットビュー（Side-by-Side）に十分か判定（タブレット・スマホではオーバーレイに切り替え）
  function isSplitScreenSupported() {
    return window.innerWidth >= 1024;
  }

  function openDeepDive(forceSplit = null) {
    if (!appState.currentResult) {
      toast('まずはリサーチを実行するか、履歴からレポートを選択してください', 'info');
      return;
    }
    if (themeMini) {
      themeMini.textContent = appState.currentResult.title || appState.currentResult.theme;
    }

    const shouldSplit = forceSplit !== null ? forceSplit : isSplitScreenSupported();

    if (shouldSplit) {
      // デスクトップ用 Side-by-Side スプリットビュー
      document.body.classList.remove('has-deepdive-modal');
      document.body.classList.add('has-deepdive-split');
      if (drawerEl) drawerEl.hidden = false;
      document.body.style.overflow = '';
    } else {
      // タブレット・スマホ用 全画面/オーバーレイモーダルドロワー（背後との被りを完全に防ぐ）
      document.body.classList.remove('has-deepdive-split');
      document.body.classList.add('has-deepdive-modal');
      openModal('drawer-deepdive');
    }

    if (input) setTimeout(() => input.focus(), 120);
  }

  function closeDeepDive() {
    document.body.classList.remove('has-deepdive-split');
    document.body.classList.remove('has-deepdive-modal');
    document.body.classList.remove('dd-expanded');
    if (drawerEl) drawerEl.hidden = true;
    closeModal('drawer-deepdive');
    clearQuote();
    hideSelectionTooltip();
  }

  // 画面リサイズ時にスプリットとオーバーレイを動的同期（UI被り・崩れを防止）
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (drawerEl && !drawerEl.hidden) {
        if (isSplitScreenSupported()) {
          // デスクトップ幅になったらスプリットに昇格
          document.body.classList.remove('has-deepdive-modal');
          document.body.classList.add('has-deepdive-split');
          document.body.style.overflow = '';
        } else {
          // 画面が狭くなったらオーバーレイに切り替え（レポートとの重なり被りを即時解消）
          document.body.classList.remove('has-deepdive-split');
          document.body.classList.add('has-deepdive-modal');
        }
      }
    }, 100);
  });

  // 引用の設定とクリア
  function setQuote(text) {
    if (!text || !text.trim()) return;
    deepDiveState.currentQuote = text.trim();
    if (quoteTextEl) quoteTextEl.textContent = `“${deepDiveState.currentQuote}”`;
    if (quotePreview) quotePreview.hidden = false;
    if (input) {
      input.placeholder = '引用した箇所について質問（例: この理由や詳細、具体的な注意点は？）';
      input.focus();
    }
  }

  function clearQuote() {
    deepDiveState.currentQuote = '';
    if (quotePreview) quotePreview.hidden = true;
    if (quoteTextEl) quoteTextEl.textContent = '';
    if (input) input.placeholder = '例: 〇〇サービスの料金体系をもっと詳しく…';
  }

  if (btnClearQuote) {
    btnClearQuote.addEventListener('click', (e) => {
      e.stopPropagation();
      clearQuote();
    });
  }

  // パネル幅の拡大/標準トグル
  if (btnExpand) {
    btnExpand.addEventListener('click', () => {
      const isExp = document.body.classList.toggle('dd-expanded');
      btnExpand.title = isExp ? 'パネル幅を標準に戻す' : 'パネル幅を広げる';
      toast(isExp ? '深掘りパネルをワイド表示に切り替えました' : '深掘りパネルを標準幅に戻しました', 'info', 1500);
    });
  }

  // 閉じるボタンの拡張監視
  if (drawerEl) {
    drawerEl.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeDeepDive());
    });
  }

  if (btnOpen) {
    btnOpen.addEventListener('click', () => openDeepDive());
  }

  // レポート内セクションの「深掘り」ボタンからの発火をリッスン
  document.addEventListener('open-deepdive-prompt', (e) => {
    const { heading, query } = e.detail || {};
    openDeepDive();
    if (themeMini && appState.currentResult) {
      themeMini.textContent = `${appState.currentResult.title || appState.currentResult.theme} — [${heading || '項目深掘り'}]`;
    }
    if (input) {
      input.value = query || '';
      setTimeout(() => {
        input.focus();
        input.select();
      }, 150);
    }
  });

  // クイック質問チップのクリック
  $$('.dd-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.ddQuery;
      if (input && q) {
        input.value = q;
        submitDeepDiveQuery(q);
      }
    });
  });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (input && input.value.trim()) || '';
      if (!q) return;
      submitDeepDiveQuery(q);
    });
  }

  // =========================================================================
  // レポート文章のテキストドラッグ選択によるフローティング引用ツールチップ
  // =========================================================================
  function hideSelectionTooltip() {
    if (selectionTooltip) {
      selectionTooltip.hidden = true;
      selectionTooltip.classList.remove('tooltip-below');
      activeSelectedText = '';
    }
  }

  function handleTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideSelectionTooltip();
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 3) {
      hideSelectionTooltip();
      return;
    }

    // レポートエリア内の選択かチェック
    const reportArea = $('#report') || $('#results-section');
    if (!reportArea || !selection.anchorNode || !reportArea.contains(selection.anchorNode)) {
      hideSelectionTooltip();
      return;
    }

    // ツールチップ位置の計算（端末画面端でのクランプ＆画面上端での上下反転でUI被り・見切れを完全防止）
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      activeSelectedText = text;
      if (selectionTooltip) {
        selectionTooltip.hidden = false;
        hydrateIcons(selectionTooltip);

        // ツールチップの概算サイズとセーフティ余白
        const tooltipW = selectionTooltip.offsetWidth || 250;
        const padding = 12;

        // 水平位置のクランプ（左端・右端からのはみ出しを確実に防止）
        const centerX = rect.left + rect.width / 2;
        const minX = padding + tooltipW / 2;
        const maxX = window.innerWidth - padding - tooltipW / 2;
        const clampedX = Math.max(minX, Math.min(maxX, centerX));

        // 垂直位置（画面上端のトップバーや見出しと被る場合は下側に反転表示）
        const spaceAbove = rect.top;
        const isNearTop = spaceAbove < 80;

        if (isNearTop) {
          // テキスト下側に出現（被り防止）
          const top = rect.bottom + window.scrollY + 8;
          selectionTooltip.style.top = `${top}px`;
          selectionTooltip.style.left = `${clampedX + window.scrollX}px`;
          selectionTooltip.classList.add('tooltip-below');
        } else {
          // テキスト上側に出現
          const top = rect.top + window.scrollY - 8;
          selectionTooltip.style.top = `${top}px`;
          selectionTooltip.style.left = `${clampedX + window.scrollX}px`;
          selectionTooltip.classList.remove('tooltip-below');
        }
      }
    } catch {
      hideSelectionTooltip();
    }
  }

  document.addEventListener('mouseup', () => {
    setTimeout(handleTextSelection, 30);
  });

  document.addEventListener('touchend', () => {
    setTimeout(handleTextSelection, 50);
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
      setTimeout(handleTextSelection, 30);
    }
  });

  // 選択解除時に隠す
  document.addEventListener('mousedown', (e) => {
    if (selectionTooltip && !selectionTooltip.contains(e.target)) {
      hideSelectionTooltip();
    }
  });

  // フローティングツールチップのクリック
  if (btnQuoteAsk) {
    btnQuoteAsk.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const textToQuote = activeSelectedText;
      hideSelectionTooltip();
      if (!textToQuote) return;

      setQuote(textToQuote);
      openDeepDive();
      toast('選択した文章を引用しました。質問を入力してください', 'info', 2200);
    });
  }

  // =========================================================================
  // 深掘り質問の送信
  // =========================================================================
  async function submitDeepDiveQuery(question) {
    if (!appState.currentResult) return;
    deepDiveState.isQuerying = true;
    const sentQuote = deepDiveState.currentQuote;
    if (input) input.value = '';
    if (submitBtn) submitBtn.disabled = true;

    // ユーザー発言をメッセージに追加（引用があれば引用カードも表示）
    const userMsgEl = document.createElement('div');
    userMsgEl.className = 'dd-msg user';
    const quoteHtml = sentQuote
      ? `<div class="dd-msg-quote">📎 引用: 「${esc(sentQuote.slice(0, 160))}${sentQuote.length > 160 ? '…' : ''}」</div>`
      : '';
    userMsgEl.innerHTML = `
      <div class="dd-bubble">
        ${quoteHtml}
        <div>${esc(question)}</div>
      </div>
    `;
    messages.appendChild(userMsgEl);

    // AIのロード中バブル
    const aiMsgEl = document.createElement('div');
    aiMsgEl.className = 'dd-msg ai';
    aiMsgEl.innerHTML = `
      <div class="dd-bubble">
        <div class="dd-bubble-header">
          <span class="dd-tag"><span data-icon="sparkles"></span>${sentQuote ? '引用箇所とWebを照合解析中…' : 'Web検索＆AI解析中…'}</span>
          <span class="pulse-orb" style="width: 8px; height: 8px;"></span>
        </div>
        <p style="color: var(--text-2); margin: 0;">「${esc(question)}」に関する最新情報を高速調査しています（約5〜8秒）…</p>
      </div>
    `;
    messages.appendChild(aiMsgEl);
    hydrateIcons(aiMsgEl);
    aiMsgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // 送信完了したので引用プレビューはクリア
    clearQuote();

    try {
      // 直近の対話履歴を最大4件抽出（マルチターン対話コンテキスト）
      const chatHistory = deepDiveState.history.slice(-4).map((h) => ({
        question: h.originalQuestion || h.question,
        answer: h.answer ? (h.answer.length > 250 ? `${h.answer.slice(0, 250)}…` : h.answer) : '',
        quote: h.quote || '',
      }));

      // レポート全体の構造化コンテキスト（サマリー、KPI、比較表、主要インサイト等）
      const reportContext = buildReportStructuredContext(appState.currentResult);

      const res = await api.deepDive({
        theme: appState.currentResult.theme,
        question,
        reportContext,
        period: appState.currentResult.period || 'year',
        quote: sentQuote || '',
        chatHistory,
      });

      const entry = {
        question: sentQuote ? `【引用】${sentQuote.slice(0, 100)}… への質問: ${question}` : question,
        originalQuestion: question,
        quote: sentQuote,
        answer: res.answer,
        keyPoints: res.keyPoints || [],
        sources: res.sources || [],
        added: false,
      };
      deepDiveState.history.push(entry);
      const entryIdx = deepDiveState.history.length - 1;

      // 回答バブルの描画
      aiMsgEl.innerHTML = `
        <div class="dd-bubble">
          <div class="dd-bubble-header">
            <span class="dd-tag"><span data-icon="sparkles"></span>深掘り知見回答</span>
            <span>${new Date().toLocaleTimeString('ja-JP')}</span>
          </div>
          <div>${esc(res.answer)}</div>
          ${
            res.keyPoints && res.keyPoints.length
              ? `
            <ul class="dd-points">
              ${res.keyPoints.map((kp) => `<li>${esc(kp)}</li>`).join('')}
            </ul>`
              : ''
          }
          ${
            res.sources && res.sources.length
              ? `
            <div class="dd-sources">
              ${res.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.domain)} ↗</a>`).join('')}
            </div>`
              : ''
          }
          <div class="dd-actions">
            <button type="button" class="btn-add-to-report" data-add-dd-idx="${entryIdx}">
              <span data-icon="plus"></span>末尾に追加
            </button>
            <button type="button" class="btn-merge-action" data-merge-summary-idx="${entryIdx}" title="この知見をエグゼクティブサマリーに追記統合">
              <span data-icon="file-text"></span>サマリーに統合
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-copy-dd="${entryIdx}">
              <span data-icon="copy"></span>コピー
            </button>
          </div>
        </div>
      `;
      hydrateIcons(aiMsgEl);
      aiMsgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // コピーボタン
      const copyBtn = aiMsgEl.querySelector(`[data-copy-dd="${entryIdx}"]`);
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          let text = `${sentQuote ? `【引用】${sentQuote}\n` : ''}【深掘り質問】${question}\n\n${res.answer}`;
          if (res.keyPoints && res.keyPoints.length) {
            text += '\n\n【要点】\n' + res.keyPoints.map((p) => `- ${p}`).join('\n');
          }
          await copyText(text);
          toast('回答テキストをコピーしました', 'success');
        });
      }

      // サマリーに統合ボタン
      const mergeSummaryBtn = aiMsgEl.querySelector(`[data-merge-summary-idx="${entryIdx}"]`);
      if (mergeSummaryBtn) {
        mergeSummaryBtn.addEventListener('click', async () => {
          if (mergeSummaryBtn.classList.contains('merged')) return;
          mergeSummaryBtn.classList.add('merged');
          mergeSummaryBtn.innerHTML = `<span data-icon="check"></span>サマリー統合済`;
          hydrateIcons(mergeSummaryBtn);

          // サマリー末尾に追記
          const addition = `【追加調査知見: ${question}】\n${res.answer}`;
          appState.currentResult.summary = appState.currentResult.summary
            ? `${appState.currentResult.summary}\n\n${addition}`
            : addition;

          // キーポイントも統合
          if (res.keyPoints && res.keyPoints.length) {
            appState.currentResult.keyPoints = appState.currentResult.keyPoints || [];
            res.keyPoints.forEach((kp) => {
              if (!appState.currentResult.keyPoints.includes(kp)) {
                appState.currentResult.keyPoints.push(`【深掘り】${kp}`);
              }
            });
          }

          // 再描画
          renderReport(appState.currentResult, $('#report'));
          bindReportDeepDiveActions();

          // 履歴ストレージに永続保存
          if (appState.currentResult.id) {
            try {
              await api.patchHistory(appState.currentResult.id, {
                summary: appState.currentResult.summary,
                keyPoints: appState.currentResult.keyPoints,
              });
            } catch {}
          }

          toast('深掘り知見をエグゼクティブサマリーに統合しました！（PDF・PPTX出力にも同期されます）', 'success');
        });
      }

      // レポートに追加ボタン
      const addBtn = aiMsgEl.querySelector(`[data-add-dd-idx="${entryIdx}"]`);
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          if (entry.added) return;
          entry.added = true;
          addBtn.classList.add('added');
          addBtn.innerHTML = `<span data-icon="check"></span>追加済み`;
          hydrateIcons(addBtn);

          // レポートデータへ統合（引用付きで記録）
          appState.currentResult.deepDives = appState.currentResult.deepDives || [];
          appState.currentResult.deepDives.push({
            question: entry.question,
            answer: entry.answer,
            keyPoints: entry.keyPoints,
            sources: entry.sources,
            quote: entry.quote,
          });

          // 再描画（左側のレポート画面がリアルタイムで更新され、追加された知見が即座に見える！）
          renderReport(appState.currentResult, $('#report'));
          bindReportDeepDiveActions();

          // 履歴ストレージにも即時永続保存
          if (appState.currentResult.id) {
            try {
              await api.patchHistory(appState.currentResult.id, {
                deepDives: appState.currentResult.deepDives,
              });
            } catch {}
          }

          toast('深掘り知見をレポートに追加しました！（左側のレポート末尾に即座に反映されました）', 'success');
        });
      }
    } catch (err) {
      aiMsgEl.innerHTML = `
        <div class="dd-bubble" style="border-left-color: var(--danger);">
          <div class="dd-bubble-header">
            <span style="color: var(--danger-light);"><span data-icon="alert"></span>調査エラー</span>
          </div>
          <p style="color: var(--danger); margin: 0;">深掘り調査に失敗しました: ${esc(err.message)}</p>
        </div>
      `;
      hydrateIcons(aiMsgEl);
    } finally {
      deepDiveState.isQuerying = false;
      if (submitBtn) submitBtn.disabled = false;
      if (input) input.focus();
    }
  }

  bindReportDeepDiveActions();
}

/** レポート内の深掘り削除ボタンなどのバインド */
export function bindReportDeepDiveActions() {
  $$('[data-remove-dd]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.removeDd);
      if (isNaN(idx) || !appState.currentResult || !appState.currentResult.deepDives) return;
      if (confirm('この深掘り知見をレポートから削除しますか？')) {
        appState.currentResult.deepDives.splice(idx, 1);
        renderReport(appState.currentResult, $('#report'));
        bindReportDeepDiveActions();
        if (appState.currentResult.id) {
          try {
            await api.patchHistory(appState.currentResult.id, {
              deepDives: appState.currentResult.deepDives,
            });
          } catch {}
        }
        toast('深掘り知見を削除しました', 'info');
      }
    });
  });
}

// ==========================================================================
// リサーチ実行ライフサイクル & フォーム制御 (Research Lifecycle & Form Controls)
// ==========================================================================

import { $, $$, icon, hydrateIcons, toast, esc, openModal } from '../ui.js';
import { api } from '../api.js';
import { renderReport } from '../render.js';
import { appState } from './state.js';
import { bindReportDeepDiveActions } from './deep-dive.js';
import { loadRecentHistory } from './history.js';

export function bindFormControls() {
  const form = $('#research-form');
  const themeInput = $('#theme-input');
  const themeCount = $('#theme-count');
  const sitesField = $('#sites-field');
  const scopeRadios = $$('input[name="scope"]');
  const exampleChips = $$('#example-chips .chip');

  // 文字数カウント & 自動拡張
  function updateCount() {
    const len = themeInput.value.length;
    themeCount.textContent = `${len} / 300`;
  }
  themeInput.addEventListener('input', updateCount);

  // Ctrl + Enter で即実行
  themeInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // 目的別リサーチプリセットの選択 & 動的プレースホルダー連動
  const purposeChips = $$('.purpose-preset-bar .purpose-chip, #purpose-presets-bar .purpose-chip');
  const purposeInput = $('#purpose-input');
  const purposePlaceholders = {
    general: '知りたいテーマを自由に入力（例: 人工知能の次世代半導体市場の最新動向と主要企業の戦略）',
    compare: '比較したい対象を並べて入力（例: Notion AI vs ChatGPT Team vs Claude Team の機能・料金・セキュリティ比較）',
    business: '検討中の事業ドメインを入力（例: シニア向け健康管理SaaSの国内市場規模・主要プレイヤー・参入障壁）',
    tool: '探しているツールカテゴリを入力（例: 中小企業向け経費精算・会計ソフトのおすすめ比較（機能・連携性・導入実績））',
    risk: '検証したい技術や事業を入力（例: 生成AI実務導入における著作権・情報漏洩リスクとガイドライン対策）',
    trend: '最新動向を知りたい分野を入力（例: 2026年の自律型AIエージェント（Agentic AI）の進化と実務適用）',
  };

  purposeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      purposeChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const p = chip.dataset.purpose || 'general';
      if (purposeInput) purposeInput.value = p;
      if (themeInput && !themeInput.value.trim() && purposePlaceholders[p]) {
        themeInput.placeholder = purposePlaceholders[p];
      }
    });
  });

  // サンプルチップクリック
  exampleChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      themeInput.value = chip.dataset.example;
      updateCount();
      themeInput.focus();
    });
  });

  // 調査範囲ラジオ変更でサイト入力欄の開閉
  scopeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'sites' && radio.checked) {
        sitesField.hidden = false;
        $('#sites-input').focus();
      } else {
        sitesField.hidden = true;
      }
    });
  });

  // 期間指定ラジオ変更でカスタム期間入力欄の開閉
  const periodRadios = $$('input[name="period"]');
  const customPeriodBox = $('#custom-period-box');
  const customPeriodText = $('#custom-period-text');
  const cpStartSelect = $('#custom-period-start');
  const cpEndSelect = $('#custom-period-end');

  periodRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.value === 'custom' && radio.checked) {
        if (customPeriodBox) customPeriodBox.hidden = false;
        if (customPeriodText) {
          if (!customPeriodText.value) {
            customPeriodText.value = `${cpStartSelect ? cpStartSelect.value : '2020'}〜${cpEndSelect ? cpEndSelect.value : '2023'}年`;
          }
          customPeriodText.focus();
        }
      } else {
        if (customPeriodBox) customPeriodBox.hidden = true;
      }
    });
  });

  // カスタム期間の開始年・終了年セレクト変更
  function syncYearSelectToText() {
    if (cpStartSelect && cpEndSelect && customPeriodText) {
      customPeriodText.value = `${cpStartSelect.value}〜${cpEndSelect.value}年`;
    }
  }
  if (cpStartSelect) cpStartSelect.addEventListener('change', syncYearSelectToText);
  if (cpEndSelect) cpEndSelect.addEventListener('change', syncYearSelectToText);

  // カスタム期間クイック選択チップ
  $$('[data-cp-preset]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const preset = chip.dataset.cpPreset;
      if (customPeriodText) customPeriodText.value = preset;
      // 年号が含まれていればセレクトも同期
      const years = [...preset.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => m[1]);
      if (years.length >= 2) {
        if (cpStartSelect) cpStartSelect.value = years[0];
        if (cpEndSelect) cpEndSelect.value = years[1];
      }
      if (customPeriodText) customPeriodText.focus();
    });
  });

  // 詳細オプション（アコーディオン）の開閉
  const btnToggleOptions = $('#btn-toggle-options');
  const optionsAccordion = $('#options-accordion');
  const optionsSummaryTag = $('#options-summary-tag');

  function updateOptionsSummaryTag() {
    if (!optionsSummaryTag) return;
    const scopeVal = ($('input[name="scope"]:checked') || {}).value || 'web';
    const periodVal = ($('input[name="period"]:checked') || {}).value || 'year';
    const scopeNames = { web: 'Web全体', sns: 'SNS・トレンド', sites: '特定サイト' };
    const periodNames = { year: '直近1年', month: '直近1ヶ月', '3years': '直近3年', all: '全期間', custom: '年代指定' };
    optionsSummaryTag.textContent = `${scopeNames[scopeVal] || 'Web全体'} · ${periodNames[periodVal] || '直近1年'}`;
  }

  if (btnToggleOptions && optionsAccordion) {
    btnToggleOptions.addEventListener('click', () => {
      const isHidden = optionsAccordion.hidden;
      optionsAccordion.hidden = !isHidden;
      btnToggleOptions.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      btnToggleOptions.classList.toggle('is-open', isHidden);
    });
  }

  scopeRadios.forEach((r) => r.addEventListener('change', updateOptionsSummaryTag));
  periodRadios.forEach((r) => r.addEventListener('change', updateOptionsSummaryTag));
  updateOptionsSummaryTag();

  // フォーム送信
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const theme = themeInput.value.trim();
    if (theme.length < 2) {
      toast('テーマを2文字以上で入力してください', 'error');
      themeInput.focus();
      return;
    }

    const scope = ($('input[name="scope"]:checked') || {}).value || 'web';
    const depth = ($('input[name="depth"]:checked') || {}).value || 'quick';
    const sites = $('#sites-input').value.trim();

    const period = ($('input[name="period"]:checked') || {}).value || 'year';
    let customPeriod = '';
    if (period === 'custom') {
      customPeriod = (customPeriodText && customPeriodText.value.trim()) ||
        `${cpStartSelect ? cpStartSelect.value : '2020'}〜${cpEndSelect ? cpEndSelect.value : '2023'}年`;
    }

    const purpose = ($('#purpose-input') && $('#purpose-input').value) || 'general';
    const referenceContext = ($('#reference-context-input') && $('#reference-context-input').value.trim()) || '';

    await startResearch({ theme, scope, depth, sites, period, customPeriod, purpose, referenceContext });
  });

  // 中止ボタンのバインド（プログレス内・フォーム内・トップバー内）
  $('#btn-cancel').addEventListener('click', cancelCurrentResearch);
  const btnFormStop = $('#btn-form-stop');
  if (btnFormStop) btnFormStop.addEventListener('click', cancelCurrentResearch);
  const btnTopbarCancel = $('#btn-topbar-cancel');
  if (btnTopbarCancel) btnTopbarCancel.addEventListener('click', cancelCurrentResearch);

  // 中止バナーのアクションボタン
  const btnDismiss = $('#btn-dismiss-progress');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      const banner = $('#progress-aborted-banner');
      if (banner) banner.style.display = 'none';
      $('#progress-section').hidden = true;
      $('#control-panel').scrollIntoView({ behavior: 'smooth' });
    });
  }
  const btnRetry = $('#btn-retry-progress');
  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      const banner = $('#progress-aborted-banner');
      if (banner) banner.style.display = 'none';
      if (appState.lastParams) {
        startResearch(appState.lastParams);
      } else {
        form.requestSubmit();
      }
    });
  }

  // エラーバナーのアクションボタン
  const btnDismissErr = $('#btn-dismiss-error');
  if (btnDismissErr) {
    btnDismissErr.addEventListener('click', () => {
      const banner = $('#progress-error-banner');
      if (banner) banner.style.display = 'none';
      $('#progress-section').hidden = true;
      $('#control-panel').scrollIntoView({ behavior: 'smooth' });
    });
  }
  const btnRetryErr = $('#btn-retry-error');
  if (btnRetryErr) {
    btnRetryErr.addEventListener('click', () => {
      const banner = $('#progress-error-banner');
      if (banner) banner.style.display = 'none';
      if (appState.lastParams) {
        startResearch(appState.lastParams);
      } else {
        form.requestSubmit();
      }
    });
  }

  // キーボードショートカット (実行中の Esc で中止)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appState.activeJobId) {
      e.preventDefault();
      cancelCurrentResearch();
    }
  });

  // 「新しいリサーチ」ボタン
  $('#btn-new').addEventListener('click', () => {
    $('#results-section').hidden = true;
    $('#control-panel').scrollIntoView({ behavior: 'smooth' });
    themeInput.focus();
  });
}

// ==========================================================================
// 実行中ステート管理 & 中止ハンドリング
// ==========================================================================
export function setRunningState(running) {
  const btnFormStop = $('#btn-form-stop');
  const btnStart = $('#btn-start');
  const btnTopbarCancel = $('#btn-topbar-cancel');
  const themeInput = $('#theme-input');

  if (running) {
    if (btnFormStop) btnFormStop.style.display = 'inline-flex';
    if (btnStart) btnStart.style.display = 'none';
    if (btnTopbarCancel) btnTopbarCancel.style.display = 'inline-flex';
    if (themeInput) themeInput.setAttribute('readonly', 'true');
  } else {
    if (btnFormStop) btnFormStop.style.display = 'none';
    if (btnStart) btnStart.style.display = 'inline-flex';
    if (btnTopbarCancel) btnTopbarCancel.style.display = 'none';
    if (themeInput) themeInput.removeAttribute('readonly');
  }
}

export async function cancelCurrentResearch() {
  if (!appState.activeJobId && !appState.timerInterval) return;
  const jobId = appState.activeJobId;
  handleAborted();
  if (jobId) {
    try {
      await api.cancelResearch(jobId);
    } catch (err) {
      console.warn('cancel error:', err);
    }
  }
}

export function handleAborted() {
  if (appState.isFinishing) return;
  appState.isFinishing = true;

  clearInterval(appState.timerInterval);
  appState.timerInterval = null;

  if (appState.activeUnsub) {
    try {
      appState.activeUnsub();
    } catch {}
    appState.activeUnsub = null;
  }
  appState.activeJobId = null;
  setRunningState(false);

  const progressSection = $('#progress-section');
  progressSection.classList.remove('is-done');
  progressSection.classList.add('is-error');

  const errorBanner = $('#progress-error-banner');
  if (errorBanner) errorBanner.style.display = 'none';

  const abortedBanner = $('#progress-aborted-banner');
  if (abortedBanner) abortedBanner.style.display = 'flex';
  hydrateIcons(abortedBanner);

  // ログに中止メッセージ
  const logList = $('#log');
  if (logList) {
    const li = document.createElement('li');
    li.className = 'k-warn';
    const time = new Date().toTimeString().slice(0, 8);
    li.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-icon">${icon('stop')}</span>
      <div class="log-msg">
        <strong style="color: var(--danger);">ユーザー操作により調査を中止しました</strong>
      </div>
    `;
    logList.appendChild(li);
    li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  toast('リサーチを中止しました', 'info');
}

// ==========================================================================
// リサーチ実行 & リアルタイム進捗管理
// ==========================================================================
export async function startResearch(params) {
  // 前回のサブスクリプションやタイマーがあれば強制クリーンアップ
  if (appState.activeUnsub) {
    try {
      appState.activeUnsub();
    } catch {}
    appState.activeUnsub = null;
  }
  clearInterval(appState.timerInterval);
  appState.timerInterval = null;

  appState.isFinishing = false;
  appState.lastParams = params;

  const progressSection = $('#progress-section');
  const resultsSection = $('#results-section');
  const logList = $('#log');
  const logCount = $('#log-count');
  const progressFill = $('#progress-fill');
  const progressPct = $('#progress-pct');
  const progressTheme = $('#progress-theme');
  const progressElapsed = $('#progress-elapsed');
  const stepperItems = $$('#stepper li');
  const abortedBanner = $('#progress-aborted-banner');
  const errorBanner = $('#progress-error-banner');

  // UI状態のリセット & 実行中ステート適用
  setRunningState(true);
  if (abortedBanner) abortedBanner.style.display = 'none';
  if (errorBanner) errorBanner.style.display = 'none';
  progressSection.hidden = false;
  resultsSection.hidden = true;
  progressSection.classList.remove('is-done', 'is-error');
  logList.innerHTML = '';
  logCount.textContent = '0';

  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  progressTheme.textContent = params.theme;
  stepperItems.forEach((li) => li.classList.remove('active', 'done'));
  stepperItems[0].classList.add('active');

  // スクロール
  progressSection.scrollIntoView({ behavior: 'smooth' });

  // タイマー開始
  clearInterval(appState.timerInterval);
  appState.startTime = Date.now();
  appState.timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - appState.startTime) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    progressElapsed.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }, 1000);

  // ジョブの開始
  try {
    const { jobId } = await api.startResearch(params);
    appState.activeJobId = jobId;

    let logCounter = 0;

    appState.activeUnsub = api.subscribe(jobId, {
      onEvent: (evt) => {
        if (evt.type === 'log') {
          logCounter++;
          logCount.textContent = logCounter;
          const li = document.createElement('li');
          li.className = `k-${evt.kind || 'info'}`;
          const time = new Date(evt.ts).toTimeString().slice(0, 8);
          li.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-icon">${icon(evt.kind === 'warn' ? 'alert' : evt.kind === 'error' ? 'alert' : evt.kind === 'done' ? 'check' : 'zap')}</span>
            <div class="log-msg">
              <div>${esc(evt.message)}</div>
              ${evt.detail ? `<span class="log-detail">${esc(evt.detail)}</span>` : ''}
            </div>
          `;
          logList.appendChild(li);
          li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else if (evt.type === 'progress') {
          const val = Math.min(100, Math.max(0, evt.value));
          progressFill.style.width = `${val}%`;
          progressPct.textContent = `${Math.round(val)}%`;

          // ステッパーの更新
          updateStepper(evt.stage);
        } else if (evt.type === 'result') {
          appState.currentResult = evt.data;
          finishSuccess(evt.data);
        } else if (evt.type === 'error') {
          if (evt.message && (evt.message.includes('キャンセル') || evt.message.includes('中止'))) {
            handleAborted();
          } else {
            finishError(evt.message);
          }
        }
      },
      onError: (err) => {
        finishError(err.message);
      },
    });
  } catch (err) {
    finishError(err.message);
  }
}

function updateStepper(stage) {
  const order = ['plan', 'search', 'analyze', 'synthesize', 'done'];
  const curIdx = order.indexOf(stage);
  if (curIdx < 0) return;

  const stepperItems = $$('#stepper li');
  stepperItems.forEach((li) => {
    const s = li.dataset.stage;
    const idx = order.indexOf(s);
    li.classList.remove('active', 'done');
    if (idx < curIdx) li.classList.add('done');
    else if (idx === curIdx) li.classList.add('active');
  });
}

export function finishSuccess(resultData) {
  if (appState.isFinishing) return;
  appState.isFinishing = true;

  clearInterval(appState.timerInterval);
  appState.timerInterval = null;

  if (appState.activeUnsub) {
    try {
      appState.activeUnsub();
    } catch {}
    appState.activeUnsub = null;
  }
  appState.activeJobId = null;
  setRunningState(false);

  const progressSection = $('#progress-section');
  const resultsSection = $('#results-section');

  progressSection.classList.add('is-done');
  updateStepper('done');

  // 結果描画
  renderReport(resultData, $('#report'));
  bindReportDeepDiveActions();

  // エクスポートバーの情報更新
  const tag = $('#result-mode-tag');
  tag.textContent = resultData.mode === 'live' ? 'LIVE' : 'DEMO';
  tag.className = `mode-tag ${resultData.mode === 'live' ? 'live' : ''}`;
  $('#result-title-mini').textContent = resultData.title;

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth' });

  toast('リサーチが完了しました！', 'success');
  loadRecentHistory();
}

function diagnoseError(msg = '') {
  const m = String(msg).toLowerCase();
  if (m.includes('切断') || m.includes('failed to fetch') || m.includes('network') || m.includes('econnrefused')) {
    return {
      title: 'サーバーとの接続が切断されました',
      cause: 'サーバー（Node.js / ResearchStudio.exe）が停止したか、黒い起動画面が閉じられた可能性があります。',
      action: 'start.bat または ResearchStudio.exe を再起動してから、もう一度お試しください。'
    };
  }
  if (m.includes('duckduckgo') || m.includes('anomaly') || m.includes('captcha') || m.includes('challenge')) {
    return {
      title: 'DuckDuckGo の一時的なアクセス制限',
      cause: '短時間に複数クエリを実行したため、DuckDuckGo の Bot 対策によって一時的に通信が制限されました。',
      action: '画面右上の「⚙️ 設定」から完全無料の「Tavily APIキー」を設定すると、制限なく高速・確実に検索できるようになります。'
    };
  }
  if (m.includes('gemini') || m.includes('api_key') || m.includes('quota') || m.includes('resourceexhausted') || m.includes('403')) {
    return {
      title: 'Google Gemini API のエラー',
      cause: 'APIキーが未設定・無効、または利用可能リクエスト数の上限に達した可能性があります。',
      action: 'Google AI Studio (aistudio.google.com) で無料のAPIキーを発行し、右上の「⚙️ 設定」で入力してください。'
    };
  }
  return {
    title: 'リサーチ処理中にエラーが発生しました',
    cause: msg || '通信またはAI処理中に予期せぬエラーが発生しました。',
    action: '少し時間をおいて再度実行するか、画面右上の「⚙️ 設定」から接続テストをお試しください。'
  };
}

export function finishError(msg) {
  if (appState.isFinishing) return;
  appState.isFinishing = true;

  clearInterval(appState.timerInterval);
  appState.timerInterval = null;

  if (appState.activeUnsub) {
    try {
      appState.activeUnsub();
    } catch {}
    appState.activeUnsub = null;
  }
  appState.activeJobId = null;
  setRunningState(false);

  const diag = diagnoseError(msg);

  const progressSection = $('#progress-section');
  progressSection.classList.remove('is-done');
  progressSection.classList.add('is-error');

  const abortedBanner = $('#progress-aborted-banner');
  if (abortedBanner) abortedBanner.style.display = 'none';

  const errorBanner = $('#progress-error-banner');

  const errorDesc = $('#progress-error-desc');
  if (errorBanner) {
    if (errorDesc) {
      errorDesc.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; margin-bottom: 6px; color: var(--danger-light);">${esc(diag.title)}</div>
        <div style="margin-bottom: 6px; color: var(--text-2); font-size: 13px;"><strong>【原因】</strong> ${esc(diag.cause)}</div>
        <div style="color: var(--accent-light); font-size: 13px; background: rgba(59, 130, 246, 0.08); padding: 8px 12px; border-radius: 6px; border-left: 3px solid var(--accent);">
          <strong>💡【解決方法】</strong> ${esc(diag.action)}
        </div>
      `;
    }
    errorBanner.style.display = 'flex';
    hydrateIcons(errorBanner);
  }

  // ログにエラーメッセージを記録
  const logList = $('#log');
  if (logList) {
    const li = document.createElement('li');
    li.className = 'k-error';
    const time = new Date().toTimeString().slice(0, 8);
    li.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-icon">${icon('alert')}</span>
      <div class="log-msg">
        <strong style="color: var(--danger);">${esc(diag.title)}: ${esc(msg || 'リサーチ処理中にエラーが発生しました')}</strong>
        <div style="font-size: 11px; color: var(--text-3); margin-top: 2px;">💡 対処法: ${esc(diag.action)}</div>
      </div>
    `;
    logList.appendChild(li);
    li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  toast(diag.title, 'error');
}

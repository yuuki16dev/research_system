// ==========================================================================
// Research Studio — アプリケーション コントローラー
// ==========================================================================

import { api } from './api.js';
import {
  $,
  $$,
  icon,
  hydrateIcons,
  initModals,
  openModal,
  closeModal,
  toast,
  copyText,
  downloadBlob,
  safeFilename,
  fmtDate,
  relTime,
  esc,
} from './ui.js';
import { renderReport } from './render.js';
import {
  buildClaudePrompt,
  buildMarkdown,
  exportExcel,
  exportPDF,
  buildPdfHtml,
  PROMPT_PRESETS,
  buildSlackSummary,
  buildSlideOutline,
  buildEmailDraft,
} from './exporters.js';

let appState = {
  settings: null,
  lanInfo: [],
  currentResult: null,
  activeJobId: null,
  activeUnsub: null,
  timerInterval: null,
  startTime: null,
};

// ==========================================================================
// 初期化
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  hydrateIcons();
  initModals();
  initTheme();
  bindFormControls();
  bindExportActions();
  bindPdfPreviewModal();
  bindCompareModal();
  bindPromptTemplateModal();
  bindDeepDiveDrawer();
  bindSettingsModal();
  bindUsageModal();
  bindMobileModal();
  bindHistoryDrawer();

  await refreshAppInfo();
  await loadRecentHistory();
});

// ==========================================================================
// テーマ切替 (Dark / Light)
// ==========================================================================
function initTheme() {
  const btn = $('#btn-theme');
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('rs-theme', next);
    } catch {}
    toast(next === 'light' ? '☀️ ライトモードに切り替えました' : '🌙 ダークモードに切り替えました', 'info', 2000);
  });
}

// ==========================================================================
// アプリステータス & 接続情報の取得
// ==========================================================================
async function refreshAppInfo() {
  try {
    const info = await api.info();
    appState.settings = info.settings;
    appState.lanInfo = info.lan || [];

    updateStatusPill(info.settings);
    updateModeHint(info.settings);

    const fMode = $('#footer-mode');
    if (fMode) {
      fMode.textContent = info.settings.effectiveMode === 'live' ? 'LIVE (Gemini API)' : 'DEMO (モックデータ)';
    }
  } catch (e) {
    const pill = $('#status-pill');
    pill.className = 'status-pill offline';
    $('#status-text').textContent = 'オフライン';
  }
}

function updateStatusPill(settings) {
  const pill = $('#status-pill');
  const txt = $('#status-text');
  if (settings.effectiveMode === 'live') {
    pill.className = 'status-pill live';
    txt.textContent = 'LIVE モード';
    pill.title = `Gemini (${settings.geminiModel}) 接続中`;
  } else {
    pill.className = 'status-pill demo';
    txt.textContent = 'DEMO モード';
    pill.title = 'APIキー未設定またはモック強制中';
  }
}

function updateModeHint(settings) {
  const hint = $('#mode-hint');
  if (!hint) return;
  if (settings.effectiveMode === 'live') {
    hint.className = 'mode-hint live';
    hint.innerHTML = `<span data-icon="sparkles"></span><span><strong>LIVEモード</strong>（${esc(settings.geminiModel)} + ${esc(settings.effectiveSearch)}）で実調査を実行します</span>`;
  } else {
    hint.className = 'mode-hint';
    hint.innerHTML = `<span data-icon="info"></span><span>現在は<strong>DEMOモード</strong>です。<a id="link-open-settings">APIキーを設定</a>すると本物のWeb調査が可能です</span>`;
    const a = $('#link-open-settings', hint);
    if (a) a.addEventListener('click', () => openModal('modal-settings'));
  }
  hydrateIcons(hint);
}

// ==========================================================================
// フォーム操作 & 入力バインド
// ==========================================================================
function bindFormControls() {
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
      $('#progress-section').hidden = true;
      $('#control-panel').scrollIntoView({ behavior: 'smooth' });
    });
  }
  const btnRetry = $('#btn-retry-progress');
  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      form.requestSubmit();
    });
  }

  // エラーバナーのアクションボタン
  const btnDismissErr = $('#btn-dismiss-error');
  if (btnDismissErr) {
    btnDismissErr.addEventListener('click', () => {
      $('#progress-section').hidden = true;
      $('#control-panel').scrollIntoView({ behavior: 'smooth' });
    });
  }
  const btnRetryErr = $('#btn-retry-error');
  if (btnRetryErr) {
    btnRetryErr.addEventListener('click', () => {
      form.requestSubmit();
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
function setRunningState(running) {
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

async function cancelCurrentResearch() {
  if (!appState.activeJobId) return;
  const jobId = appState.activeJobId;
  try {
    await api.cancelResearch(jobId);
    toast('リサーチを中止しました', 'info');
  } catch (err) {
    console.warn('cancel error:', err);
  }
  handleAborted();
}

function handleAborted() {
  clearInterval(appState.timerInterval);
  if (appState.activeUnsub) {
    appState.activeUnsub();
    appState.activeUnsub = null;
  }
  appState.activeJobId = null;
  setRunningState(false);

  const progressSection = $('#progress-section');
  progressSection.classList.remove('is-done');
  progressSection.classList.add('is-error');

  const abortedBanner = $('#progress-aborted-banner');
  if (abortedBanner) abortedBanner.style.display = 'flex';
  hydrateIcons(abortedBanner);

  // ログに中止メッセージ
  const logList = $('#log');
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

// ==========================================================================
// リサーチ実行 & リアルタイム進捗管理
// ==========================================================================
async function startResearch(params) {
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

function finishSuccess(resultData) {
  clearInterval(appState.timerInterval);
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

function finishError(msg) {
  clearInterval(appState.timerInterval);
  if (appState.activeUnsub) {
    appState.activeUnsub();
    appState.activeUnsub = null;
  }
  appState.activeJobId = null;
  setRunningState(false);

  const diag = diagnoseError(msg);

  const progressSection = $('#progress-section');
  progressSection.classList.remove('is-done');
  progressSection.classList.add('is-error');

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

// ==========================================================================
// エクスポート機能のバインド
// ==========================================================================
function bindExportActions() {
  // Claude用プロンプトのコピー
  $('#btn-copy-prompt').addEventListener('click', async () => {
    if (!appState.currentResult) return;
    const formatType = $('#prompt-type').value;
    const prompt = buildClaudePrompt(appState.currentResult, formatType);
    const ok = await copyText(prompt);
    if (ok) {
      toast('Claude用プロンプトをクリップボードにコピーしました！', 'success');
    } else {
      toast('コピーに失敗しました', 'error');
    }
  });

  // PDFプレビュー & 出力
  $('#btn-pdf').addEventListener('click', () => {
    if (!appState.currentResult) return;
    const pub = (appState.settings && appState.settings.publisher) || 'Research Studio';
    openPdfPreview(appState.currentResult, pub);
  });

  // Excel出力
  $('#btn-xlsx').addEventListener('click', () => {
    if (!appState.currentResult) return;
    exportExcel(appState.currentResult);
  });

  // Markdown出力
  $('#btn-md').addEventListener('click', async () => {
    if (!appState.currentResult) return;
    const md = buildMarkdown(appState.currentResult);
    const ok = await copyText(md);
    if (ok) {
      toast('Markdownをクリップボードにコピーしました', 'success');
    }
    // 同時にダウンロードも提供
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, `${safeFilename(appState.currentResult.title || appState.currentResult.theme)}.md`);
  });

  // 即戦力出力 1: Slack / Teams要約コピー
  const btnSlack = $('#btn-copy-slack');
  if (btnSlack) {
    btnSlack.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const text = buildSlackSummary(appState.currentResult);
      const ok = await copyText(text);
      if (ok) {
        toast('Slack / Teams要約をクリップボードにコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // 即戦力出力 2: スライド骨子 (Markdown / Marp) コピー
  const btnSlides = $('#btn-copy-slides');
  if (btnSlides) {
    btnSlides.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const text = buildSlideOutline(appState.currentResult);
      const ok = await copyText(text);
      if (ok) {
        toast('プレゼンスライド骨子（Markdown / Marp）をコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // 即戦力出力 3: 報告・稟議メール文面コピー
  const btnEmail = $('#btn-copy-email');
  if (btnEmail) {
    btnEmail.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const text = buildEmailDraft(appState.currentResult);
      const ok = await copyText(text);
      if (ok) {
        toast('報告・稟議メール文面をクリップボードにコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // レポート閲覧中の履歴ボタン
  const btnResultHist = $('#btn-result-history');
  if (btnResultHist) {
    btnResultHist.addEventListener('click', () => openHistoryDrawer());
  }
}

// ==========================================================================
// 商用レポートPDF プレビューモーダル
// ==========================================================================
let pdfPreviewZoom = 1.0;

function bindPdfPreviewModal() {
  const stageInner = $('#pdf-stage-inner');
  const zoomText = $('#zoom-level-text');

  function updateZoom(z) {
    pdfPreviewZoom = Math.max(0.4, Math.min(2.0, z));
    if (stageInner) {
      stageInner.style.transform = `scale(${pdfPreviewZoom})`;
    }
    if (zoomText) {
      zoomText.textContent = `${Math.round(pdfPreviewZoom * 100)}%`;
    }
  }

  const btnZoomIn = $('#btn-zoom-in');
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => updateZoom(pdfPreviewZoom + 0.15));
  }

  const btnZoomOut = $('#btn-zoom-out');
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => updateZoom(pdfPreviewZoom - 0.15));
  }

  const btnZoomFit = $('#btn-zoom-fit');
  if (btnZoomFit) {
    btnZoomFit.addEventListener('click', () => {
      const stage = $('#pdf-stage');
      if (stage) {
        const stageWidth = stage.clientWidth - 48;
        const fitScale = Math.min(1.0, Math.max(0.45, stageWidth / 820));
        updateZoom(fitScale);
      }
    });
  }

  const btnConfirm = $('#btn-pdf-print-confirm');
  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!appState.currentResult) return;
      const pub = (appState.settings && appState.settings.publisher) || 'Research Studio';
      exportPDF(appState.currentResult, pub);
    });
  }
}

function openPdfPreview(data, publisher) {
  const stageInner = $('#pdf-stage-inner');
  if (!stageInner) return;
  stageInner.innerHTML = buildPdfHtml(data, publisher);
  pdfPreviewZoom = 1.0;
  stageInner.style.transform = 'scale(1.0)';
  const zoomText = $('#zoom-level-text');
  if (zoomText) zoomText.textContent = '100%';

  openModal('modal-pdf-preview');

  setTimeout(() => {
    const stage = $('#pdf-stage');
    if (stage && stage.clientWidth < 860) {
      const fitScale = Math.min(1.0, Math.max(0.45, (stage.clientWidth - 32) / 820));
      stageInner.style.transform = `scale(${fitScale})`;
      if (zoomText) zoomText.textContent = `${Math.round(fitScale * 100)}%`;
    }
  }, 80);
}

// ==========================================================================
// レポート比較（A / B 分析）モーダル
// ==========================================================================
function bindCompareModal() {
  const btnCompare = $('#btn-compare');
  if (btnCompare) {
    btnCompare.addEventListener('click', async () => {
      await openCompareModal();
    });
  }

  const selA = $('#compare-sel-a');
  const selB = $('#compare-sel-b');
  if (selA && selB) {
    selA.addEventListener('change', () => updateComparisonView());
    selB.addEventListener('change', () => updateComparisonView());
  }

  const btnSwap = $('#btn-compare-swap');
  if (btnSwap) {
    btnSwap.addEventListener('click', () => {
      if (!selA || !selB) return;
      const tmp = selA.value;
      selA.value = selB.value;
      selB.value = tmp;
      updateComparisonView();
    });
  }
}

async function openCompareModal() {
  const selA = $('#compare-sel-a');
  const selB = $('#compare-sel-b');
  if (!selA || !selB) return;

  if (!historyState.items.length) {
    try {
      historyState.items = await api.history();
    } catch {}
  }

  const items = [...historyState.items];
  if (appState.currentResult && !items.some((x) => x.id === appState.currentResult.id)) {
    items.unshift({
      id: appState.currentResult.id,
      title: appState.currentResult.title || appState.currentResult.theme,
      createdAt: appState.currentResult.createdAt,
      periodLabel: appState.currentResult.periodLabel,
      mode: appState.currentResult.mode,
    });
  }

  if (items.length < 2) {
    toast('比較には過去のリサーチ履歴が最低2件必要です。別テーマのリサーチを実行してください。', 'info', 4000);
    return;
  }

  const optionsHtml = items
    .map((item) => {
      return `<option value="${item.id}">${esc(item.title || item.theme)} (${item.periodLabel || '期間未指定'} · ${fmtDate(item.createdAt, false)})</option>`;
    })
    .join('');

  selA.innerHTML = optionsHtml;
  selB.innerHTML = optionsHtml;

  if (appState.currentResult) {
    selA.value = appState.currentResult.id;
    selB.value = items.find((x) => x.id !== appState.currentResult.id)?.id || items[1]?.id || items[0].id;
  } else {
    selA.value = items[0].id;
    selB.value = items[1]?.id || items[0].id;
  }

  openModal('modal-compare');
  await updateComparisonView();
}

async function updateComparisonView() {
  const selA = $('#compare-sel-a');
  const selB = $('#compare-sel-b');
  const container = $('#compare-container');
  if (!selA || !selB || !container) return;

  const idA = selA.value;
  const idB = selB.value;

  container.innerHTML = `
    <div style="padding: 40px; text-align: center; color: var(--text-2);">
      <span class="pulse-orb" style="display: inline-block; margin-bottom: 12px;"></span>
      <p>両レポートの構造化データを取得・突合中…</p>
    </div>
  `;

  try {
    const [docA, docB] = await Promise.all([
      appState.currentResult && appState.currentResult.id === idA ? Promise.resolve(appState.currentResult) : api.historyItem(idA),
      appState.currentResult && appState.currentResult.id === idB ? Promise.resolve(appState.currentResult) : api.historyItem(idB),
    ]);

    renderComparisonGrid(docA, docB, container);
  } catch (err) {
    container.innerHTML = `<div class="notice"><span data-icon="alert"></span><span>比較データの読み込みに失敗しました: ${esc(err.message)}</span></div>`;
    hydrateIcons(container);
  }
}

function renderComparisonGrid(a, b, container) {
  const domainsA = new Set((a.sources || []).map((s) => s.domain));
  const domainsB = new Set((b.sources || []).map((s) => s.domain));
  const commonDomains = [...domainsA].filter((d) => domainsB.has(d));

  function formatParagraphs(text) {
    if (!text) return '<p>（記載なし）</p>';
    const clean = esc(text);
    const withCites = clean.replace(/\[(\d+)\]/g, '<span class="cite-num">[$1]</span>');
    const paragraphs = withCites.split(/\n+/).filter(Boolean);
    if (!paragraphs.length) return `<p>${withCites}</p>`;
    return paragraphs.map((p) => `<p>${p}</p>`).join('');
  }

  let html = `
    <div class="compare-grid">
      <!-- 列 A -->
      <div class="compare-col">
        <div class="compare-header-box col-a">
          <span class="badge badge-a">レポート A</span>
          <h3>${esc(a.title || a.theme)}</h3>
          <div class="compare-stat-row">
            <span>📅 ${fmtDate(a.createdAt)}</span>
            <span>⏱ ${esc(a.periodLabel || '直近1年')}</span>
            <span>🌐 ソース ${(a.sources || []).length}件</span>
            <span class="mode-tag ${a.mode === 'live' ? 'live' : ''}">${a.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
          </div>
        </div>

        <div class="compare-diff-card">
          <h4><span data-icon="file-text"></span>エグゼクティブサマリー</h4>
          <div class="compare-text-flow">${formatParagraphs(a.summary)}</div>
        </div>

        ${
          a.metrics && a.metrics.length
            ? `
          <div class="compare-diff-card">
            <h4><span data-icon="chart"></span>重要指標・数値</h4>
            <div style="display: grid; gap: 8px;">
              ${a.metrics
                .map(
                  (m) => `
                <div class="compare-metric-row">
                  <span style="color: var(--text-2); font-weight: 600;">${esc(m.label)}</span>
                  <strong style="color: var(--primary-light); font-size: 14.5px;">${esc(m.value)}</strong>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        ${
          a.insights && a.insights.length
            ? `
          <div class="compare-diff-card">
            <h4><span data-icon="bulb"></span>主要提言・示唆</h4>
            <ul style="padding-left: 18px; margin: 0; display: grid; gap: 10px;">
              ${a.insights.map((ins) => `<li><strong style="color: var(--text);">${esc(ins.title)}</strong>: <span style="color: var(--text-body);">${esc(ins.body)}</span></li>`).join('')}
            </ul>
          </div>
        `
            : ''
        }
      </div>

      <!-- 列 B -->
      <div class="compare-col">
        <div class="compare-header-box col-b">
          <span class="badge badge-b">レポート B</span>
          <h3>${esc(b.title || b.theme)}</h3>
          <div class="compare-stat-row">
            <span>📅 ${fmtDate(b.createdAt)}</span>
            <span>⏱ ${esc(b.periodLabel || '直近1年')}</span>
            <span>🌐 ソース ${(b.sources || []).length}件</span>
            <span class="mode-tag ${b.mode === 'live' ? 'live' : ''}">${b.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
          </div>
        </div>

        <div class="compare-diff-card">
          <h4><span data-icon="file-text"></span>エグゼクティブサマリー</h4>
          <div class="compare-text-flow">${formatParagraphs(b.summary)}</div>
        </div>

        ${
          b.metrics && b.metrics.length
            ? `
          <div class="compare-diff-card">
            <h4><span data-icon="chart"></span>重要指標・数値</h4>
            <div style="display: grid; gap: 8px;">
              ${b.metrics
                .map(
                  (m) => `
                <div class="compare-metric-row">
                  <span style="color: var(--text-2); font-weight: 600;">${esc(m.label)}</span>
                  <strong style="color: var(--accent-light); font-size: 14.5px;">${esc(m.value)}</strong>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
            : ''
        }

        ${
          b.insights && b.insights.length
            ? `
          <div class="compare-diff-card">
            <h4><span data-icon="bulb"></span>主要提言・示唆</h4>
            <ul style="padding-left: 18px; margin: 0; display: grid; gap: 10px;">
              ${b.insights.map((ins) => `<li><strong style="color: var(--text);">${esc(ins.title)}</strong>: <span style="color: var(--text-body);">${esc(ins.body)}</span></li>`).join('')}
            </ul>
          </div>
        `
            : ''
        }
      </div>
    </div>

    <!-- 共通ドメイン & 相違点の要約 -->
    <div class="compare-diff-card" style="margin-top: 20px;">
      <h4><span data-icon="layers"></span>ソースの重複・差分サマリー</h4>
      <div style="font-size: 14px; line-height: 1.7; color: var(--text-2);">
        ${
          commonDomains.length
            ? `
          <span>両レポート共通の参照ドメイン (<strong>${commonDomains.length}件</strong>): </span>
          <strong style="color: var(--text);">${esc(commonDomains.join(', '))}</strong>
        `
            : '両レポート間で重複している参照ドメインはありません（独立した異なる情報源に基づく分析）。'
        }
      </div>
    </div>
  `;

  container.innerHTML = html;
  hydrateIcons(container);
}

// ==========================================================================
// プロンプトテンプレート編集モーダル
// ==========================================================================
function bindPromptTemplateModal() {
  const btnOpen = $('#btn-edit-prompt-template');
  const selPreset = $('#preset-template-select');
  const textarea = $('#custom-template-text');
  const btnSave = $('#btn-save-prompt-template');
  const btnReset = $('#btn-reset-prompt-template');
  const placeholdersWrap = $('.template-placeholders');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      let custom = '';
      try {
        custom = localStorage.getItem('rs-prompt-template-custom');
      } catch {}
      if (!custom) custom = PROMPT_PRESETS.consultant;

      if (textarea) textarea.value = custom;
      if (selPreset) selPreset.value = 'custom';
      openModal('modal-prompt-templates');
    });
  }

  if (selPreset && textarea) {
    selPreset.addEventListener('change', () => {
      const val = selPreset.value;
      if (PROMPT_PRESETS[val]) {
        textarea.value = PROMPT_PRESETS[val];
      }
    });
  }

  if (btnSave && textarea) {
    btnSave.addEventListener('click', () => {
      const val = textarea.value.trim();
      if (!val) {
        toast('テンプレート本文を入力してください', 'warn');
        return;
      }
      try {
        localStorage.setItem('rs-prompt-template-custom', val);
      } catch {}

      const promptTypeSelect = $('#prompt-type');
      if (promptTypeSelect) promptTypeSelect.value = 'custom';

      closeModal('modal-prompt-templates');
      toast('カスタムテンプレートを保存し、選択をカスタムに切り替えました！', 'success');
    });
  }

  if (btnReset && textarea) {
    btnReset.addEventListener('click', () => {
      textarea.value = PROMPT_PRESETS.consultant;
      if (selPreset) selPreset.value = 'consultant';
      toast('初期テンプレート（戦略コンサルタント）に戻しました', 'info');
    });
  }

  if (placeholdersWrap && textarea) {
    placeholdersWrap.addEventListener('click', (e) => {
      const code = e.target.closest('code');
      if (!code) return;
      const tag = code.textContent.trim();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      textarea.value = text.slice(0, start) + tag + text.slice(end);
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
      toast(`${tag} を挿入しました`, 'info', 1000);
    });
  }
}

// ==========================================================================
// レポート深掘りアシスタント（ハイブリッド方式: スプリットビュー & 引用深掘り & レポート追加）
// ==========================================================================
const deepDiveState = {
  history: [], // [{ question, answer, keyPoints, sources, added: boolean }]
  currentQuote: '', // 現在引用中のテキスト
};

function bindDeepDiveDrawer() {
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

  function openDeepDive(asSplit = true) {
    if (!appState.currentResult) {
      toast('まずはリサーチを実行するか、履歴からレポートを選択してください', 'info');
      return;
    }
    if (themeMini) {
      themeMini.textContent = appState.currentResult.title || appState.currentResult.theme;
    }

    if (asSplit) {
      document.body.classList.add('has-deepdive-split');
      if (drawerEl) drawerEl.hidden = false;
      // スプリット時はスクロールを維持
      document.body.style.overflow = '';
    } else {
      openModal('drawer-deepdive');
    }

    if (input) setTimeout(() => input.focus(), 120);
  }

  function closeDeepDive() {
    document.body.classList.remove('has-deepdive-split');
    document.body.classList.remove('dd-expanded');
    if (drawerEl) drawerEl.hidden = true;
    clearQuote();
    hideSelectionTooltip();
  }

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
    btnOpen.addEventListener('click', () => openDeepDive(true));
  }

  // レポート内セクションの「深掘り」ボタンからの発火をリッスン
  document.addEventListener('open-deepdive-prompt', (e) => {
    const { heading, query } = e.detail || {};
    openDeepDive(true);
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

    // ツールチップ位置の計算
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      activeSelectedText = text;
      if (selectionTooltip) {
        const top = rect.top + window.scrollY;
        const left = rect.left + rect.width / 2 + window.scrollX;
        selectionTooltip.style.top = `${top}px`;
        selectionTooltip.style.left = `${left}px`;
        selectionTooltip.hidden = false;
        hydrateIcons(selectionTooltip);
      }
    } catch {
      hideSelectionTooltip();
    }
  }

  document.addEventListener('mouseup', () => {
    setTimeout(handleTextSelection, 30);
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
      openDeepDive(true);
      toast('選択した文章を引用しました。質問を入力してください', 'info', 2200);
    });
  }

  // =========================================================================
  // 深掘り質問の送信
  // =========================================================================
  async function submitDeepDiveQuery(question) {
    if (!appState.currentResult) return;
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
      const res = await api.deepDive({
        theme: appState.currentResult.theme,
        question,
        reportContext: appState.currentResult.summary || '',
        period: appState.currentResult.period || 'year',
        quote: sentQuote || '',
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
              <span data-icon="plus"></span>この回答をレポートに追加
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

      // レポートに追加ボタン
      const addBtn = aiMsgEl.querySelector(`[data-add-dd-idx="${entryIdx}"]`);
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          if (entry.added) return;
          entry.added = true;
          addBtn.classList.add('added');
          addBtn.innerHTML = `<span data-icon="check"></span>レポートに追加済み`;
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
      if (submitBtn) submitBtn.disabled = false;
      if (input) input.focus();
    }
  }

  bindReportDeepDiveActions();
}

/** レポート内の深掘り削除ボタンなどのバインド */
function bindReportDeepDiveActions() {
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

// ==========================================================================
// API設定モーダル
// ==========================================================================
function bindSettingsModal() {
  $('#btn-settings').addEventListener('click', async () => {
    await loadSettingsIntoForm();
    openModal('modal-settings');
  });

  // パスワード可視化トグル
  $$('[data-toggle-visibility]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.toggleVisibility;
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  });

  // キー削除ボタン
  $$('[data-clear-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const keyName = btn.dataset.clearKey;
      if (confirm('保存されているキーを削除しますか？')) {
        await api.saveSettings({ [keyName]: '' });
        toast('キーを削除しました', 'info');
        await refreshAppInfo();
        await loadSettingsIntoForm();
      }
    });
  });

  // 接続テスト
  $('#btn-test-api').addEventListener('click', async () => {
    const testBox = $('#test-result');
    testBox.hidden = false;
    testBox.innerHTML = `<div class="test-row"><span data-icon="sparkles"></span><span>接続テスト中…</span></div>`;
    hydrateIcons(testBox);

    const body = {
      geminiApiKey: $('#gemini-key').value.trim() || undefined,
      tavilyApiKey: $('#tavily-key').value.trim() || undefined,
      geminiModel: $('#gemini-model').value.trim() || undefined,
    };

    try {
      const res = await api.testSettings(body);
      let html = '';
      if (res.gemini) {
        html += `<div class="test-row ${res.gemini.ok ? 'ok' : 'ng'}">
          <span data-icon="${res.gemini.ok ? 'check' : 'alert'}"></span>
          <span><strong>Gemini:</strong> ${esc(res.gemini.message)}</span>
        </div>`;
      }
      if (res.tavily) {
        html += `<div class="test-row ${res.tavily.ok ? 'ok' : 'ng'}">
          <span data-icon="${res.tavily.ok ? 'check' : 'alert'}"></span>
          <span><strong>Tavily:</strong> ${esc(res.tavily.message)}</span>
        </div>`;
      }
      testBox.innerHTML = html;
      hydrateIcons(testBox);
    } catch (e) {
      testBox.innerHTML = `<div class="test-row ng"><span data-icon="alert"></span><span>エラー: ${esc(e.message)}</span></div>`;
      hydrateIcons(testBox);
    }
  });

  // 設定保存
  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {
      geminiModel: $('#gemini-model').value.trim(),
      searchProvider: $('#search-provider').value,
      mode: $('#mode-mock').checked ? 'mock' : 'auto',
      publisher: $('#publisher').value.trim(),
    };
    const gKey = $('#gemini-key').value.trim();
    const tKey = $('#tavily-key').value.trim();
    if (gKey) patch.geminiApiKey = gKey;
    if (tKey) patch.tavilyApiKey = tKey;

    try {
      await api.saveSettings(patch);
      toast('設定を保存しました', 'success');
      closeModal('modal-settings');
      await refreshAppInfo();
    } catch (err) {
      toast(`保存エラー: ${err.message}`, 'error');
    }
  });
}

async function loadSettingsIntoForm() {
  const s = await api.getSettings();
  $('#gemini-status').textContent = s.geminiApiKey.set ? `設定済 (${s.geminiApiKey.masked})` : '未設定';
  $('#gemini-status').className = `chip-status ${s.geminiApiKey.set ? 'set' : ''}`;
  $('#tavily-status').textContent = s.tavilyApiKey.set ? `設定済 (${s.tavilyApiKey.masked})` : '未設定';
  $('#tavily-status').className = `chip-status ${s.tavilyApiKey.set ? 'set' : ''}`;

  $('#gemini-key').value = '';
  $('#tavily-key').value = '';
  $('#gemini-model').value = s.geminiModel || 'gemini-3.8-flash';
  $('#search-provider').value = s.searchProvider || 'auto';
  $('#mode-mock').checked = s.mode === 'mock';
  $('#publisher').value = s.publisher || 'Research Studio';
  $('#test-result').hidden = true;
}

// ==========================================================================
// API利用状況 & クォータモーダル
// ==========================================================================
function bindUsageModal() {
  const btn = $('#btn-usage');
  if (btn) {
    btn.addEventListener('click', () => {
      openModal('modal-usage');
      refreshUsageModalContent();
    });
  }

  const pill = $('#status-pill');
  if (pill) {
    pill.style.cursor = 'pointer';
    pill.addEventListener('click', () => {
      openModal('modal-usage');
      refreshUsageModalContent();
    });
  }

  const btnFromSettings = $('#btn-open-usage-from-settings');
  if (btnFromSettings) {
    btnFromSettings.addEventListener('click', () => {
      closeModal('modal-settings');
      openModal('modal-usage');
      refreshUsageModalContent();
    });
  }

  const btnFromUsage = $('#btn-open-settings-from-usage');
  if (btnFromUsage) {
    btnFromUsage.addEventListener('click', () => {
      closeModal('modal-usage');
      openModal('modal-settings');
      loadSettingsIntoForm();
    });
  }

  const btnRefresh = $('#btn-refresh-usage');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      refreshUsageModalContent();
      toast('利用状況を最新に更新しました', 'info', 1500);
    });
  }
}

async function refreshUsageModalContent() {
  const body = $('#usage-body');
  if (!body) return;
  body.innerHTML = `
    <div style="padding: 32px; text-align: center; color: var(--text-2);">
      <span class="pulse-orb" style="display: inline-block; margin-bottom: 12px;"></span>
      <p>各サービスのAPI利用状況・クォータを取得中…</p>
    </div>
  `;

  try {
    const data = await api.usage();
    renderUsageDashboard(data, body);
  } catch (err) {
    body.innerHTML = `
      <div class="notice" style="margin: 20px 0;">
        <span data-icon="alert"></span>
        <div>
          <strong>利用状況の取得に失敗しました</strong>
          <p>${esc(err.message)}</p>
        </div>
      </div>
    `;
    hydrateIcons(body);
  }
}

let currentUsageViewMode = 'gauge';

function renderUsageDashboard(data, container) {
  const { gemini, tavily, duckduckgo, tips } = data;

  // Geminiの残量計算
  const geminiLimit = 1500; // 日次無料枠 (RPD)
  const geminiUsed = gemini.todayRequests || 0;
  const geminiRemain = Math.max(0, geminiLimit - geminiUsed);
  const geminiUsedPct = Math.min(100, ((geminiUsed / geminiLimit) * 100).toFixed(1));
  const geminiRemainPct = (100 - geminiUsedPct).toFixed(1);
  const geminiResearchesLeft = Math.floor(geminiRemain / 3); // 1リサーチ約3回AI呼出換算

  // Tavilyの残量計算
  const tavilyLimit = tavily.planLimit || 1000;
  const tavilyUsed = tavily.planUsage || 0;
  const tavilyRemain = Math.max(0, tavilyLimit - tavilyUsed);
  const tavilyUsedPct = Math.min(100, ((tavilyUsed / tavilyLimit) * 100).toFixed(1));
  const tavilyRemainPct = (100 - tavilyUsedPct).toFixed(1);
  const tavilyResearchesLeft = Math.floor(tavilyRemain / 3); // 1リサーチ約3クエリ検索換算

  const reset = gemini.resetInfo || {};
  const promptTok = gemini.totalPromptTokens || 0;
  const candTok = gemini.totalCandidatesTokens || 0;
  const totalTok = gemini.totalTokens || 0;

  let html = `
    <!-- 表示モード切替タブ -->
    <div class="view-mode-tabs" role="tablist">
      <button type="button" class="view-mode-tab ${currentUsageViewMode === 'gauge' ? 'active' : ''}" data-view="gauge">
        <span data-icon="chart"></span>残量メーター（あと何回リサーチできるか）
      </button>
      <button type="button" class="view-mode-tab ${currentUsageViewMode === 'detail' ? 'active' : ''}" data-view="detail">
        <span data-icon="list"></span>トークン詳細・履歴・API仕様
      </button>
    </div>
  `;

  if (currentUsageViewMode === 'gauge') {
    // =========================================================================
    // 【表示方法 1】残量メーター＆リサーチ可能回数重視（バッテリー/残高スタイル）
    // =========================================================================
    html += `
      <!-- 1. Gemini 残量メーターカード -->
      <div class="capacity-hero-card">
        <div class="capacity-top">
          <div class="cap-title">
            <span class="cap-service-icon">🤖</span>
            <div>
              <h4>Google Gemini API (本日の残り利用枠)</h4>
              <small style="color: var(--text-3);">${esc(gemini.model)} · 日次1,500回無料枠</small>
            </div>
          </div>
          <span class="cap-status-badge ${gemini.configured ? 'ok' : 'off'}">
            ${gemini.configured ? `🟢 残り ${geminiRemainPct}%` : '⚪ 未設定'}
          </span>
        </div>

        ${gemini.configured ? `
          <div class="capacity-main-stat">
            <div class="stat-highlight">
              <span class="stat-label">今日あと使える回数</span>
              <div class="stat-big-num">
                <strong class="remain-num success">${geminiRemain.toLocaleString()}</strong>
                <span class="denom">/ ${geminiLimit.toLocaleString()} 回</span>
              </div>
            </div>
            <div class="stat-conversion">
              <span class="conv-tag">💡 リサーチ実行目安</span>
              <div class="conv-val">
                あと約 <strong>${geminiResearchesLeft.toLocaleString()}</strong> 回
              </div>
              <small>※1リサーチあたり約3回AI呼出換算</small>
            </div>
          </div>

          <!-- 視覚的残量メーター -->
          <div class="capacity-meter-wrap">
            <div class="meter-bar-track">
              <div class="meter-bar-used" style="width: ${Math.max(1.5, geminiUsedPct)}%;"></div>
            </div>
            <div class="meter-legend">
              <span>本日利用: <strong>${geminiUsed.toLocaleString()} 回</strong> (${geminiUsedPct}%)</span>
              <span style="color: var(--success-light);">残り枠: <strong>${geminiRemain.toLocaleString()} 回</strong> (${geminiRemainPct}%)</span>
            </div>
          </div>

          <div class="capacity-reset-pill">
            <span data-icon="clock"></span>
            <span>次回リセット: <strong>${esc(reset.formattedTargetJST || '毎日 16:00 JST')}</strong>（${esc(reset.remainingText || '')}で1,500回全快）</span>
          </div>
        ` : `
          <div class="notice" style="margin: 12px 0;">
            <span data-icon="alert"></span>
            <div>
              <strong>Gemini APIキーが未設定です</strong>
              <p style="margin-top: 4px; font-size: 13px;">画面右上の「⚙️ 設定」アイコンから無料の API キーを入力してください。（※キー未設定時はデモデータで動作します）</p>
            </div>
          </div>
        `}

        <div class="usage-actions-row" style="margin-top: 6px;">
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.dashboard)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>AI Studio 公式ダッシュボードを開く ↗
          </a>
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.quotas)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>GCP クォータ制限 ↗
          </a>
        </div>
      </div>

      <!-- 2. Tavily 残量メーターカード -->
      <div class="capacity-hero-card">
        <div class="capacity-top">
          <div class="cap-title">
            <span class="cap-service-icon">🔍</span>
            <div>
              <h4>Tavily Search API (今月の残り検索枠)</h4>
              <small style="color: var(--text-3);">${esc(tavily.plan || 'Researcher')} プラン</small>
            </div>
          </div>
          <span class="cap-status-badge ${tavily.ok ? 'ok' : 'off'}">
            ${tavily.ok ? `🟢 残り ${tavilyRemainPct}%` : '⚪ 未設定 (DuckDuckGo使用中)'}
          </span>
        </div>

        ${tavily.ok ? `
          <div class="capacity-main-stat">
            <div class="stat-highlight">
              <span class="stat-label">今月あと使える検索枠</span>
              <div class="stat-big-num">
                <strong class="remain-num success">${tavilyRemain.toLocaleString()}</strong>
                <span class="denom">/ ${tavilyLimit.toLocaleString()} 件</span>
              </div>
            </div>
            <div class="stat-conversion">
              <span class="conv-tag">💡 リサーチ実行目安</span>
              <div class="conv-val">
                あと約 <strong>${tavilyResearchesLeft.toLocaleString()}</strong> 回
              </div>
              <small>※1リサーチあたり約3クエリ検索換算</small>
            </div>
          </div>

          <!-- 視覚的残量メーター -->
          <div class="capacity-meter-wrap">
            <div class="meter-bar-track">
              <div class="meter-bar-used" style="width: ${Math.max(1, tavilyUsedPct)}%;"></div>
            </div>
            <div class="meter-legend">
              <span>今月利用: <strong>${tavilyUsed.toLocaleString()} 件</strong> (${tavilyUsedPct}%)</span>
              <span style="color: var(--success-light);">残り枠: <strong>${tavilyRemain.toLocaleString()} 件</strong> (${tavilyRemainPct}%)</span>
            </div>
          </div>

          <div class="capacity-reset-pill">
            <span data-icon="clock"></span>
            <span>更新タイミング: <strong>${esc(tavily.renewalNotice || '毎月のアカウント更新日（月次リセット）')}</strong></span>
          </div>
        ` : `
          <div class="notice" style="margin: 12px 0;">
            <span data-icon="info"></span>
            <div>
              <strong>Tavily APIキーは未設定です（現在 DuckDuckGo を使用中）</strong>
              <p style="margin-top: 4px; font-size: 13px;">現在は完全無料の DuckDuckGo で検索を実行しています。月1,000回まで無料の Tavily API キーを設定すると、ディープ推論の安定性と検索精度がさらに向上します。</p>
            </div>
          </div>
        `}

        <div class="usage-actions-row" style="margin-top: 6px;">
          <a class="btn btn-sm btn-ghost" href="${esc(tavily.dashboardUrl || 'https://app.tavily.com/home')}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>Tavily公式ダッシュボードで残高を確認 ↗
          </a>
        </div>
      </div>

      <!-- 3. DuckDuckGo カード -->
      <div class="usage-card" style="background: var(--surface-recessed);">
        <div class="usage-card-head" style="margin-bottom: 6px;">
          <div class="uch-left">
            <span style="font-size: 20px;">🦆</span>
            <div>
              <h3>DuckDuckGo 検索（無料バックアップ）</h3>
              <small style="color: var(--text-3);">APIキー不要・完全無料</small>
            </div>
          </div>
          <span class="chip-status set">無制限</span>
        </div>
        <p style="font-size: 13px; color: var(--text-2); margin-top: 4px;">
          Tavilyの枠を温存したい場合は、DuckDuckGoを選択することで完全無料で無制限にWeb検索・巡回を実行できます。
        </p>
      </div>

      <!-- 4. API消費・検索頻度を抑えるTips -->
      <div class="usage-tips-card">
        <div class="usage-tips-head">
          <span data-icon="bulb"></span>
          <span>API消費・検索頻度を抑える3つのポイント</span>
        </div>
        <ul class="usage-tips-list">
          <li><strong>① 調査の深さを「クイック」にする:</strong> 検索クエリ数とAI解析トークンが約半減し、検索枠を最も節約できます。</li>
          <li><strong>② 調査対象で「特定サイト」を指定する:</strong> 巡回先を固定することで、不必要な複数サイトへのクエリ発行を防げます。</li>
          <li><strong>③ 検索プロバイダを「DuckDuckGo」に切り替える:</strong> Tavilyの月1,000件クレジットを消費ゼロに抑えて調査できます。</li>
        </ul>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <button type="button" class="btn btn-sm btn-ghost" id="btn-quick-switch-ddg" style="background: var(--surface); border: 1px solid var(--border-strong);">
            <span data-icon="refresh"></span>検索をDuckDuckGo（無料）に切り替える
          </button>
        </div>
      </div>
    `;
  } else {
    // =========================================================================
    // 【表示方法 2】トークン詳細・API仕様・実行履歴
    // =========================================================================
    html += `
      <!-- Gemini トークン詳細 -->
      <div class="usage-card">
        <div class="usage-card-head">
          <div class="uch-left">
            <span style="font-size: 20px;">🤖</span>
            <div>
              <h3>Google Gemini API トークン内訳</h3>
              <small style="color: var(--text-3);">${esc(gemini.model)}</small>
            </div>
          </div>
          <span class="chip-status ${gemini.configured ? 'set' : ''}">${gemini.configured ? '接続中' : '未設定'}</span>
        </div>

        <div class="usage-stats-grid">
          <div class="usage-stat-cell">
            <small>累計消費トークン</small>
            <strong style="color: var(--primary-light);">${totalTok.toLocaleString()}</strong>
          </div>
          <div class="usage-stat-cell">
            <small>入力 (Prompt)</small>
            <strong>${promptTok.toLocaleString()}</strong>
          </div>
          <div class="usage-stat-cell">
            <small>出力 (Candidate)</small>
            <strong>${candTok.toLocaleString()}</strong>
          </div>
          <div class="usage-stat-cell">
            <small>本日のリクエスト</small>
            <strong>${geminiUsed.toLocaleString()} 回</strong>
          </div>
        </div>

        <div class="usage-stats-grid" style="margin-top: 8px;">
          <div class="usage-stat-cell">
            <small>推定コスト（目安）</small>
            <strong>無料枠内: ¥0</strong>
            <span style="font-size: 11px; color: var(--text-3);">従量換算: 約 $${gemini.estimatedCostUsd} (約 ¥${gemini.estimatedCostJpy})</span>
          </div>
          <div class="usage-stat-cell">
            <small>日次クォータ (RPD)</small>
            <strong>1,500 回 / 日</strong>
            <span style="font-size: 11px; color: var(--text-3);">無料枠（Flash系）</span>
          </div>
          <div class="usage-stat-cell">
            <small>分間レート制限</small>
            <strong>15回 / 100万tok</strong>
            <span style="font-size: 11px; color: var(--text-3);">1分ごとに自動回復</span>
          </div>
        </div>

        <!-- 直近の呼出履歴 -->
        ${gemini.recentCalls && gemini.recentCalls.length ? `
          <div style="margin-top: 14px;">
            <small style="font-size: 12px; font-weight: 700; color: var(--text-2);">直近のAIリクエスト履歴 (最新${gemini.recentCalls.length}件):</small>
            <div class="usage-history-wrap">
              <table class="usage-history-table">
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>モデル</th>
                    <th>入力</th>
                    <th>出力</th>
                    <th>合計トークン</th>
                  </tr>
                </thead>
                <tbody>
                  ${gemini.recentCalls.map(c => `
                    <tr>
                      <td>${new Date(c.timestamp).toLocaleTimeString('ja-JP')}</td>
                      <td>${esc(c.model)}</td>
                      <td>${c.promptTokens.toLocaleString()}</td>
                      <td>${c.candidatesTokens.toLocaleString()}</td>
                      <td><strong>${c.totalTokens.toLocaleString()}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <div class="usage-actions-row">
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.dashboard)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>AI Studio プラン・利用状況 ↗
          </a>
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.quotas)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>GCP クォータ制限 ↗
          </a>
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.billing)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>GCP 請求ダッシュボード ↗
          </a>
        </div>
      </div>

      <!-- Tavily 仕様詳細 -->
      <div class="usage-card">
        <div class="usage-card-head">
          <div class="uch-left">
            <span style="font-size: 20px;">🔍</span>
            <div>
              <h3>Tavily Search API 仕様・利用内訳</h3>
              <small style="color: var(--text-3);">${esc(tavily.plan || 'Researcher')}</small>
            </div>
          </div>
          <span class="chip-status ${tavily.ok ? 'set' : ''}">${tavily.ok ? '接続中' : '未設定'}</span>
        </div>

        <div class="usage-stats-grid">
          <div class="usage-stat-cell">
            <small>月間上限枠</small>
            <strong>${tavilyLimit.toLocaleString()} 件</strong>
          </div>
          <div class="usage-stat-cell">
            <small>今月消費数</small>
            <strong>${tavilyUsed.toLocaleString()} 件</strong>
          </div>
          <div class="usage-stat-cell">
            <small>今月残り枠</small>
            <strong style="color: var(--success-light);">${tavilyRemain.toLocaleString()} 件</strong>
          </div>
          <div class="usage-stat-cell">
            <small>アプリ内検索数</small>
            <strong>${(tavily.localTotalSearches || 0).toLocaleString()} 回</strong>
          </div>
        </div>

        <div class="usage-actions-row">
          <a class="btn btn-sm btn-ghost" href="${esc(tavily.dashboardUrl || 'https://app.tavily.com/home')}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>Tavily公式ダッシュボードで残高を確認 ↗
          </a>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  hydrateIcons(container);

  // 表示モード切替タブのイベントバインド
  $$('.view-mode-tab', container).forEach(tab => {
    tab.addEventListener('click', () => {
      currentUsageViewMode = tab.dataset.view;
      renderUsageDashboard(data, container);
    });
  });

  // DuckDuckGoへのクイック切替ボタン
  const btnDdg = $('#btn-quick-switch-ddg', container);
  if (btnDdg) {
    btnDdg.addEventListener('click', async () => {
      try {
        await api.saveSettings({ searchProvider: 'duckduckgo' });
        toast('検索プロバイダを DuckDuckGo（完全無料）に設定しました', 'success');
        await refreshAppInfo();
        refreshUsageModalContent();
      } catch (e) {
        toast(`設定エラー: ${e.message}`, 'error');
      }
    });
  }
}

// ==========================================================================
// スマホで開く（QRコードモーダル）
// ==========================================================================
function bindMobileModal() {
  $('#btn-mobile').addEventListener('click', () => {
    updateMobileModalContent();
    openModal('modal-mobile');
  });

  $('#btn-copy-url').addEventListener('click', async () => {
    const url = $('#mobile-url').textContent;
    if (url && url !== '—') {
      const ok = await copyText(url);
      if (ok) toast('URLをコピーしました', 'success');
    }
  });
}

function updateMobileModalContent() {
  const lanList = appState.lanInfo;
  const qrImg = $('#qr-img');
  const urlCode = $('#mobile-url');
  const ipList = $('#ip-list');

  if (!lanList || !lanList.length) {
    urlCode.textContent = window.location.href;
    qrImg.src = api.qrUrl(window.location.href);
    ipList.innerHTML = '';
    return;
  }

  // 最初のLANアドレス（通常192.168.x.x）をデフォルト選択
  let selected = lanList[0];
  function selectLan(target) {
    selected = target;
    urlCode.textContent = target.url;
    qrImg.src = api.qrUrl(target.url);
    $$('button', ipList).forEach((b) => {
      b.className = b.dataset.ip === target.address ? 'active' : '';
    });
  }

  ipList.innerHTML = lanList
    .map((item) => `<button type="button" data-ip="${esc(item.address)}">${esc(item.name)}: ${esc(item.address)}</button>`)
    .join('');

  $$('button', ipList).forEach((btn) => {
    btn.addEventListener('click', () => {
      const match = lanList.find((x) => x.address === btn.dataset.ip);
      if (match) selectLan(match);
    });
  });

  selectLan(selected);
}

// ==========================================================================
// 履歴機能（ホームグリッド & ドロワー & 無制限スクロール/遡り）
// ==========================================================================

const historyState = {
  items: [],
  visibleCount: 6,
  step: 6,
  view: 'recent', // 'recent' | 'all'
  homeFilter: '',
  drawerFilter: '',
  drawerSort: 'desc', // 'desc' | 'asc'
};

function bindHistoryDrawer() {
  // ナビバー履歴ボタン
  const btnNav = $('#btn-history');
  if (btnNav) btnNav.addEventListener('click', () => openHistoryDrawer());

  // ホーム内の「サイドバーで開く」
  const btnDrawer = $('#btn-history-drawer-open');
  if (btnDrawer) btnDrawer.addEventListener('click', () => openHistoryDrawer());

  // ドロワー検索フィルター
  const drawerFilter = $('#history-filter');
  if (drawerFilter) {
    drawerFilter.addEventListener('input', (e) => {
      historyState.drawerFilter = e.target.value.trim().toLowerCase();
      renderHistoryDrawerList();
    });
  }

  // ドロワー並び順トグル (新しい順 / 古い順)
  const btnSort = $('#btn-history-sort');
  if (btnSort) {
    btnSort.addEventListener('click', () => {
      historyState.drawerSort = historyState.drawerSort === 'desc' ? 'asc' : 'desc';
      const label = $('#history-sort-label');
      if (label) label.textContent = historyState.drawerSort === 'desc' ? '新しい順' : '古い順（遡る）';
      renderHistoryDrawerList();
    });
  }

  // ホーム タブ切替 (最新6件 / すべての履歴を遡る)
  const tabRecent = $('#tab-recent-view');
  const tabAll = $('#tab-all-view');
  const searchBar = $('#home-history-search-bar');

  if (tabRecent && tabAll) {
    tabRecent.addEventListener('click', () => {
      historyState.view = 'recent';
      historyState.visibleCount = 6;
      tabRecent.classList.add('active');
      tabAll.classList.remove('active');
      if (searchBar) searchBar.style.display = 'none';
      renderHomeHistory();
    });

    tabAll.addEventListener('click', () => {
      historyState.view = 'all';
      tabAll.classList.add('active');
      tabRecent.classList.remove('active');
      if (searchBar) searchBar.style.display = 'block';
      const input = $('#home-history-filter');
      if (input) setTimeout(() => input.focus(), 50);
      renderHomeHistory();
    });
  }

  // ホーム 検索フィルター
  const homeFilter = $('#home-history-filter');
  const btnClearHomeFilter = $('#btn-clear-home-filter');
  if (homeFilter) {
    homeFilter.addEventListener('input', (e) => {
      historyState.homeFilter = e.target.value.trim().toLowerCase();
      if (btnClearHomeFilter) {
        btnClearHomeFilter.style.display = historyState.homeFilter ? 'inline-flex' : 'none';
      }
      renderHomeHistory();
    });
  }
  if (btnClearHomeFilter) {
    btnClearHomeFilter.addEventListener('click', () => {
      historyState.homeFilter = '';
      if (homeFilter) homeFilter.value = '';
      btnClearHomeFilter.style.display = 'none';
      renderHomeHistory();
    });
  }

  // ホーム 「過去の履歴をもっと遡る」ボタン
  const btnLoadMore = $('#btn-history-load-more');
  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
      historyState.visibleCount += historyState.step;
      renderHomeHistory();
    });
  }
}

async function openHistoryDrawer() {
  openModal('drawer-history');
  await renderHistoryDrawerList();
}

/** 日付グループキーの算出 */
function getHistoryGroupKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'その他';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const start7Days = startToday - 7 * 86400000;
  const t = d.getTime();

  if (t >= startToday) return '本日';
  if (t >= startYesterday) return '昨日';
  if (t >= start7Days) return '過去 7 日間';
  return 'それ以前';
}

/** ドロワー一覧のレンダリング */
async function renderHistoryDrawerList() {
  const listEl = $('#history-list');
  const countBadge = $('#drawer-history-count');
  if (!listEl) return;

  try {
    if (!historyState.items.length) {
      historyState.items = await api.history();
    }
    const all = historyState.items;
    if (countBadge) countBadge.textContent = `${all.length}件`;

    let filtered = all.filter((x) => {
      if (!historyState.drawerFilter) return true;
      const text = `${x.title || ''} ${x.theme || ''} ${x.scopeLabel || ''}`.toLowerCase();
      return text.includes(historyState.drawerFilter);
    });

    if (historyState.drawerSort === 'asc') {
      filtered = [...filtered].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    } else {
      filtered = [...filtered].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }

    if (!filtered.length) {
      listEl.innerHTML = `<li class="history-empty">${historyState.drawerFilter ? '一致するリサーチ履歴がありません' : 'リサーチ履歴がありません'}</li>`;
      return;
    }

    // グループ化してレンダリング
    let currentGroup = '';
    let html = '';

    filtered.forEach((item) => {
      const g = getHistoryGroupKey(item.createdAt);
      if (g !== currentGroup) {
        currentGroup = g;
        html += `<li class="history-group-title"><span>${esc(currentGroup)}</span></li>`;
      }
      html += `
      <li class="history-item" data-id="${item.id}" data-title="${esc(item.title || item.theme)}">
        <div class="hi-main">
          <strong>${esc(item.title || item.theme)}</strong>
          <div class="hi-meta">
            <span class="mode-tag ${item.mode === 'live' ? 'live' : ''}">${item.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
            <span>${esc(item.scopeLabel)}</span>
            ${item.periodLabel ? `<span>· ${esc(item.periodLabel)}</span>` : ''}
            <span>· ソース ${item.sourceCount}件</span>
            <span>· ${relTime(item.createdAt)}</span>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-icon btn-sm btn-delete-hi" data-delete-id="${item.id}" title="この履歴を削除" aria-label="削除">
          <span data-icon="trash"></span>
        </button>
      </li>`;
    });

    listEl.innerHTML = html;
    hydrateIcons(listEl);

    // 履歴クリックで読み込み
    $$('.history-item', listEl).forEach((li) => {
      li.addEventListener('click', async (e) => {
        if (e.target.closest('[data-delete-id]')) return;
        const id = li.dataset.id;
        await loadHistoryItem(id);
        closeModal('drawer-history');
      });
    });

    // 削除ボタン
    $$('[data-delete-id]', listEl).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        if (confirm('このリサーチ履歴を削除しますか？')) {
          await api.deleteHistory(id);
          toast('削除しました', 'info');
          historyState.items = historyState.items.filter((x) => x.id !== id);
          await renderHistoryDrawerList();
          renderHomeHistory();
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<li class="history-empty">履歴の読み込みに失敗しました: ${esc(err.message)}</li>`;
  }
}

async function loadHistoryItem(id) {
  try {
    const data = await api.historyItem(id);
    appState.currentResult = data;
    finishSuccess(data);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast(`履歴の読み込みエラー: ${err.message}`, 'error');
  }
}

/** ホーム画面の履歴カード一覧レンダリング */
function renderHomeHistory() {
  const container = $('#home-recent');
  const grid = $('#recent-grid');
  const totalBadge = $('#history-total-badge');
  const moreWrap = $('#history-more-wrap');
  const remainCount = $('#history-remaining-count');

  if (!container || !grid) return;

  const all = historyState.items;
  if (!all.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  if (totalBadge) totalBadge.textContent = `${all.length}件`;

  let filtered = all.filter((x) => {
    if (!historyState.homeFilter) return true;
    const text = `${x.title || ''} ${x.theme || ''} ${x.scopeLabel || ''}`.toLowerCase();
    return text.includes(historyState.homeFilter);
  });

  const isRecentView = historyState.view === 'recent';
  const displayItems = isRecentView ? filtered.slice(0, historyState.visibleCount) : filtered;
  const remaining = Math.max(0, filtered.length - displayItems.length);

  if (moreWrap) {
    if (isRecentView && remaining > 0) {
      moreWrap.style.display = 'flex';
      if (remainCount) remainCount.textContent = String(remaining);
    } else {
      moreWrap.style.display = 'none';
    }
  }

  if (!displayItems.length) {
    grid.innerHTML = `<div class="history-empty" style="grid-column: 1 / -1;">該当する過去のリサーチが見つかりませんでした</div>`;
    return;
  }

  grid.innerHTML = displayItems
    .map((item) => {
      return `
      <div class="recent-card glass" data-history-id="${item.id}">
        <div class="recent-card-head">
          <span class="mode-tag ${item.mode === 'live' ? 'live' : ''}">${item.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
          <span class="recent-meta"><span>${relTime(item.createdAt)}</span></span>
        </div>
        <strong>${esc(item.title || item.theme)}</strong>
        <div class="recent-meta">
          <span>${esc(item.scopeLabel)}</span>
          ${item.periodLabel ? `<span>·</span><span>${esc(item.periodLabel)}</span>` : ''}
          <span>·</span>
          <span>ソース ${item.sourceCount}件</span>
        </div>
        <div class="recent-card-foot">
          <span>${fmtDate(item.createdAt, false)}</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm btn-delete-hi" data-home-delete-id="${item.id}" title="削除" aria-label="削除">
            <span data-icon="trash"></span>
          </button>
        </div>
      </div>`;
    })
    .join('');

  hydrateIcons(grid);

  $$('.recent-card', grid).forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-home-delete-id]')) return;
      loadHistoryItem(card.dataset.historyId);
    });
  });

  $$('[data-home-delete-id]', grid).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.homeDeleteId;
      if (confirm('このリサーチ履歴を削除しますか？')) {
        await api.deleteHistory(id);
        toast('削除しました', 'info');
        historyState.items = historyState.items.filter((x) => x.id !== id);
        renderHomeHistory();
        renderHistoryDrawerList();
      }
    });
  });
}

async function loadRecentHistory() {
  try {
    historyState.items = await api.history();
    renderHomeHistory();
  } catch {
    const container = $('#home-recent');
    if (container) container.hidden = true;
  }
}

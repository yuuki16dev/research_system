// ==========================================================================
// モーダル制御群 (Settings, Mobile, Compare, Prompt Template Modals)
// ==========================================================================

import { $, $$, icon, hydrateIcons, openModal, closeModal, toast, esc, copyText, fmtDate } from '../ui.js';
import { api } from '../api.js';
import { PROMPT_PRESETS } from '../exporters.js';
import { appState } from './state.js';
import { refreshAppInfo } from './theme.js';
import { historyState } from './history.js';

export function bindCompareModal() {
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


export function bindPromptTemplateModal() {
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


export function bindSettingsModal() {
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

  // 診断・エラーログのプレビュー
  const btnViewLogs = $('#btn-view-logs');
  const logsPreview = $('#logs-preview');
  const logsTextarea = $('#logs-textarea');
  const logsPathLabel = $('#logs-path-label');
  const btnCopyLogs = $('#btn-copy-error-log');

  if (btnViewLogs && logsPreview) {
    btnViewLogs.addEventListener('click', async () => {
      const isVisible = logsPreview.style.display !== 'none';
      if (isVisible) {
        logsPreview.style.display = 'none';
        btnViewLogs.innerHTML = '<span data-icon="file-text"></span>ログを確認';
        hydrateIcons(btnViewLogs);
      } else {
        logsPreview.style.display = 'block';
        btnViewLogs.innerHTML = '<span data-icon="x"></span>ログを閉じる';
        hydrateIcons(btnViewLogs);
        if (logsTextarea) logsTextarea.value = 'ログを読み込み中…';
        try {
          const logData = await api.getLogs();
          if (logsPathLabel) logsPathLabel.textContent = logData.errorLogFile || 'data/logs/error.log';
          if (logsTextarea) {
            logsTextarea.value = logData.recentErrors || '（記録されているエラーはありません。正常に動作しています）';
            logsTextarea.scrollTop = logsTextarea.scrollHeight;
          }
        } catch (e) {
          if (logsTextarea) logsTextarea.value = `ログの取得に失敗しました: ${e.message}`;
        }
      }
    });
  }

  if (btnCopyLogs && logsTextarea) {
    btnCopyLogs.addEventListener('click', async () => {
      const text = logsTextarea.value;
      if (!text || text.includes('正常に動作しています')) {
        toast('コピーするエラーログはありません', 'info');
        return;
      }
      const ok = await copyText(text);
      if (ok) toast('エラーログをクリップボードにコピーしました！', 'success');
      else toast('コピーに失敗しました', 'error');
    });
  }
}

export async function loadSettingsIntoForm() {
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


export function bindMobileModal() {
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

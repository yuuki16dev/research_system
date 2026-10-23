// ==========================================================================
// レポート直接推敲・インライン編集モジュール (v1.5.0 Pro Quality Core)
// ==========================================================================

import { $, $$, toast } from '../ui.js';
import { appState } from './state.js';
import { api } from '../api.js';

let isEditMode = false;

export function getIsEditMode() {
  return isEditMode;
}

export function resetEditMode() {
  isEditMode = false;
  const btn = $('#btn-toggle-edit');
  const labelEl = $('#btn-toggle-edit-label');
  const reportEl = $('#report');
  if (btn) btn.classList.remove('active');
  if (labelEl) labelEl.textContent = '直接編集';
  if (reportEl) {
    reportEl.classList.remove('is-editable-mode');
    disableEditableElements(reportEl);
  }
}

export function bindReportEditor() {
  const btn = $('#btn-toggle-edit');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    isEditMode = !isEditMode;
    const reportEl = $('#report');
    const labelEl = $('#btn-toggle-edit-label');

    if (isEditMode) {
      btn.classList.add('active');
      if (labelEl) labelEl.textContent = '編集を保存';
      if (reportEl) reportEl.classList.add('is-editable-mode');
      enableEditableElements(reportEl);
      toast('✏️ 編集モードON: タイトルや文章をクリックして直接修正できます', 'info');
    } else {
      // 編集内容を収集して appState.currentResult に同期
      saveEditedReport(reportEl);
      btn.classList.remove('active');
      if (labelEl) labelEl.textContent = '直接編集';
      if (reportEl) reportEl.classList.remove('is-editable-mode');
      disableEditableElements(reportEl);

      // サーバー側の履歴にも永続保存
      if (appState.currentResult && appState.currentResult.id) {
        try {
          await api.updateHistory(appState.currentResult.id, appState.currentResult);
          toast('💾 編集内容を保存しました。PDFやExcel出力に完全反映されます！', 'success');
        } catch (err) {
          toast(`保存に失敗しました: ${err.message}`, 'error');
        }
      }
    }
  });
}

function enableEditableElements(root) {
  if (!root) return;
  const targets = $$(
    '#sec-hero h2, #sec-hero .subtitle, .btc-text, .sub-block-title, .metric-label, .metric-value, .metric-note, .keypoints li, .sec-h4, .sec-body p, .ins-item-text, #matrix-tbody td',
    root
  );
  targets.forEach((el) => {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
  });
}

function disableEditableElements(root) {
  if (!root) return;
  const targets = $$('[contenteditable="true"]', root);
  targets.forEach((el) => {
    el.removeAttribute('contenteditable');
  });
}

function saveEditedReport(root) {
  if (!root || !appState.currentResult) return;
  const r = appState.currentResult;

  // 1. タイトル
  const heroH2 = $('#sec-hero h2', root);
  if (heroH2) {
    const newTitle = heroH2.innerText.trim();
    if (newTitle) {
      r.title = newTitle;
      const mini = $('#result-title-mini');
      if (mini) mini.textContent = newTitle;
    }
  }

  // 2. サブタイトル
  const subEl = $('#sec-hero .subtitle', root);
  if (subEl) r.subtitle = subEl.innerText.trim();

  // 3. エグゼクティブ要約
  const summaryEl = $('.btc-text', root);
  if (summaryEl) r.summary = summaryEl.innerText.trim();

  // 4. セクション本文
  if (Array.isArray(r.sections)) {
    $$('.sec-card', root).forEach((secCard, idx) => {
      if (r.sections[idx]) {
        const titleEl = $('.sec-h4', secCard);
        if (titleEl) r.sections[idx].title = titleEl.innerText.trim();
        const bodyEl = $('.sec-body', secCard);
        if (bodyEl) r.sections[idx].content = bodyEl.innerText.trim();
      }
    });
  }

  // 5. キーポイント
  if (Array.isArray(r.keyPoints)) {
    const kps = $$('.keypoints li', root);
    kps.forEach((li, idx) => {
      if (r.keyPoints[idx] !== undefined) {
        r.keyPoints[idx] = li.innerText.trim();
      }
    });
  }

  // 6. 提言 (Insights)
  if (Array.isArray(r.insights)) {
    const items = $$('.ins-item-text', root);
    items.forEach((item, idx) => {
      if (r.insights[idx] !== undefined) {
        r.insights[idx] = item.innerText.trim();
      }
    });
  }

  // 7. 重要指標 (KPI)
  if (Array.isArray(r.metrics)) {
    const metricCards = $$('.metric-card', root);
    metricCards.forEach((card, idx) => {
      if (r.metrics[idx]) {
        const l = $('.metric-label', card);
        const v = $('.metric-value', card);
        const n = $('.metric-note', card);
        if (l) r.metrics[idx].label = l.innerText.trim();
        if (v) r.metrics[idx].value = v.innerText.trim();
        if (n) r.metrics[idx].note = n.innerText.trim();
      }
    });
  }

  // 8. 構造化比較マトリクス (Table)
  if (r.table && Array.isArray(r.table.rows)) {
    const trs = $$('#matrix-tbody tr', root);
    trs.forEach((tr, rIdx) => {
      if (r.table.rows[rIdx]) {
        const tds = $$('td', tr);
        tds.forEach((td, cIdx) => {
          if (r.table.rows[rIdx][cIdx] !== undefined) {
            r.table.rows[rIdx][cIdx] = td.innerText.trim();
          }
        });
      }
    });
  }
}

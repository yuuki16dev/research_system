// @ts-check
'use strict';

/**
 * Research Studio — 商用レポート・スタイルデザイナー ＆ ブランドテーマ (v1.19.0)
 * レポートのブランドカラー、アクセント、PDF/PowerPoint/Excelエクスポート配色をリアルタイム着せ替え
 */

import { $, $$, esc, toast, openModal, closeModal } from '../ui.js';
import { api } from '../api.js';
import { appState } from './state.js';
import { THEME_PRESETS, resolveTheme } from './theme-presets.js';

let activeTheme = resolveTheme('corporate-blue');

/**
 * レポート画面およびアプリにブランドテーマを適用
 * @param {Object|string} themeConfig
 * @param {boolean} [persistToReport=true]
 */
export function applyReportTheme(themeConfig, persistToReport = true) {
  const theme = resolveTheme(themeConfig);
  activeTheme = theme;

  // 1. data-report-theme 属性の切り替え
  document.documentElement.setAttribute('data-report-theme', theme.preset || 'corporate-blue');

  // 2. カスタムカラー用動的インラインスタイルの注入
  let styleEl = document.getElementById('rs-custom-theme-vars');
  if (theme.preset === 'custom' && theme.primary) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'rs-custom-theme-vars';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      [data-report-theme='custom'] {
        --primary: ${theme.primary} !important;
        --primary-hover: ${theme.primary} !important;
        --primary-light: ${theme.accent} !important;
        --primary-subtle: ${theme.primary}26 !important;
        --accent: ${theme.accent} !important;
        --accent-light: ${theme.accent} !important;
        --accent-subtle: ${theme.accent}26 !important;
        --grad-primary: ${theme.gradient} !important;
        --grad-text: linear-gradient(135deg, ${theme.primary} 0%, ${theme.accent} 100%) !important;
      }
    `;
  } else if (styleEl) {
    styleEl.remove();
  }

  // 3. 現在のレポートデータにテーマを保存
  if (persistToReport && appState.currentResult) {
    appState.currentResult.reportTheme = theme;
  }

  // 4. チャートが画面に存在する場合、再描画のトリガー
  updateChartThemesIfPresent(theme);
}

/**
 * 画面上のSVGチャートの色をテーマパレットに合わせて即座に再描画
 */
function updateChartThemesIfPresent(theme) {
  const chartWrap = document.querySelector('.chart-card svg');
  if (!chartWrap || !appState.currentResult || !appState.currentResult.chart) return;

  // charts.js を動的インポートまたはイベント経由で更新
  try {
    const chartSvgContainer = document.querySelector('.chart-card');
    if (chartSvgContainer && window.__rs_renderCurrentChart) {
      window.__rs_renderCurrentChart();
    }
  } catch {}
}

/**
 * テーマデザイナーモーダルを開く
 */
export function openThemeDesignerModal() {
  const current = appState.currentResult?.reportTheme || activeTheme;
  const currentPreset = current.preset || 'corporate-blue';

  const modal = $('#modal-theme-designer');
  if (!modal) return;

  // プリセット一覧を描画
  const grid = $('#theme-preset-grid');
  if (grid) {
    grid.innerHTML = Object.values(THEME_PRESETS)
      .map((tp) => {
        const isActive = tp.id === currentPreset;
        return `
          <div class="theme-card ${isActive ? 'is-active' : ''}" data-theme-id="${tp.id}">
            <div class="theme-card-head">
              <div class="theme-palette-dots">
                <span class="theme-dot" style="background: ${tp.primary};" title="Primary: ${tp.primary}"></span>
                <span class="theme-dot" style="background: ${tp.accent};" title="Accent: ${tp.accent}"></span>
                <span class="theme-dot" style="background: ${tp.dark};" title="Dark: ${tp.dark}"></span>
              </div>
              <span class="theme-check-icon">✔ 選択中</span>
            </div>
            <strong class="theme-card-title">${esc(tp.name)}</strong>
            <p class="theme-card-sub">${esc(tp.description)}</p>
          </div>
        `;
      })
      .join('');

    // カードクリック時のライブプレビュー
    grid.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        grid.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('is-active'));
        card.classList.add('is-active');
        const themeId = card.getAttribute('data-theme-id');
        if (themeId) {
          applyReportTheme(themeId, true);
          updatePreviewBanner();
        }
      });
    });
  }

  // カスタム入力欄の初期値設定
  const priInput = /** @type {HTMLInputElement} */ ($('#theme-custom-primary'));
  const priText = /** @type {HTMLInputElement} */ ($('#theme-custom-primary-text'));
  const accInput = /** @type {HTMLInputElement} */ ($('#theme-custom-accent'));
  const accText = /** @type {HTMLInputElement} */ ($('#theme-custom-accent-text'));

  const initialPri = current.primary || '#2563eb';
  const initialAcc = current.accent || '#06b6d4';

  if (priInput) priInput.value = initialPri;
  if (priText) priText.value = initialPri;
  if (accInput) accInput.value = initialAcc;
  if (accText) accText.value = initialAcc;

  const syncCustomColor = () => {
    const p = priInput?.value || '#2563eb';
    const a = accInput?.value || '#06b6d4';
    if (priText) priText.value = p;
    if (accText) accText.value = a;

    grid?.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('is-active'));
    applyReportTheme({ preset: 'custom', primary: p, accent: a }, true);
    updatePreviewBanner();
  };

  priInput?.addEventListener('input', syncCustomColor);
  accInput?.addEventListener('input', syncCustomColor);

  priText?.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(priText.value)) {
      if (priInput) priInput.value = priText.value;
      syncCustomColor();
    }
  });

  accText?.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(accText.value)) {
      if (accInput) accInput.value = accText.value;
      syncCustomColor();
    }
  });

  updatePreviewBanner();
  openModal('modal-theme-designer');
}

function updatePreviewBanner() {
  const banner = $('#theme-preview-banner');
  if (!banner) return;
  banner.style.background = activeTheme.gradient || `linear-gradient(135deg, ${activeTheme.primary} 0%, ${activeTheme.accent} 100%)`;
  const nameEl = $('#theme-preview-name');
  if (nameEl) nameEl.textContent = activeTheme.name;
}

/**
 * 初期化リスナー
 */
export function initThemeDesigner() {
  // エクスポートバーの着せ替えボタン
  const btn = $('#btn-open-theme-designer');
  if (btn) {
    btn.addEventListener('click', () => {
      openThemeDesignerModal();
    });
  }

  // モーダル内の「デフォルトとして保存」ボタン
  const btnSaveDefault = $('#btn-save-default-theme');
  if (btnSaveDefault) {
    btnSaveDefault.addEventListener('click', async () => {
      try {
        await api.saveSettings({
          themePreset: activeTheme.preset,
          themePrimaryColor: activeTheme.preset === 'custom' ? activeTheme.primary : '',
          themeAccentColor: activeTheme.preset === 'custom' ? activeTheme.accent : '',
        });
        toast('✅ デフォルトのブランドテーマとして保存しました', 'success');
        closeModal('modal-theme-designer');
      } catch (err) {
        toast(`保存に失敗しました: ${err.message}`, 'error');
      }
    });
  }

  // 「完了」ボタン
  const btnClose = $('#btn-close-theme-designer');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeModal('modal-theme-designer');
      toast(`🎨 「${activeTheme.name}」テーマを適用しました`, 'success', 2500);
    });
  }
}

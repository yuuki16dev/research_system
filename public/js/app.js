// ==========================================================================
// Research Studio — アプリケーション メインエントリーポイント (ES Modules)
// ==========================================================================

import { hydrateIcons, initModals } from './ui.js';
import { initTheme, refreshAppInfo } from './modules/theme.js';
import { bindFormControls, finishSuccess } from './modules/research.js';
import { bindExportActions, bindPdfPreviewModal } from './modules/export-handlers.js';
import {
  bindCompareModal,
  bindPromptTemplateModal,
  bindSettingsModal,
  bindMobileModal,
  bindApiGuideModal,
} from './modules/modals.js';
import { bindUsageModal } from './modules/usage-modal.js';
import { isResearchActive } from './modules/state.js';
import { bindDeepDiveDrawer, deepDiveState } from './modules/deep-dive.js';
import { bindHistoryDrawer, loadRecentHistory, openHistoryDrawer } from './modules/history.js';
import { bindShutdownHandlers, isAppShuttingDown } from './modules/shutdown.js';
import { bindReportEditor } from './modules/editor.js';
import { initChangelogModal, openChangelogModal } from './modules/changelog-modal.js';
import { initPresentationModal } from './modules/presentation-modal.js';
import { api } from './api.js';

// ==========================================================================
// 新バージョン更新確認
// ==========================================================================
async function checkVersionUpdate() {
  try {
    const banner = document.getElementById('version-update-banner');
    if (!banner) return;

    const info = await api.checkVersion();
    if (!info || !info.hasUpdate) return;

    const dismissed = sessionStorage.getItem('rs_dismissed_version');
    if (dismissed === info.latestVersion) return;

    const verEl = document.getElementById('vub-version-tag');
    const linkEl = document.getElementById('vub-link');
    const dismissBtn = document.getElementById('vub-dismiss');

    if (verEl) verEl.textContent = info.latestVersion;
    if (linkEl) {
      if (info.releaseUrl) linkEl.href = info.releaseUrl;
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        openChangelogModal();
      });
    }

    banner.hidden = false;

    if (dismissBtn) {
      dismissBtn.addEventListener(
        'click',
        () => {
          banner.hidden = true;
          sessionStorage.setItem('rs_dismissed_version', info.latestVersion);
        },
        { once: true }
      );
    }
  } catch {
    // オフライン環境やレートリミット時は静かに無視
  }
}

// ==========================================================================
// アプリケーション初期化
// ==========================================================================
async function initApp() {
  try {
    // 1. UI基盤 & テーマの初期化
    hydrateIcons();
    initModals();
    initTheme();

    // 2. 各機能モジュールのイベントバインド
    bindFormControls();
    bindReportEditor();
    bindExportActions(() => openHistoryDrawer());
    bindPdfPreviewModal();
    bindCompareModal();
    bindPromptTemplateModal();
    bindDeepDiveDrawer();
    bindSettingsModal();
    bindUsageModal();
    bindMobileModal();
    bindHistoryDrawer((data) => finishSuccess(data));
    bindShutdownHandlers();
    bindApiGuideModal();
    initChangelogModal();
    initPresentationModal();

    // 3. リサーチ実行中・深掘り実行中の誤終了ガード (beforeunload)
    window.addEventListener('beforeunload', (e) => {
      if (isAppShuttingDown()) return;
      if (isResearchActive() || deepDiveState.isQuerying) {
        e.preventDefault();
        e.returnValue = ''; // 各ブラウザの標準仕様に従い、離脱確認ダイアログを表示
        return '';
      }
    });

    // 4. アプリ初期情報の取得 & 直近履歴の読み込み & バージョン確認
    await refreshAppInfo();
    await loadRecentHistory();
    checkVersionUpdate(); // 非同期でバックグラウンド実行
  } catch (err) {
    console.error('[Research Studio] 初期化エラー:', err);
    const txt = document.getElementById('status-text');
    if (txt) txt.textContent = '初期化エラー';
    const pill = document.getElementById('status-pill');
    if (pill) pill.className = 'status-pill offline';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

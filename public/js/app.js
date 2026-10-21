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
} from './modules/modals.js';
import { bindUsageModal } from './modules/usage-modal.js';
import { isResearchActive } from './modules/state.js';
import { bindDeepDiveDrawer, deepDiveState } from './modules/deep-dive.js';
import { bindHistoryDrawer, loadRecentHistory, openHistoryDrawer } from './modules/history.js';
import { bindShutdownHandlers, isAppShuttingDown } from './modules/shutdown.js';

// ==========================================================================
// アプリケーション初期化
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. UI基盤 & テーマの初期化
  hydrateIcons();
  initModals();
  initTheme();

  // 2. 各機能モジュールのイベントバインド
  bindFormControls();
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

  // 3. リサーチ実行中・深掘り実行中の誤終了ガード (beforeunload)
  window.addEventListener('beforeunload', (e) => {
    if (isAppShuttingDown()) return;
    if (isResearchActive() || deepDiveState.isQuerying) {
      e.preventDefault();
      e.returnValue = ''; // 各ブラウザの標準仕様に従い、離脱確認ダイアログを表示
      return '';
    }
  });

  // 4. アプリ初期情報の取得 & 直近履歴の読み込み
  await refreshAppInfo();
  await loadRecentHistory();
});

// ==========================================================================
// 電源・シャットダウン & ライフサイクル管理モジュール
// ==========================================================================

import { $, openModal, closeModal, toast } from '../ui.js';
import { api } from '../api.js';
import { appState, isResearchActive } from './state.js';
import { deepDiveState } from './deep-dive.js';

let isShuttingDown = false;

/** 現在シャットダウン処理中か判定（beforeunload の重複発火を防止） */
export function isAppShuttingDown() {
  return isShuttingDown;
}

export function bindShutdownHandlers() {
  const btnPower = $('#btn-power-shutdown');
  const normalView = $('#shutdown-normal-view');
  const busyWarning = $('#shutdown-busy-warning');
  const btnConfirm = $('#btn-shutdown-confirm');
  const btnLabel = $('#shutdown-btn-label');
  const completedOverlay = $('#shutdown-completed-overlay');
  const btnCloseWindow = $('#btn-close-window');

  // 1. タブ・ウィンドウが閉じられる瞬間にサーバーへ離脱を通知 (負荷ゼロの sendBeacon)
  window.addEventListener('pagehide', () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/lifecycle/leave');
      } else {
        fetch('/api/lifecycle/leave', { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch {}
  });

  // 2. 電源ボタンのクリック（誤タップガード付き）
  if (btnPower) {
    btnPower.addEventListener('click', () => {
      const isBusy = isResearchActive() || deepDiveState.isQuerying;

      if (isBusy) {
        // 【誤タップガード】リサーチまたは深掘り実行中の場合
        if (normalView) normalView.hidden = true;
        if (busyWarning) busyWarning.hidden = false;
        if (btnLabel) btnLabel.textContent = 'リサーチを中断して終了';
        if (btnConfirm) {
          btnConfirm.classList.remove('btn-secondary');
          btnConfirm.classList.add('btn-danger');
        }
      } else {
        // 通常時（アイドル状態）
        if (normalView) normalView.hidden = false;
        if (busyWarning) busyWarning.hidden = true;
        if (btnLabel) btnLabel.textContent = '終了する';
        if (btnConfirm) {
          btnConfirm.classList.remove('btn-danger');
          btnConfirm.classList.add('btn-secondary');
        }
      }

      openModal('modal-shutdown');
    });
  }

  // 3. 終了確定アクション
  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      isShuttingDown = true;
      btnConfirm.disabled = true;
      if (btnLabel) btnLabel.textContent = '終了処理中…';

      try {
        // 実行中のリサーチジョブがあれば安全にキャンセル要求
        if (appState.activeJobId) {
          try {
            await api.cancelResearch(appState.activeJobId);
          } catch {}
        }

        // サーバー本体のシャットダウンを要求
        await api.shutdown();
      } catch (e) {
        console.warn('Shutdown request sent:', e);
      }

      // モーダルを閉じて終了完了オーバーレイを表示
      closeModal('modal-shutdown');
      if (completedOverlay) {
        completedOverlay.hidden = false;
      }
    });
  }

  // 4. 「このタブを閉じる」ボタン
  if (btnCloseWindow) {
    btnCloseWindow.addEventListener('click', () => {
      window.close();
      // もしスクリプトで開いたウィンドウでなく window.close() がブラウザにブロックされた場合
      toast('ブラウザのタブを閉じてください', 'info');
    });
  }
}

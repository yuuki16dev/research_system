// ==========================================================================
// アプリケーション共有ステート (State Management)
// ==========================================================================

export const appState = {
  settings: null,
  lanInfo: [],
  currentResult: null,
  activeJobId: null,
  activeUnsub: null,
  timerInterval: null,
  startTime: null,
  isFinishing: false,
  lastParams: null,
};

/** 現在アクティブなリサーチジョブがあるか判定 */
export function isResearchActive() {
  return !!appState.activeJobId && !appState.isFinishing;
}

/** タイマーを安全に停止 */
export function stopStateTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
}

/** アクティブな SSE 接続を安全に解除 */
export function closeActiveSubscription() {
  if (typeof appState.activeUnsub === 'function') {
    try {
      appState.activeUnsub();
    } catch {}
    appState.activeUnsub = null;
  }
}

/** リサーチ完了/中止時のステートリセット */
export function resetResearchState() {
  stopStateTimer();
  closeActiveSubscription();
  appState.activeJobId = null;
  appState.isFinishing = false;
}

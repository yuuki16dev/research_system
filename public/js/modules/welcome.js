// ==========================================================================
// Research Studio — 初回オンボーディング＆ウェルカムガイド (v2.11.0)
// ==========================================================================

import { $, openModal, closeModal, hydrateIcons } from '../ui.js';

const STORAGE_KEY = 'rs_welcome_seen';

export const SAMPLE_TOPICS = [
  '2026年 生成AIエージェントの企業導入動向とROI測定',
  '個人開発ツールのマネタイズ事例と価格設定モデル',
  '次世代フロントエンドフレームワークの性能・開発体験比較',
  '社内ナレッジ共有ツールの選定基準と失敗事例',
];

/**
 * サンプルテーマを入力欄に適用してモーダルを閉じる
 * @param {string} topic
 */
export function applySampleTopic(topic) {
  const themeInput = $('#theme-input');
  if (themeInput) {
    themeInput.value = topic;
    themeInput.focus();
    // input イベントを発火して高さを自動調整
    themeInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  markWelcomeAsSeen();
  closeModal('modal-welcome');
}

/**
 * 次回から表示しないフラグを保存
 */
export function markWelcomeAsSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch (e) {
    console.warn('[welcome] localStorage error:', e);
  }
}

/**
 * 初回アクセスかどうかを判定
 */
export function isFirstVisit() {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/**
 * ウェルカムモーダルを開く
 */
export function showWelcomeModal() {
  openModal('modal-welcome');
  const modal = $('#modal-welcome');
  if (modal) hydrateIcons(modal);
}

/**
 * オンボーディングの初期化とイベントバインド
 */
export function initWelcome() {
  const modal = $('#modal-welcome');
  if (!modal) return;

  // サンプルテーマボタンのクリックイベント
  const sampleBtns = modal.querySelectorAll('.btn-welcome-sample');
  sampleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const topic = btn.getAttribute('data-topic');
      if (topic) applySampleTopic(topic);
    });
  });

  // 「さっそく使ってみる」ボタン
  const btnStart = $('#btn-welcome-start');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      const chk = $('#chk-welcome-dont-show');
      if (chk && chk.checked) {
        markWelcomeAsSeen();
      }
      closeModal('modal-welcome');
      const themeInput = $('#theme-input');
      if (themeInput) themeInput.focus();
    });
  }

  // 「次回から表示しない」チェックボックス変更時
  const chkDontShow = $('#chk-welcome-dont-show');
  if (chkDontShow) {
    chkDontShow.addEventListener('change', (e) => {
      if (e.target.checked) markWelcomeAsSeen();
    });
  }

  // 初回訪問時の自動表示（わずかに遅延させて画面描画完了後に美しく表示）
  if (isFirstVisit()) {
    setTimeout(() => {
      // ユーザーがすでにリサーチ中などでない場合のみ表示
      const resultsSection = $('#results-section');
      const isResultsVisible = resultsSection && !resultsSection.hidden;
      if (!isResultsVisible) {
        showWelcomeModal();
      }
    }, 600);
  }
}


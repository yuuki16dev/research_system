// @ts-check
'use strict';

/**
 * Research Studio — スマートスクロール・ヘッダーマネージャー (v1.19.2)
 * スクロール時に画面上部の専有面積を約77%削減し、レポート閲覧領域を最大化
 */
export function initSmartHeader() {
  const topbar = document.querySelector('.topbar');
  const exportBar = document.getElementById('export-bar');
  const resultsSection = document.getElementById('results-section');
  const toggleBtn = document.getElementById('btn-toggle-bar-compact');
  const toggleIcon = document.getElementById('icon-toggle-bar');

  if (!topbar || !exportBar) return;

  let lastScrollY = window.scrollY;
  let ticking = false;
  let isManualExpanded = false;

  function update() {
    const currentScrollY = window.scrollY;
    const isResultsVisible = resultsSection && !resultsSection.hidden;

    // レポート結果が表示されており、ある程度スクロールしている時
    if (isResultsVisible && currentScrollY > 90) {
      const delta = currentScrollY - lastScrollY;

      // 下スクロール（コンテンツ読み進め時）: topbar を隠し、export-bar をウルトラスリム化
      if (delta > 5 && currentScrollY > 140) {
        document.body.classList.add('topbar-hidden');
        topbar.classList.add('is-scrolled-hidden');
        if (!isManualExpanded) {
          exportBar.classList.add('is-sticky-slim');
        }
      }
      // 上スクロール（ナビゲーション探知時）: topbar を再表示
      else if (delta < -10) {
        document.body.classList.remove('topbar-hidden');
        topbar.classList.remove('is-scrolled-hidden');
      }
    } else {
      // ページ上部では全要素を通常表示に戻す
      document.body.classList.remove('topbar-hidden');
      topbar.classList.remove('is-scrolled-hidden');
      if (!isManualExpanded) {
        exportBar.classList.remove('is-sticky-slim');
      }
    }

    lastScrollY = Math.max(0, currentScrollY);
    ticking = false;
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true }
  );

  // 手動トグルボタンのイベント
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isSlim = exportBar.classList.contains('is-sticky-slim');
      if (isSlim) {
        exportBar.classList.remove('is-sticky-slim');
        exportBar.classList.add('is-expanded');
        isManualExpanded = true;
        if (toggleIcon) toggleIcon.setAttribute('data-icon', 'chevron-up');
      } else {
        exportBar.classList.add('is-sticky-slim');
        exportBar.classList.remove('is-expanded');
        isManualExpanded = false;
        if (toggleIcon) toggleIcon.setAttribute('data-icon', 'chevron-down');
      }
    });
  }
}


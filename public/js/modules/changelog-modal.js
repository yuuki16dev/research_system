// ==========================================================================
// アップデート履歴 & リリースノート (CHANGELOG) モーダル
// ==========================================================================

import { api } from '../api.js';

let changelogCache = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(str) {
  const safe = escapeHtml(str);
  // **太字** を <strong> に変換
  return safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * リリース一覧をタイムラインカード形式でレンダリング
 */
function renderTimeline(releases, filterKeyword = '') {
  const container = document.getElementById('changelog-timeline');
  if (!container) return;

  const kw = filterKeyword.trim().toLowerCase();

  const filtered = releases.filter((rel) => {
    if (!kw) return true;
    if (rel.version.toLowerCase().includes(kw)) return true;
    if (rel.date.toLowerCase().includes(kw)) return true;
    return rel.categories.some((cat) => {
      if (cat.title.toLowerCase().includes(kw)) return true;
      return cat.items.some((item) => item.toLowerCase().includes(kw));
    });
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="changelog-empty">
        <span class="empty-icon">🔍</span>
        <p>「${escapeHtml(filterKeyword)}」に一致する更新履歴は見つかりませんでした。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((rel) => {
      const isCurrentBadge = rel.isCurrent
        ? '<span class="cl-badge cl-badge-current">現在ご利用中のバージョン</span>'
        : '';

      const categoriesHtml = rel.categories
        .map((cat) => {
          const itemsHtml = cat.items
            .map((item) => `<li>${formatInlineMarkdown(item)}</li>`)
            .join('');

          return `
            <div class="cl-category-block">
              <h4 class="cl-category-title">${formatInlineMarkdown(cat.title)}</h4>
              <ul class="cl-item-list">
                ${itemsHtml}
              </ul>
            </div>
          `;
        })
        .join('');

      return `
        <article class="cl-card ${rel.isCurrent ? 'cl-card-current' : ''}">
          <header class="cl-card-header">
            <div class="cl-card-ver-group">
              <span class="cl-version-pill">${escapeHtml(rel.version)}</span>
              ${isCurrentBadge}
            </div>
            <time class="cl-release-date" datetime="${escapeHtml(rel.date)}">
              📅 ${escapeHtml(rel.date || '—')}
            </time>
          </header>
          <div class="cl-card-body">
            ${categoriesHtml}
          </div>
        </article>
      `;
    })
    .join('');
}

/**
 * CHANGELOG データを読み込んで表示
 */
export async function openChangelogModal() {
  const modal = document.getElementById('modal-changelog');
  if (!modal) return;

  modal.hidden = false;
  modal.classList.add('is-open');

  const container = document.getElementById('changelog-timeline');
  const searchInput = document.getElementById('changelog-search-input');
  if (searchInput) searchInput.value = '';

  if (changelogCache) {
    renderTimeline(changelogCache.releases, '');
    return;
  }

  if (container) {
    container.innerHTML = `
      <div class="changelog-loading">
        <span class="spinner"></span>
        <p>更新履歴を読み込んでいます...</p>
      </div>
    `;
  }

  try {
    const data = await api.changelog();
    changelogCache = data;

    const countEl = document.getElementById('cl-total-count');
    if (countEl && data.totalReleases) {
      countEl.textContent = `全 ${data.totalReleases} バージョン`;
    }

    renderTimeline(data.releases, '');
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div class="changelog-error">
          <p>⚠️ 更新履歴の取得に失敗しました: ${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }
}

export function closeChangelogModal() {
  const modal = document.getElementById('modal-changelog');
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove('is-open');
}

/**
 * イベントリスナーの初期化
 */
export function initChangelogModal() {
  // トップバーボタン
  const topBtn = document.getElementById('btn-changelog');
  if (topBtn) {
    topBtn.addEventListener('click', () => openChangelogModal());
  }

  // フッターのバージョン表示クリック
  const footerVer = document.getElementById('footer-version');
  if (footerVer) {
    footerVer.style.cursor = 'pointer';
    footerVer.title = 'クリックでアップデート履歴（CHANGELOG）を表示';
    footerVer.addEventListener('click', () => openChangelogModal());
  }

  // 設定モーダルのバージョンバッジクリック
  const settingsBadge = document.getElementById('settings-version-badge');
  if (settingsBadge) {
    settingsBadge.style.cursor = 'pointer';
    settingsBadge.title = 'クリックでアップデート履歴を表示';
    settingsBadge.addEventListener('click', () => openChangelogModal());
  }

  // 設定モーダル内の「更新履歴を見る」ボタン
  const settingsChangelogBtn = document.getElementById('btn-settings-changelog');
  if (settingsChangelogBtn) {
    settingsChangelogBtn.addEventListener('click', () => {
      openChangelogModal();
    });
  }

  // ガイドモーダル内の「更新履歴」リンク
  const guideChangelogBtn = document.getElementById('guide-open-changelog');
  if (guideChangelogBtn) {
    guideChangelogBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openChangelogModal();
    });
  }

  // 検索インプットイベント
  const searchInput = document.getElementById('changelog-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      if (changelogCache && changelogCache.releases) {
        renderTimeline(changelogCache.releases, e.target.value);
      }
    });
  }

  // モーダル閉じるイベント
  const modal = document.getElementById('modal-changelog');
  if (modal) {
    modal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', () => closeChangelogModal());
    });
  }

  // Esc キーで閉じる
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.hidden) {
      closeChangelogModal();
    }
  });
}

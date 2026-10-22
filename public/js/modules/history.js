// ==========================================================================
// 履歴機能（ホームグリッド & ドロワー & 無制限スクロール/遡り）
// ==========================================================================

import { $, $$, icon, hydrateIcons, openModal, closeModal, toast, esc, fmtDate, relTime } from '../ui.js';
import { api } from '../api.js';
import { appState } from './state.js';

export const historyState = {
  items: [],
  visibleCount: 6,
  step: 6,
  view: 'recent', // 'recent' | 'all'
  homeFilter: '',
  drawerFilter: '',
  drawerSort: 'desc', // 'desc' | 'asc'
};

let onSelectHistoryCallback = null;

export function setOnSelectHistory(cb) {
  onSelectHistoryCallback = cb;
}

export function bindHistoryDrawer(onSelectHistory) {
  if (onSelectHistory) onSelectHistoryCallback = onSelectHistory;

  // ナビバー履歴ボタン
  const btnNav = $('#btn-history');
  if (btnNav) btnNav.addEventListener('click', () => openHistoryDrawer());

  // ホーム内の「サイドバーで開く」
  const btnDrawer = $('#btn-history-drawer-open');
  if (btnDrawer) btnDrawer.addEventListener('click', () => openHistoryDrawer());

  // ドロワー検索フィルター
  const drawerFilter = $('#history-filter');
  if (drawerFilter) {
    drawerFilter.addEventListener('input', (e) => {
      historyState.drawerFilter = e.target.value.trim().toLowerCase();
      renderHistoryDrawerList();
    });
  }

  // ドロワー並び順トグル (新しい順 / 古い順)
  const btnSort = $('#btn-history-sort');
  if (btnSort) {
    btnSort.addEventListener('click', () => {
      historyState.drawerSort = historyState.drawerSort === 'desc' ? 'asc' : 'desc';
      const label = $('#history-sort-label');
      if (label) label.textContent = historyState.drawerSort === 'desc' ? '新しい順' : '古い順（遡る）';
      renderHistoryDrawerList();
    });
  }

  // ホーム タブ切替 (最新6件 / すべての履歴を遡る)
  const tabRecent = $('#tab-recent-view');
  const tabAll = $('#tab-all-view');
  const searchBar = $('#home-history-search-bar');

  if (tabRecent && tabAll) {
    tabRecent.addEventListener('click', () => {
      historyState.view = 'recent';
      historyState.visibleCount = 6;
      tabRecent.classList.add('active');
      tabAll.classList.remove('active');
      if (searchBar) searchBar.style.display = 'none';
      renderHomeHistory();
    });

    tabAll.addEventListener('click', () => {
      historyState.view = 'all';
      tabAll.classList.add('active');
      tabRecent.classList.remove('active');
      if (searchBar) searchBar.style.display = 'block';
      const input = $('#home-history-filter');
      if (input) setTimeout(() => input.focus(), 50);
      renderHomeHistory();
    });
  }

  // ホーム 検索フィルター
  const homeFilter = $('#home-history-filter');
  const btnClearHomeFilter = $('#btn-clear-home-filter');
  if (homeFilter) {
    homeFilter.addEventListener('input', (e) => {
      historyState.homeFilter = e.target.value.trim().toLowerCase();
      if (btnClearHomeFilter) {
        btnClearHomeFilter.style.display = historyState.homeFilter ? 'inline-flex' : 'none';
      }
      renderHomeHistory();
    });
  }
  if (btnClearHomeFilter) {
    btnClearHomeFilter.addEventListener('click', () => {
      historyState.homeFilter = '';
      if (homeFilter) homeFilter.value = '';
      btnClearHomeFilter.style.display = 'none';
      renderHomeHistory();
    });
  }

  // ホーム 「過去の履歴をもっと遡る」ボタン
  const btnLoadMore = $('#btn-history-load-more');
  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
      historyState.visibleCount += historyState.step;
      renderHomeHistory();
    });
  }
}

export async function openHistoryDrawer() {
  openModal('drawer-history');
  await renderHistoryDrawerList();
}

/** 日付グループキーの算出 */
function getHistoryGroupKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'その他';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  const start7Days = startToday - 7 * 86400000;
  const t = d.getTime();

  if (t >= startToday) return '本日';
  if (t >= startYesterday) return '昨日';
  if (t >= start7Days) return '過去 7 日間';
  return 'それ以前';
}

/** ドロワー一覧のレンダリング */
export async function renderHistoryDrawerList() {
  const listEl = $('#history-list');
  const countBadge = $('#drawer-history-count');
  if (!listEl) return;

  try {
    if (!historyState.items.length) {
      historyState.items = await api.history();
    }
    const all = historyState.items;
    if (countBadge) countBadge.textContent = `${all.length}件`;

    let filtered = all.filter((x) => {
      if (!historyState.drawerFilter) return true;
      const text = `${x.title || ''} ${x.theme || ''} ${x.scopeLabel || ''}`.toLowerCase();
      return text.includes(historyState.drawerFilter);
    });

    // 並び替え: ピン留め（pinned）を常に最優先し、その中で作成日時順
    filtered = [...filtered].sort((a, b) => {
      const pinA = a.pinned ? 1 : 0;
      const pinB = b.pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA; // ピン留めが先頭
      return historyState.drawerSort === 'asc'
        ? String(a.createdAt).localeCompare(String(b.createdAt))
        : String(b.createdAt).localeCompare(String(a.createdAt));
    });

    if (!filtered.length) {
      listEl.innerHTML = `<li class="history-empty">${historyState.drawerFilter ? '一致するリサーチ履歴がありません' : 'リサーチ履歴がありません'}</li>`;
      return;
    }

    let currentGroup = '';
    let html = '';

    filtered.forEach((item) => {
      const g = item.pinned ? '⭐ ピン留めした履歴' : getHistoryGroupKey(item.createdAt);
      if (g !== currentGroup) {
        currentGroup = g;
        html += `<li class="history-group-title"><span>${esc(currentGroup)}</span></li>`;
      }
      html += `
      <li class="history-item ${item.pinned ? 'is-pinned' : ''}" data-id="${item.id}" data-title="${esc(item.title || item.theme)}">
        <div class="hi-main">
          <div class="hi-title-row">
            ${item.pinned ? '<span class="pin-badge" title="ピン留め済み">⭐</span>' : ''}
            <strong>${esc(item.title || item.theme)}</strong>
          </div>
          <div class="hi-meta">
            <span class="mode-tag ${item.mode === 'live' ? 'live' : ''}">${item.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
            <span>${esc(item.scopeLabel)}</span>
            ${item.periodLabel ? `<span>· ${esc(item.periodLabel)}</span>` : ''}
            <span>· ソース ${item.sourceCount}件</span>
            <span>· ${relTime(item.createdAt)}</span>
          </div>
        </div>
        <div class="hi-actions">
          <button type="button" class="btn btn-ghost btn-icon btn-sm btn-pin-hi ${item.pinned ? 'active' : ''}" data-pin-id="${item.id}" title="${item.pinned ? 'ピン留め解除' : '上部にピン留め'}" aria-label="ピン留め">
            <span data-icon="star"></span>
          </button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm btn-delete-hi" data-delete-id="${item.id}" title="この履歴を削除" aria-label="削除">
            <span data-icon="trash"></span>
          </button>
        </div>
      </li>`;
    });

    listEl.innerHTML = html;
    hydrateIcons(listEl);

    // 履歴クリックで読み込み
    $$('.history-item', listEl).forEach((li) => {
      li.addEventListener('click', async (e) => {
        if (e.target.closest('[data-delete-id]') || e.target.closest('[data-pin-id]')) return;
        const id = li.dataset.id;
        await loadHistoryItem(id);
        closeModal('drawer-history');
      });
    });

    // ピン留めボタン
    $$('[data-pin-id]', listEl).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.pinId;
        try {
          const res = await api.pinHistory(id);
          const item = historyState.items.find((x) => x.id === id);
          if (item) item.pinned = res.pinned;
          toast(res.pinned ? 'ピン留めしました' : 'ピン留めを解除しました', 'info');
          await renderHistoryDrawerList();
          renderHomeHistory();
        } catch (err) {
          toast(`ピン留め失敗: ${err.message}`, 'error');
        }
      });
    });

    // 削除ボタン
    $$('[data-delete-id]', listEl).forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        if (confirm('このリサーチ履歴を削除しますか？')) {
          await api.deleteHistory(id);
          toast('削除しました', 'info');
          historyState.items = historyState.items.filter((x) => x.id !== id);
          await renderHistoryDrawerList();
          renderHomeHistory();
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<li class="history-empty">履歴の読み込みに失敗しました: ${esc(err.message)}</li>`;
  }
}

export async function loadHistoryItem(id) {
  try {
    const data = await api.historyItem(id);
    appState.currentResult = data;
    if (typeof onSelectHistoryCallback === 'function') {
      onSelectHistoryCallback(data);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    toast(`履歴の読み込みエラー: ${err.message}`, 'error');
  }
}

/** ホーム画面の履歴カード一覧レンダリング */
export function renderHomeHistory() {
  const container = $('#home-recent');
  const grid = $('#recent-grid');
  const totalBadge = $('#history-total-badge');
  const moreWrap = $('#history-more-wrap');
  const remainCount = $('#history-remaining-count');

  if (!container || !grid) return;

  const all = historyState.items;
  if (!all.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  if (totalBadge) totalBadge.textContent = `${all.length}件`;

  let filtered = all.filter((x) => {
    if (!historyState.homeFilter) return true;
    const text = `${x.title || ''} ${x.theme || ''} ${x.scopeLabel || ''}`.toLowerCase();
    return text.includes(historyState.homeFilter);
  });

  // ピン留め（pinned）を最優先にして並び替え
  filtered = [...filtered].sort((a, b) => {
    const pinA = a.pinned ? 1 : 0;
    const pinB = b.pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  const isRecentView = historyState.view === 'recent';
  const displayItems = isRecentView ? filtered.slice(0, historyState.visibleCount) : filtered;
  const remaining = Math.max(0, filtered.length - displayItems.length);

  if (moreWrap) {
    if (isRecentView && remaining > 0) {
      moreWrap.style.display = 'flex';
      if (remainCount) remainCount.textContent = String(remaining);
    } else {
      moreWrap.style.display = 'none';
    }
  }

  if (!displayItems.length) {
    grid.innerHTML = `<div class="history-empty" style="grid-column: 1 / -1;">該当する過去のリサーチが見つかりませんでした</div>`;
    return;
  }

  grid.innerHTML = displayItems
    .map((item) => {
      return `
      <div class="recent-card glass ${item.pinned ? 'is-pinned' : ''}" data-history-id="${item.id}">
        <div class="recent-card-head">
          <div class="recent-head-left">
            <span class="mode-tag ${item.mode === 'live' ? 'live' : ''}">${item.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
            ${item.pinned ? '<span class="pin-badge" title="ピン留め済み">⭐ ピン留め</span>' : ''}
          </div>
          <div class="recent-head-right">
            <button type="button" class="btn btn-ghost btn-icon btn-sm btn-pin-hi ${item.pinned ? 'active' : ''}" data-home-pin-id="${item.id}" title="${item.pinned ? 'ピン留め解除' : 'ピン留め'}" aria-label="ピン留め">
              <span data-icon="star"></span>
            </button>
            <span class="recent-meta"><span>${relTime(item.createdAt)}</span></span>
          </div>
        </div>
        <strong>${esc(item.title || item.theme)}</strong>
        <div class="recent-meta">
          <span>${esc(item.scopeLabel)}</span>
          ${item.periodLabel ? `<span>·</span><span>${esc(item.periodLabel)}</span>` : ''}
          <span>·</span>
          <span>ソース ${item.sourceCount}件</span>
        </div>
        <div class="recent-card-foot">
          <span>${fmtDate(item.createdAt, false)}</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm btn-delete-hi" data-home-delete-id="${item.id}" title="削除" aria-label="削除">
            <span data-icon="trash"></span>
          </button>
        </div>
      </div>`;
    })
    .join('');

  hydrateIcons(grid);

  $$('.recent-card', grid).forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-home-delete-id]') || e.target.closest('[data-home-pin-id]')) return;
      loadHistoryItem(card.dataset.historyId);
    });
  });

  $$('[data-home-pin-id]', grid).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.homePinId;
      try {
        const res = await api.pinHistory(id);
        const item = historyState.items.find((x) => x.id === id);
        if (item) item.pinned = res.pinned;
        toast(res.pinned ? 'ピン留めしました' : 'ピン留めを解除しました', 'info');
        renderHomeHistory();
        renderHistoryDrawerList();
      } catch (err) {
        toast(`ピン留め失敗: ${err.message}`, 'error');
      }
    });
  });

  $$('[data-home-delete-id]', grid).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.homeDeleteId;
      if (confirm('このリサーチ履歴を削除しますか？')) {
        await api.deleteHistory(id);
        toast('削除しました', 'info');
        historyState.items = historyState.items.filter((x) => x.id !== id);
        renderHomeHistory();
        renderHistoryDrawerList();
      }
    });
  });
}

export async function loadRecentHistory() {
  try {
    historyState.items = await api.history();
    renderHomeHistory();
  } catch {
    const container = $('#home-recent');
    if (container) container.hidden = true;
  }
}

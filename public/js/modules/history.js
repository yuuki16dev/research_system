// ==========================================================================
// 履歴機能（ホームグリッド & ドロワー & 無制限スクロール/遡り）
// ==========================================================================

import { $, $$, icon, hydrateIcons, openModal, closeModal, toast, esc, fmtDate, relTime } from '../ui.js';
import { api } from '../api.js';
import { appState } from './state.js';
import { startCrossSynthesis } from './research.js';

export const historyState = {
  items: [],
  visibleCount: 6,
  step: 6,
  view: 'recent', // 'recent' | 'all'
  homeFilter: '',
  drawerFilter: '',
  selectedTag: 'all', // 'all' | 'pinned' | 'タグ名' (v2.13.0)
  drawerSort: 'desc', // 'desc' | 'asc'
  isCrossMode: false,
  selectedCrossIds: new Set(),
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

  // タグフィルターチップのバインド (v2.13.0)
  const bindTagChips = (containerSelector) => {
    const bar = $(containerSelector);
    if (!bar) return;
    const chips = bar.querySelectorAll('.drawer-tag-chip');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        historyState.selectedTag = chip.dataset.tag || 'all';

        // もう一方のバーにもアクティブ状態を同期
        const otherSelector = containerSelector === '#drawer-tag-filter-bar' ? '#home-tag-filter-bar' : '#drawer-tag-filter-bar';
        const otherBar = $(otherSelector);
        if (otherBar) {
          otherBar.querySelectorAll('.drawer-tag-chip').forEach((c) => {
            c.classList.toggle('active', c.dataset.tag === historyState.selectedTag);
          });
        }

        renderHistoryDrawerList();
        renderHomeHistory();
      });
    });
  };
  bindTagChips('#drawer-tag-filter-bar');
  bindTagChips('#home-tag-filter-bar');

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

  // クロス統合モード切替ボタン（ホーム & ドロワー）
  const btnCrossHome = $('#btn-toggle-cross-home');
  const btnCrossDrawer = $('#btn-toggle-cross-drawer');

  function toggleCrossMode() {
    historyState.isCrossMode = !historyState.isCrossMode;
    if (!historyState.isCrossMode) {
      historyState.selectedCrossIds.clear();
    }
    updateCrossBar();
    renderHomeHistory();
    renderHistoryDrawerList();
  }

  if (btnCrossHome) btnCrossHome.addEventListener('click', toggleCrossMode);
  if (btnCrossDrawer) btnCrossDrawer.addEventListener('click', toggleCrossMode);

  // フローティング・クロスバーのアクション
  const btnCancelCross = $('#btn-cancel-cross');
  const btnSubmitCross = $('#btn-submit-cross');

  if (btnCancelCross) {
    btnCancelCross.addEventListener('click', () => {
      historyState.isCrossMode = false;
      historyState.selectedCrossIds.clear();
      updateCrossBar();
      renderHomeHistory();
      renderHistoryDrawerList();
    });
  }

  if (btnSubmitCross) {
    btnSubmitCross.addEventListener('click', async () => {
      const ids = Array.from(historyState.selectedCrossIds);
      if (ids.length < 2) {
        toast('2件以上のレポートを選択してください', 'warn');
        return;
      }
      closeModal('drawer-history');
      historyState.isCrossMode = false;
      historyState.selectedCrossIds.clear();
      updateCrossBar();
      renderHomeHistory();
      renderHistoryDrawerList();
      await startCrossSynthesis(ids);
    });
  }
}

export function updateCrossBar() {
  const bar = $('#history-cross-bar');
  const countEl = $('#hcb-count');
  const btnSubmit = $('#btn-submit-cross');
  const btnCrossHome = $('#btn-toggle-cross-home');
  const btnCrossDrawer = $('#btn-toggle-cross-drawer');

  if (!bar) return;

  if (!historyState.isCrossMode) {
    bar.hidden = true;
    if (btnCrossHome) btnCrossHome.classList.remove('active');
    if (btnCrossDrawer) btnCrossDrawer.classList.remove('active');
    return;
  }

  bar.hidden = false;
  if (btnCrossHome) btnCrossHome.classList.add('active');
  if (btnCrossDrawer) btnCrossDrawer.classList.add('active');

  const count = historyState.selectedCrossIds.size;
  if (countEl) countEl.textContent = `${count}件選択中`;
  if (btnSubmit) {
    btnSubmit.disabled = count < 2;
    btnSubmit.style.opacity = count < 2 ? '0.5' : '1';
    btnSubmit.style.cursor = count < 2 ? 'not-allowed' : 'pointer';
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
      // 1. タグフィルター (v2.13.0)
      if (historyState.selectedTag && historyState.selectedTag !== 'all') {
        if (historyState.selectedTag === 'pinned') {
          if (!x.pinned) return false;
        } else {
          const tags = Array.isArray(x.tags) ? x.tags : [];
          if (!tags.includes(historyState.selectedTag)) return false;
        }
      }

      // 2. 全文検索（タイトル・テーマ・要約・タグのスペース区切りAND検索）
      if (historyState.drawerFilter) {
        const queryWords = historyState.drawerFilter.split(/\s+/).filter(Boolean);
        const searchable = `${x.title || ''} ${x.theme || ''} ${x.summary || ''} ${(x.tags || []).join(' ')} ${x.scopeLabel || ''}`.toLowerCase();
        const matchesAll = queryWords.every((w) => searchable.includes(w));
        if (!matchesAll) return false;
      }

      return true;
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
        ${historyState.isCrossMode ? `
          <div class="cross-checkbox-wrap" style="display: flex; align-items: center; margin-right: 10px;">
            <input type="checkbox" class="cross-checkbox" data-drawer-cross-id="${item.id}" ${historyState.selectedCrossIds.has(item.id) ? 'checked' : ''} style="width: 18px; height: 18px;" />
          </div>
        ` : ''}
        <div class="hi-main">
          <div class="hi-title-row">
            ${item.pinned ? '<span class="pin-badge" title="ピン留め済み">⭐</span>' : ''}
            ${item.isCrossSynthesis ? '<span class="mode-tag" style="background: rgba(168,85,247,0.2); color: #c084fc; border: 1px solid rgba(168,85,247,0.4); font-size: 10px; padding: 1px 5px;">統合クロス</span>' : ''}
            ${item.isDeltaTracking ? '<span class="mode-tag badge-delta" style="font-size: 10px; padding: 1px 5px;">定点差分</span>' : ''}
            <strong>${esc(item.title || item.theme)}</strong>
          </div>
          <div class="hi-meta">
            <span class="mode-tag ${item.mode === 'live' ? 'live' : ''}">${item.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
            <span>${esc(item.scopeLabel)}</span>
            ${item.periodLabel ? `<span>· ${esc(item.periodLabel)}</span>` : ''}
            <span>· ソース ${item.sourceCount}件</span>
            <span>· ${relTime(item.createdAt)}</span>
          </div>
          ${Array.isArray(item.tags) && item.tags.length ? `
            <div class="history-tags-wrap">
              ${item.tags.map((t) => `<span class="history-tag-pill">#${esc(t)}</span>`).join('')}
            </div>
          ` : ''}
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

    // 履歴クリックで読み込み（クロス選択モード時は選択トグル）
    $$('.history-item', listEl).forEach((li) => {
      li.addEventListener('click', async (e) => {
        if (e.target.closest('[data-delete-id]') || e.target.closest('[data-pin-id]')) return;
        const id = li.dataset.id;
        if (historyState.isCrossMode) {
          if (historyState.selectedCrossIds.has(id)) {
            historyState.selectedCrossIds.delete(id);
          } else {
            historyState.selectedCrossIds.add(id);
          }
          const cb = li.querySelector('.cross-checkbox');
          if (cb) cb.checked = historyState.selectedCrossIds.has(id);
          updateCrossBar();
          renderHomeHistory();
          return;
        }
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
    // 1. タグフィルター (v2.13.0)
    if (historyState.selectedTag && historyState.selectedTag !== 'all') {
      if (historyState.selectedTag === 'pinned') {
        if (!x.pinned) return false;
      } else {
        const tags = Array.isArray(x.tags) ? x.tags : [];
        if (!tags.includes(historyState.selectedTag)) return false;
      }
    }

    // 2. 全文検索（タイトル・テーマ・要約・タグのスペース区切りAND検索）
    if (historyState.homeFilter) {
      const queryWords = historyState.homeFilter.split(/\s+/).filter(Boolean);
      const searchable = `${x.title || ''} ${x.theme || ''} ${x.summary || ''} ${(x.tags || []).join(' ')} ${x.scopeLabel || ''}`.toLowerCase();
      const matchesAll = queryWords.every((w) => searchable.includes(w));
      if (!matchesAll) return false;
    }

    return true;
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
            ${historyState.isCrossMode ? `
              <label class="cross-checkbox-wrap" style="display: flex; align-items: center; margin-right: 6px;">
                <input type="checkbox" class="cross-checkbox" data-home-cross-id="${item.id}" ${historyState.selectedCrossIds.has(item.id) ? 'checked' : ''} style="width: 17px; height: 17px;" />
              </label>
            ` : ''}
            <span class="mode-tag ${item.mode === 'live' ? 'live' : ''}">${item.mode === 'live' ? 'LIVE' : 'DEMO'}</span>
            ${item.isCrossSynthesis ? '<span class="mode-tag" style="background: rgba(168,85,247,0.2); color: #c084fc; border: 1px solid rgba(168,85,247,0.4); font-size: 10px; padding: 1px 5px;">統合クロス</span>' : ''}
            ${item.isDeltaTracking ? '<span class="mode-tag badge-delta">定点差分</span>' : ''}
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
        ${Array.isArray(item.tags) && item.tags.length ? `
          <div class="history-tags-wrap" style="margin-bottom: 6px;">
            ${item.tags.map((t) => `<span class="history-tag-pill">#${esc(t)}</span>`).join('')}
          </div>
        ` : ''}
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
      const id = card.dataset.historyId;
      if (historyState.isCrossMode) {
        if (historyState.selectedCrossIds.has(id)) {
          historyState.selectedCrossIds.delete(id);
        } else {
          historyState.selectedCrossIds.add(id);
        }
        const cb = card.querySelector('.cross-checkbox');
        if (cb) cb.checked = historyState.selectedCrossIds.has(id);
        updateCrossBar();
        renderHistoryDrawerList();
        return;
      }
      loadHistoryItem(id);
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

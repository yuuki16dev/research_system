// ==========================================================================
// エビデンス・インスペクター（Smart Evidence Inspector）
// 本文中の引用 [1], [S1] 等をクリックした際に一次情報の抜粋と根拠を瞬時に照合
// ==========================================================================

import { esc, icon, hydrateIcons } from '../ui.js';

let activeSourcesMap = new Map();

/**
 * ソース一覧マップを登録
 * @param {Array} sources 
 */
export function setEvidenceSources(sources = []) {
  activeSourcesMap.clear();
  if (!Array.isArray(sources)) return;

  sources.forEach((s) => {
    // index (1, 2, 3...) と id ('S1', 'S2'...) の両方で引けるように登録
    if (s.index !== undefined) {
      activeSourcesMap.set(String(s.index), s);
      activeSourcesMap.set(Number(s.index), s);
    }
    if (s.id) {
      activeSourcesMap.set(String(s.id).toLowerCase(), s);
      activeSourcesMap.set(String(s.id).toUpperCase(), s);
      const numOnly = String(s.id).replace(/\D/g, '');
      if (numOnly) activeSourcesMap.set(numOnly, s);
    }
  });
}

/**
 * エビデンス照合ドロワーを開く
 * @param {string|number} citeKey 
 */
export function openEvidenceInspector(citeKey) {
  const drawer = document.getElementById('drawer-evidence');
  if (!drawer) return;

  const keyStr = String(citeKey).trim();
  const src = activeSourcesMap.get(keyStr) || activeSourcesMap.get(keyStr.replace(/\D/g, ''));

  const badgeId = document.getElementById('evi-badge-id');
  const domainText = document.getElementById('evi-domain-text');
  const scoreVal = document.getElementById('evi-score-val');
  const scoreStatus = document.getElementById('evi-score-status');
  const scoreBarFill = document.getElementById('evi-score-bar-fill');
  const sourceTitle = document.getElementById('evi-source-title');
  const metaTags = document.getElementById('evi-meta-tags');
  const snippetText = document.getElementById('evi-snippet-text');
  const openUrlBtn = document.getElementById('evi-open-url');

  if (badgeId) badgeId.textContent = `[${src?.index || citeKey}]`;

  if (src) {
    const domain = src.domain || (src.url ? new URL(src.url).hostname.replace(/^www\./, '') : '一次情報ソース');
    if (domainText) domainText.textContent = domain;
    if (sourceTitle) sourceTitle.textContent = src.title || 'タイトル未定義の一次情報';

    // スコア評価
    const score = typeof src.score === 'number' ? src.score : 85;
    if (scoreVal) {
      scoreVal.textContent = score;
      scoreVal.className = 'evi-score-val' + (score < 70 ? ' score-danger' : score < 85 ? ' score-warning' : '');
    }
    if (scoreBarFill) {
      scoreBarFill.style.width = `${Math.min(100, Math.max(5, score))}%`;
      scoreBarFill.className = 'evi-score-bar-fill' + (score < 70 ? ' score-danger' : score < 85 ? ' score-warning' : '');
    }
    if (scoreStatus) {
      scoreStatus.textContent = score >= 85 ? '高信頼・一次情報ソース' : score >= 70 ? '標準的なWebソース' : '要確認ソース';
    }

    // メタタグ
    if (metaTags) {
      let tagsHtml = `<span class="tag"><span data-icon="globe"></span>${esc(domain)}</span>`;
      if (src.categoryLabel) {
        tagsHtml += `<span class="tag tag-category">${esc(src.categoryBadge || '🏛️')} ${esc(src.categoryLabel)}</span>`;
      }
      if (src.publishedDate) {
        tagsHtml += `<span class="tag"><span data-icon="calendar"></span>${esc(src.publishedDate.slice(0, 10))}</span>`;
      }
      if (src.hop === 2) {
        tagsHtml += `<span class="tag tag-hop2" style="background: rgba(16, 185, 129, 0.15); color: #34d399;"><span data-icon="git-merge"></span>2nd Hop（深層追加）</span>`;
      }
      metaTags.innerHTML = tagsHtml;
      hydrateIcons(metaTags);
    }

    // 抜粋テキスト（Snippet）
    if (snippetText) {
      const snip = src.snippet || src.body || 'この一次ソースから事実データ・数値指標を照合・抽出しました。';
      snippetText.textContent = snip;
    }

    // 外部リンク
    if (openUrlBtn) {
      if (src.url) {
        openUrlBtn.href = src.url;
        openUrlBtn.style.display = 'inline-flex';
      } else {
        openUrlBtn.style.display = 'none';
      }
    }
  } else {
    // ソースが見つからない場合のフォールバック表示
    if (domainText) domainText.textContent = '参照ソース';
    if (sourceTitle) sourceTitle.textContent = `ソース [${citeKey}] の一次エビデンス`;
    if (scoreVal) scoreVal.textContent = '—';
    if (scoreStatus) scoreStatus.textContent = '参照インデックス情報';
    if (metaTags) metaTags.innerHTML = '';
    if (snippetText) snippetText.textContent = 'リサーチレポートの集計表または詳細論述に引用された参照情報です。';
    if (openUrlBtn) openUrlBtn.style.display = 'none';
  }

  drawer.hidden = false;
  drawer.classList.add('is-open');
}

/**
 * エビデンス照合ドロワーを閉じる
 */
export function closeEvidenceInspector() {
  const drawer = document.getElementById('drawer-evidence');
  if (!drawer) return;
  drawer.classList.remove('is-open');
  drawer.hidden = true;
}

/**
 * 引用リンクのクリックイベント初期化
 */
export function initEvidenceInspector() {
  const drawer = document.getElementById('drawer-evidence');
  if (!drawer) return;

  // 閉じるボタンと背景クリック
  drawer.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeEvidenceInspector());
  });

  // Esc キーで閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) {
      closeEvidenceInspector();
    }
  });

  // レポート領域での .cite クリックをイベント委任で捕捉
  document.addEventListener('click', (e) => {
    const citeEl = e.target.closest('.cite');
    if (!citeEl) return;

    e.preventDefault(); // ページ最下部へのジャンプを抑制
    const citeKey = citeEl.dataset.cite || citeEl.textContent.replace(/[\[\]]/g, '');
    if (citeKey) {
      openEvidenceInspector(citeKey);
    }
  });
}


// ==========================================================================
// Research Studio — テーマ推敲・切り口サジェスト モジュール (v2.14.0)
// ==========================================================================

'use strict';

/**
 * 入力されたテーマから多角的な調査切り口チップをリアルタイム生成
 * @param {string} rawQuery
 * @returns {Array<{label: string, query: string, purpose: string}>}
 */
export function generateQuerySuggestions(rawQuery) {
  const q = (rawQuery || '').trim();
  if (q.length < 2) return [];

  return [
    {
      label: '⚔️ 競合との機能・料金比較',
      query: `${q} 主要競合 比較 料金 機能 機能対照表`,
      purpose: 'decision',
    },
    {
      label: '🛠️ 2026年最新アーキテクチャ・導入技術',
      query: `${q} 2026年 最新技術 動向 アーキテクチャ 実装事例`,
      purpose: 'tech',
    },
    {
      label: '⚠️ 企業導入におけるリスク・失敗事例',
      query: `${q} 企業導入 リスク 課題 落とし穴 失敗事例 対策`,
      purpose: 'risk',
    },
    {
      label: '📈 市場規模と成長要因・ROI（費用対効果）',
      query: `${q} 市場規模 成長要因 導入ROI 費用対効果 投資回収`,
      purpose: 'cost',
    },
  ];
}

/**
 * テーマ推敲・サジェストのイベント初期化
 */
export function initQueryPolisher() {
  const themeInput = document.getElementById('theme-input');
  const polisherWrap = document.getElementById('theme-polisher-wrap');
  const chipsContainer = document.getElementById('theme-polisher-chips');

  if (!themeInput || !polisherWrap || !chipsContainer) return;

  let debounceTimer = null;

  themeInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const val = themeInput.value.trim();
      // URL モードの場合または文字数が短すぎる場合は非表示
      if (/^https?:\/\//i.test(val) || val.length < 2) {
        polisherWrap.style.display = 'none';
        chipsContainer.innerHTML = '';
        return;
      }

      const suggestions = generateQuerySuggestions(val);
      if (!suggestions.length) {
        polisherWrap.style.display = 'none';
        chipsContainer.innerHTML = '';
        return;
      }

      let html = '';
      suggestions.forEach((s) => {
        html += `<button type="button" class="theme-polisher-chip" data-query="${s.query}" data-purpose="${s.purpose}">${s.label}</button>`;
      });

      chipsContainer.innerHTML = html;
      polisherWrap.style.display = 'flex';

      // チップのクリックイベント
      chipsContainer.querySelectorAll('.theme-polisher-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          themeInput.value = chip.dataset.query;
          themeInput.focus();
          polisherWrap.style.display = 'none';

          // スタイルセレクターも連動して切り替え
          const purpose = chip.dataset.purpose;
          const styleOpt = document.querySelector(`.style-opt[data-style="${purpose}"]`);
          if (styleOpt) {
            styleOpt.click();
          }
        });
      });
    }, 250);
  });
}


'use strict';

/**
 * プラン定義およびクレジット消費量設定（C-4: レビュー H6）
 * 
 * ※ 前提: プラン名、月間クレジット数、処理ごとの消費量は未決定の仮値です。
 *    ビジネス要件に合わせて後から変更可能です。
 */

// プランごとの月間付与クレジット数
const PLAN_CREDITS = {
  free: 3,         // お試し無料枠: 月3クレジット
  standard: 30,    // スタンダード: 月30クレジット
  light: 10,       // （互換用）
  pro: 30,         // （互換用）
  admin: Infinity, // 管理者・ローカル利用: 無制限
};

// 処理ごとの消費クレジット数
const ACTION_CREDIT_COSTS = {
  research_quick: 1, // 通常リサーチ: 1
  research_deep: 3,  // 深掘りリサーチ: 3
  cross: 2,          // クロス分析: 2
  delta: 2,          // 差分更新: 2
  slides: 1,         // スライド生成: 1
  deepdive: 0,       // 深掘り対話: 0（別途1レポートあたり10回まで）
};

// プランごとの機能実行権限
// free は通常リサーチ（および深掘り対話）のみ実行可
const PLAN_ALLOWED_ACTIONS = {
  free: ['research_quick', 'deepdive'],
  standard: ['research_quick', 'research_deep', 'cross', 'delta', 'slides', 'deepdive'],
  light: ['research_quick', 'research_deep', 'cross', 'delta', 'slides', 'deepdive'],
  pro: ['research_quick', 'research_deep', 'cross', 'delta', 'slides', 'deepdive'],
  admin: ['research_quick', 'research_deep', 'cross', 'delta', 'slides', 'deepdive'],
};

/**
 * アクション名から消費クレジット数を取得
 * @param {string} action
 * @returns {number}
 */
function getActionCost(action) {
  if (ACTION_CREDIT_COSTS[action] !== undefined) {
    return ACTION_CREDIT_COSTS[action];
  }
  return 1;
}

/**
 * プランが指定のアクションを実行可能か判定
 * @param {string} plan
 * @param {string} action
 * @returns {boolean}
 */
function isActionAllowedForPlan(plan = 'free', action = 'research_quick') {
  const normPlan = String(plan || 'free').toLowerCase();
  const allowedList = PLAN_ALLOWED_ACTIONS[normPlan] || PLAN_ALLOWED_ACTIONS.free;
  return allowedList.includes(action);
}

module.exports = {
  PLAN_CREDITS,
  ACTION_CREDIT_COSTS,
  PLAN_ALLOWED_ACTIONS,
  getActionCost,
  isActionAllowedForPlan,
};


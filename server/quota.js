'use strict';

/**
 * リサーチクレジット＆クォータ管理モジュール (C-4: レビュー H6)
 *
 * 1. プランごとの月間クレジット数を追跡（free: 3, standard: 30, admin: 無制限）
 * 2. アクションごとの消費クレジット（通常: 1, 深掘り: 3, クロス: 2, 差分: 2, スライド: 1, 対話: 0）を減算
 * 3. free プランでの通常リサーチ以外の実行を 403 (PLAN_FORBIDDEN) で拒否
 * 4. クラウド環境（Supabase連携）およびローカル環境（無制限管理者）の両方に対応
 */

const { IS_CLOUD } = require('./env');
const planConfig = require('./plan-config');

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
}
function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
}

// 既存テスト互換用 PLAN_LIMITS（plan-config.js の PLAN_CREDITS を参照）
const PLAN_LIMITS = {
  ...planConfig.PLAN_CREDITS,
  light: 40,
  pro: 80,
  admin: Infinity,
};

// メモリキャッシュ（ローカル環境および高速キャッシュ用）
// key: `${userId}:${yearMonth}` -> count
const localUsageCache = new Map();

function getCurrentYearMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * ユーザーの当月クォータ情報を取得
 * @param {string} userId
 * @param {string} plan
 * @returns {Promise<{ used: number, limit: number, remaining: number, plan: string, canResearch: boolean, yearMonth: string }>}
 */
async function getMonthlyQuota(userId = 'local-user', plan = 'admin') {
  const ym = getCurrentYearMonth();
  const normPlan = String(plan || 'free').toLowerCase();
  const limit = PLAN_LIMITS[normPlan] !== undefined ? PLAN_LIMITS[normPlan] : (planConfig.PLAN_CREDITS[normPlan] || PLAN_LIMITS.free);

  // 無制限プラン（admin）の場合
  if (limit === Infinity) {
    // クラウド版の場合、ADMIN_USER_IDS に含まれるユーザーのみ無制限とする (B-1)
    if (IS_CLOUD) {
      const adminUserIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!adminUserIds.includes(userId)) {
        return getMonthlyQuota(userId, 'free');
      }
    }
    const key = `${userId}:${ym}`;
    const used = localUsageCache.get(key) || 0;
    return {
      used,
      limit: 999999,
      remaining: 999999,
      plan: 'admin',
      canResearch: true,
      yearMonth: ym,
    };
  }

  // Supabase 未設定（ローカル/テスト環境）の場合はローカルキャッシュで制限判定
  if (!IS_CLOUD) {
    const key = `${userId}:${ym}`;
    const used = localUsageCache.get(key) || 0;
    const remaining = Math.max(0, limit - used);
    return {
      used,
      limit,
      remaining,
      plan: normPlan,
      canResearch: remaining > 0,
      yearMonth: ym,
    };
  }

  // Supabase からクォータを取得
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    const key = `${userId}:${ym}`;
    const used = localUsageCache.get(key) || 0;
    const remaining = Math.max(0, limit - used);
    return {
      used,
      limit,
      remaining,
      plan: normPlan,
      canResearch: remaining > 0,
      yearMonth: ym,
    };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/research_usage?user_id=eq.${encodeURIComponent(userId)}&year_month=eq.${encodeURIComponent(ym)}&select=used_count`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      const rows = await res.json();
      const used = (Array.isArray(rows) && rows.length > 0) ? (rows[0].used_count || 0) : 0;
      const remaining = Math.max(0, limit - used);
      return {
        used,
        limit,
        remaining,
        plan: normPlan,
        canResearch: remaining > 0,
        yearMonth: ym,
      };
    }
  } catch (err) {
    console.warn('[quota] Failed to fetch quota from Supabase:', err.message);
  }

  // フォールバック（キャッシュ参照）
  const key = `${userId}:${ym}`;
  const used = localUsageCache.get(key) || 0;
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    plan: normPlan,
    canResearch: remaining > 0,
    yearMonth: ym,
  };
}

/**
 * クォータを指定量消費（カウント・クレジット加算）
 * @param {string} userId
 * @param {string} plan
 * @param {number} [amount=1]
 * @returns {Promise<number>} 更新後の消費クレジット数
 */
async function recordUsage(userId = 'local-user', plan = 'admin', amount = 1) {
  const ym = getCurrentYearMonth();
  const key = `${userId}:${ym}`;
  const addCount = Math.max(0, parseInt(amount, 10) || 1);
  const currentLocal = (localUsageCache.get(key) || 0) + addCount;
  localUsageCache.set(key, currentLocal);

  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!IS_CLOUD || !serviceKey || !supabaseUrl) {
    return currentLocal;
  }

  try {
    // Supabase RPC または UPSERT でカウント更新
    await fetch(`${supabaseUrl}/rest/v1/research_usage`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: userId,
        year_month: ym,
        used_count: currentLocal,
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    console.warn('[quota] Failed to record usage to Supabase:', err.message);
  }

  return currentLocal;
}

/**
 * 特定アクションの実行可否と必要クレジット数を検査 (C-4)
 * @param {string} userId
 * @param {string} plan
 * @param {string} action
 * @returns {Promise<{ allowed: boolean, reason?: string, message?: string, cost: number, quota?: object }>}
 */
async function checkActionQuota(userId, plan = 'free', action = 'research_quick') {
  const cost = planConfig.getActionCost(action);
  const isAllowed = planConfig.isActionAllowedForPlan(plan, action);

  // 1. プラン権限チェック (free は通常リサーチ以外不可)
  if (!isAllowed) {
    return {
      allowed: false,
      reason: 'PLAN_FORBIDDEN',
      cost,
      message: `無料（Free）プランではこの機能（${action}）をご利用いただけません。Standardプランへアップグレードしてください。`,
    };
  }

  // 2. クォータ残量チェック
  const quota = await getMonthlyQuota(userId, plan);
  if (quota.plan === 'admin') {
    return { allowed: true, cost, quota };
  }

  if (quota.remaining < cost) {
    return {
      allowed: false,
      reason: 'QUOTA_EXCEEDED',
      code: 'QUOTA_EXCEEDED',
      cost,
      quota,
      message: `今月のリサーチ上限回数（クレジット不足: 必要 ${cost}、残り ${quota.remaining}）に達しました。プランをアップグレードするか来月1日のリセットをお待ちください。`,
    };
  }

  return { allowed: true, cost, quota };
}

/**
 * 特定アクションのクレジットを消費 (C-4)
 * @param {string} userId
 * @param {string} plan
 * @param {string} action
 * @returns {Promise<number>}
 */
async function consumeActionCredits(userId, plan = 'free', action = 'research_quick') {
  const cost = planConfig.getActionCost(action);
  if (cost <= 0) return 0;
  return recordUsage(userId, plan, cost);
}

/**
 * アクションごとのクォータ検査ミドルウェア (C-4)
 * @param {string|((req: object) => string)} actionOrResolver
 */
function requireActionQuota(actionOrResolver) {
  return async (req, res, next) => {
    const user = req.user || { id: 'owner-user', plan: 'admin' };
    const plan = user.plan || 'free';
    const action = typeof actionOrResolver === 'function' ? actionOrResolver(req) : actionOrResolver;

    try {
      const check = await checkActionQuota(user.id, plan, action);
      if (!check.allowed) {
        return res.status(403).json({
          error: check.message,
          code: check.reason,
          requiredCredits: check.cost,
          quota: check.quota,
        });
      }
      req.quota = check.quota;
      req.actionCost = check.cost;
      req.actionName = action;
      next();
    } catch (err) {
      console.error('[quota] requireActionQuota error:', err);
      next();
    }
  };
}

/**
 * 既存互換ミドルウェア（通常リサーチ用）
 */
const requireQuota = requireActionQuota((req) => {
  const body = req.body || {};
  return body.depth === 'deep' ? 'research_deep' : 'research_quick';
});

module.exports = {
  PLAN_LIMITS,
  getCurrentYearMonth,
  getMonthlyQuota,
  recordUsage,
  checkActionQuota,
  consumeActionCredits,
  requireActionQuota,
  requireQuota,
};

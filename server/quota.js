'use strict';

/**
 * リサーチクレジット＆クォータ管理モジュール (C-4 / R-3)
 *
 * 1. プランごとの月間クレジット数は server/plan-config.js に一本化
 * 2. 開始前に reserveCredits() で原子的に確保し、ジョブ失敗時のみ refundCredits() で返却
 * 3. 年月は日本時間（Asia/Tokyo）で計算
 * 4. クラウド版（UUIDユーザー）は Supabase RPC (consume_credits / refund_credits) を使用し、
 *    障害時は素通しせず例外・unavailable を返す
 */

const env = require('./env');
const planConfig = require('./plan-config');
const { checkJobCapacity } = require('./jobs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getSupabaseUrl = env.getSupabaseUrl;
const getSupabaseServiceRoleKey = env.getSupabaseServiceRoleKey;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

function getAdminUserIds() {
  return (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdminUser(userId) {
  return Boolean(userId && getAdminUserIds().includes(userId));
}

function shouldRefundOnCancel() {
  return process.env.REFUND_ON_CANCEL === 'true';
}

// 互換用エクスポート（plan-config.js に一本化）
const PLAN_LIMITS = planConfig.PLAN_CREDITS;

// 非UUIDユーザー（ローカル版、テストアカウント、匿名モード）用メモリストア
// ※ クラウド版の正規UUIDユーザーでは一切使用しない
const memoryCredits = new Map();

/**
 * 日本時間 (Asia/Tokyo) 基準の YYYY-MM を返す
 * @param {Date} [date]
 * @returns {string}
 */
function getCurrentYearMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

function resolveEffectivePlanAndLimit(userId, plan = 'free') {
  const normPlan = String(plan || 'free').toLowerCase();
  const limit = PLAN_LIMITS[normPlan] !== undefined ? PLAN_LIMITS[normPlan] : PLAN_LIMITS.free;

  if (limit === Infinity) {
    if (env.IS_CLOUD && !isAdminUser(userId)) {
      return { plan: 'free', limit: PLAN_LIMITS.free };
    }
    return { plan: 'admin', limit: Infinity };
  }

  return { plan: normPlan, limit };
}

function isBypassUser(userId, resolvedLimit) {
  if (!env.IS_CLOUD && userId === 'owner-user') return true;
  if (isAdminUser(userId)) return true;
  if (resolvedLimit === Infinity) return true;
  return false;
}

/**
 * ユーザーの当月クォータ情報を取得（表示・検査用）
 * クラウド版で Supabase から取得できない場合はメモリで代用せず unavailable: true を返す。
 * @param {string} userId
 * @param {string} plan
 */
async function getMonthlyQuota(userId = 'local-user', plan = 'admin') {
  const ym = getCurrentYearMonth();
  const { plan: resolvedPlan, limit } = resolveEffectivePlanAndLimit(userId, plan);

  if (isBypassUser(userId, limit)) {
    return {
      used: 0,
      limit: 999999,
      remaining: 999999,
      plan: 'admin',
      canResearch: true,
      yearMonth: ym,
    };
  }

  // クラウド版かつ UUID ユーザーの場合は Supabase から取得（失敗時もメモリで代用しない）
  if (env.IS_CLOUD && isUuid(userId)) {
    const supabaseUrl = getSupabaseUrl();
    const serviceKey = getSupabaseServiceRoleKey();
    if (!supabaseUrl || !serviceKey) {
      return {
        used: null,
        limit,
        remaining: null,
        unavailable: true,
        plan: resolvedPlan,
        canResearch: false,
        yearMonth: ym,
      };
    }

    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/research_usage?user_id=eq.${encodeURIComponent(userId)}&year_month=eq.${encodeURIComponent(ym)}&select=used_count`,
        {
          headers: env.buildSupabaseHeaders(serviceKey),
          signal: AbortSignal.timeout(3000),
        }
      );

      if (!res.ok) {
        return {
          used: null,
          limit,
          remaining: null,
          unavailable: true,
          plan: resolvedPlan,
          canResearch: false,
          yearMonth: ym,
        };
      }

      const rows = await res.json();
      const used = Array.isArray(rows) && rows.length > 0 ? rows[0].used_count || 0 : 0;
      const remaining = Math.max(0, limit - used);
      return {
        used,
        limit,
        remaining,
        plan: resolvedPlan,
        canResearch: remaining > 0,
        yearMonth: ym,
      };
    } catch (err) {
      console.warn('[quota] Failed to fetch quota from Supabase:', err.message);
      return {
        used: null,
        limit,
        remaining: null,
        unavailable: true,
        plan: resolvedPlan,
        canResearch: false,
        yearMonth: ym,
      };
    }
  }

  // 非UUIDユーザー（ローカル版・テストアカウント・匿名モード）はメモリ実装を使用
  const key = `${userId}:${ym}`;
  const used = memoryCredits.get(key) || 0;
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    plan: resolvedPlan,
    canResearch: remaining > 0,
    yearMonth: ym,
  };
}

/**
 * 実行前にクレジットを原子的に確保する (R-3)
 * @param {string} userId
 * @param {string} plan
 * @param {string} action
 * @returns {Promise<{ ok: boolean, reserved: boolean, cost: number, yearMonth: string, plan: string, reason?: string }>}
 */
async function reserveCredits(userId, plan = 'free', action = 'research_quick') {
  const ym = getCurrentYearMonth();
  const cost = planConfig.getActionCost(action);
  const { plan: resolvedPlan, limit } = resolveEffectivePlanAndLimit(userId, plan);

  if (cost <= 0 || isBypassUser(userId, limit)) {
    return {
      ok: true,
      reserved: false,
      cost: 0,
      yearMonth: ym,
      plan: isBypassUser(userId, limit) ? 'admin' : resolvedPlan,
    };
  }

  if (env.IS_CLOUD && isUuid(userId)) {
    const supabaseUrl = getSupabaseUrl();
    const serviceKey = getSupabaseServiceRoleKey();
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing for consume_credits RPC');
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/consume_credits`, {
      method: 'POST',
      headers: env.buildSupabaseHeaders(serviceKey, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        p_user: userId,
        p_ym: ym,
        p_cost: cost,
        p_limit: limit,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`consume_credits RPC returned HTTP ${res.status}: ${errBody}`);
    }

    const consumed = await res.json();
    if (consumed === true) {
      return {
        ok: true,
        reserved: true,
        cost,
        yearMonth: ym,
        plan: resolvedPlan,
      };
    }
    if (consumed === false) {
      return {
        ok: false,
        reserved: false,
        reason: 'QUOTA_EXCEEDED',
        cost,
        yearMonth: ym,
        plan: resolvedPlan,
      };
    }

    throw new Error(`Unexpected consume_credits RPC response: ${JSON.stringify(consumed)}`);
  }

  // 非UUID（ローカル版、テスト用アカウント、ログイン不要モード）用メモリ実装
  const key = `${userId}:${ym}`;
  const currentUsed = memoryCredits.get(key) || 0;
  if (currentUsed + cost > limit) {
    return {
      ok: false,
      reserved: false,
      reason: 'QUOTA_EXCEEDED',
      cost,
      yearMonth: ym,
      plan: resolvedPlan,
    };
  }
  memoryCredits.set(key, currentUsed + cost);
  return {
    ok: true,
    reserved: true,
    cost,
    yearMonth: ym,
    plan: resolvedPlan,
  };
}

/**
 * 失敗時等に確保済みクレジットを返却する (R-3)
 * @param {string} userId
 * @param {string} action
 * @param {string} yearMonth 確保時に返された年月
 */
async function refundCredits(userId, action = 'research_quick', yearMonth = getCurrentYearMonth()) {
  const ym = yearMonth || getCurrentYearMonth();
  const cost = planConfig.getActionCost(action);

  if (cost <= 0 || isBypassUser(userId, undefined)) {
    return { refunded: false, cost: 0, yearMonth: ym };
  }

  if (env.IS_CLOUD && isUuid(userId)) {
    const supabaseUrl = getSupabaseUrl();
    const serviceKey = getSupabaseServiceRoleKey();
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing for refund_credits RPC');
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/refund_credits`, {
      method: 'POST',
      headers: env.buildSupabaseHeaders(serviceKey, {
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        p_user: userId,
        p_ym: ym,
        p_cost: cost,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`refund_credits RPC returned HTTP ${res.status}: ${errBody}`);
    }

    return { refunded: true, cost, yearMonth: ym };
  }

  const key = `${userId}:${ym}`;
  const currentUsed = memoryCredits.get(key) || 0;
  memoryCredits.set(key, Math.max(0, currentUsed - cost));
  return { refunded: true, cost, yearMonth: ym };
}

/**
 * 特定アクションの実行可否と必要クレジット数を検査（非破壊チェック用）
 */
async function checkActionQuota(userId, plan = 'free', action = 'research_quick') {
  const cost = planConfig.getActionCost(action);
  const isAllowed = planConfig.isActionAllowedForPlan(plan, action);

  if (!isAllowed) {
    return {
      allowed: false,
      reason: 'PLAN_FORBIDDEN',
      cost,
      message: `無料（Free）プランではこの機能（${action}）をご利用いただけません。Standardプランへアップグレードしてください。`,
    };
  }

  const quota = await getMonthlyQuota(userId, plan);
  if (quota.unavailable) {
    return {
      allowed: false,
      reason: 'QUOTA_UNAVAILABLE',
      cost,
      quota,
      message: 'クレジット残高の確認に失敗しました。しばらく経ってから再度お試しください。',
    };
  }

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
 * アクションごとのクォータ検査・原子的確保ミドルウェア (R-3)
 * 順序:
 *   1. プラン権限チェック (403 PLAN_FORBIDDEN)
 *   2. ジョブを伴う処理は checkJobCapacity を先に確認 (429 / 503)
 *   3. reserveCredits で確保 (403 QUOTA_EXCEEDED / 例外時は 503 QUOTA_UNAVAILABLE)
 *
 * @param {string|((req: object) => string)} actionOrResolver
 * @param {{ checkCapacity?: boolean, skipReserve?: boolean }} [options]
 */
function requireActionQuota(actionOrResolver, options = {}) {
  const { checkCapacity = false, skipReserve = false } = options;

  return async (req, res, next) => {
    const user = req.user || { id: 'owner-user', plan: env.IS_CLOUD ? 'free' : 'admin' };
    const plan = user.plan || 'free';
    const action = typeof actionOrResolver === 'function' ? actionOrResolver(req) : actionOrResolver;
    const cost = planConfig.getActionCost(action);

    // 1. プランの権限を確認する
    if (!planConfig.isActionAllowedForPlan(plan, action)) {
      return res.status(403).json({
        error: `無料（Free）プランではこの機能（${action}）をご利用いただけません。Standardプランへアップグレードしてください。`,
        code: 'PLAN_FORBIDDEN',
        requiredCredits: cost,
      });
    }

    // 2. ジョブを伴う処理は checkJobCapacity を先に確認する（クレジットは確保しない）
    if (checkCapacity) {
      const capacity = checkJobCapacity(user.id);
      if (!capacity.ok) {
        return res.status(capacity.status).json({
          error: capacity.error,
          code: capacity.code,
        });
      }
    }

    req.actionName = action;
    req.actionCost = cost;

    if (skipReserve) {
      return next();
    }

    // 3. reserveCredits を呼ぶ
    try {
      const reservation = await reserveCredits(user.id, plan, action);
      if (!reservation.ok) {
        return res.status(403).json({
          error: `今月のリサーチ上限回数（クレジット不足: 必要 ${reservation.cost}）に達しました。プランをアップグレードするか来月1日のリセットをお待ちください。`,
          code: 'QUOTA_EXCEEDED',
          requiredCredits: reservation.cost,
        });
      }

      req.creditReservation = reservation;
      return next();
    } catch (err) {
      console.error('[quota] reserveCredits error:', err);
      return res.status(503).json({
        error: 'クレジット残高の確認に失敗しました。しばらく経ってから再度お試しください。',
        code: 'QUOTA_UNAVAILABLE',
      });
    }
  };
}

/**
 * 通常リサーチ用ミドルウェア
 */
const requireQuota = requireActionQuota(
  (req) => ((req.body || {}).depth === 'deep' ? 'research_deep' : 'research_quick'),
  { checkCapacity: true }
);

function _clearMemoryCreditsForTest() {
  memoryCredits.clear();
}

module.exports = {
  PLAN_LIMITS,
  getCurrentYearMonth,
  getMonthlyQuota,
  reserveCredits,
  refundCredits,
  checkActionQuota,
  requireActionQuota,
  requireQuota,
  shouldRefundOnCancel,
  isUuid,
  _clearMemoryCreditsForTest,
};

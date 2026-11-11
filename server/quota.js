'use strict';

/**
 * リサーチ回数制限＆クォータ管理モジュール
 *
 * プランごとの月間リサーチ回数を追跡し、上限超過を防止します。
 * クラウド環境（Supabase連携時）およびローカル環境（無制限管理者）の両方に対応。
 */

const { IS_CLOUD } = require('./env');

const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const PLAN_LIMITS = {
  free: 3,      // お試し無料枠: 月3回
  light: 40,    // ライトプラン（1,000円）: 月40回
  pro: 80,      // プロプラン（3,000円）: 月80回
  admin: Infinity, // 管理者・ローカル利用: 無制限
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
  const limit = PLAN_LIMITS[plan] !== undefined ? PLAN_LIMITS[plan] : PLAN_LIMITS.free;

  // 無制限プラン（admin）の場合
  if (limit === Infinity) {
    const key = `${userId}:${ym}`;
    const used = localUsageCache.get(key) || 0;
    return {
      used,
      limit: 999999,
      remaining: 999999,
      plan: plan || 'admin',
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
      plan,
      canResearch: remaining > 0,
      yearMonth: ym,
    };
  }

  // Supabase からクォータを取得
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/research_usage?user_id=eq.${encodeURIComponent(userId)}&year_month=eq.${encodeURIComponent(ym)}&select=used_count`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
        plan,
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
    plan,
    canResearch: remaining > 0,
    yearMonth: ym,
  };
}

/**
 * クォータを1回消費（カウントインクリメント）
 * @param {string} userId
 * @param {string} plan
 * @returns {Promise<number>} 更新後の消費回数
 */
async function recordUsage(userId = 'local-user', plan = 'admin') {
  const ym = getCurrentYearMonth();
  const key = `${userId}:${ym}`;
  const currentLocal = (localUsageCache.get(key) || 0) + 1;
  localUsageCache.set(key, currentLocal);

  if (!IS_CLOUD || !SUPABASE_SERVICE_ROLE_KEY) {
    return currentLocal;
  }

  try {
    // Supabase RPC または UPSERT でカウント更新
    await fetch(`${SUPABASE_URL}/rest/v1/research_usage`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
 * リサーチ実行前のクォータ検査ミドルウェア
 */
function requireQuota(req, res, next) {
  const user = req.user || { id: 'local-user', plan: 'admin' };
  const plan = user.plan || (user.user_metadata && user.user_metadata.plan) || 'free';

  getMonthlyQuota(user.id, plan).then((quota) => {
    if (!quota.canResearch) {
      return res.status(403).json({
        error: `今月のリサーチ上限回数（${quota.limit}回）に達しました。プランをアップグレードするか、来月1日のリセットをお待ちください。`,
        code: 'QUOTA_EXCEEDED',
        quota,
      });
    }
    req.quota = quota;
    next();
  }).catch((err) => {
    console.error('[quota] Quota check error:', err);
    // クォータ判定エラー時はサービス停止を避けて通過させる
    next();
  });
}

module.exports = {
  PLAN_LIMITS,
  getCurrentYearMonth,
  getMonthlyQuota,
  recordUsage,
  requireQuota,
};

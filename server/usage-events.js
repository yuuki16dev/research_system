'use strict';

/**
 * 利用記録（コスト・トークン・クレジット）DB記録モジュール (C-3)
 *
 * 1. usage_events テーブルへ各ジョブ・対話・スライド処理の完了時・失敗時にイベントを記録
 * 2. Gemini トークン消費・Tavily クレジット消費（基本1、高度2）から概算原価（JPY）を自動算出
 * 3. 書き込みが失敗しても本処理（リサーチ生成等）に影響を与えない非同期フェイルセーフ設計
 */

const env = require('./env');
const modelConfig = require('./model-config');

// ローカル・テスト環境用インメモリ保持
const localUsageEvents = [];

// 日次原価キャッシュ（TTL 60秒）
const DEFAULT_DAILY_COST_LIMIT_JPY = 1000;
const DAILY_COST_CACHE_TTL_MS = 60 * 1000;
let dailyCostCache = null; // { costJpy: number, fetchedAt: number, jstDate: string }
let lastWarnedJstDate = null;

function getDailyCostLimitJpy() {
  const raw = process.env.DAILY_COST_LIMIT_JPY;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_DAILY_COST_LIMIT_JPY;
}

function getJstDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
}

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

/**
 * Tavily クレジット消費量を計算
 * - 基本検索 (quick): 1 クレジット
 * - 高度検索 (deep): 2 クレジット
 * @param {number} searchCount 検索回数
 * @param {boolean} isDeep 高度検索フラグ
 * @returns {number}
 */
function calculateTavilyCredits(searchCount = 1, isDeep = false) {
  const count = Math.max(0, parseInt(searchCount, 10) || 0);
  return count * (isDeep ? 2 : 1);
}

/**
 * 推定原価 (JPY) を計算
 * @param {object} params
 * @param {string} [params.model]
 * @param {number} [params.promptTokens]
 * @param {number} [params.outputTokens]
 * @param {number} [params.tavilyCredits]
 * @returns {number}
 */
function calculateEstimatedCostJpy({ model, promptTokens = 0, outputTokens = 0, tavilyCredits = 0 }) {
  const pricing = modelConfig.getModelPricing(model);
  const promptCostUsd = (promptTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const tavilyCostUsd = tavilyCredits * modelConfig.getTavilyUsdPerCredit();
  const totalUsd = promptCostUsd + outputCostUsd + tavilyCostUsd;
  return Number((totalUsd * modelConfig.getUsdJpyRate()).toFixed(4));
}

/**
 * 利用イベントを記録（非同期・フェイルセーフ）
 * @param {object} event
 * @param {string} event.userId 利用者ID
 * @param {string} event.kind 'research_quick' | 'research_deep' | 'cross' | 'delta' | 'deepdive' | 'slides'
 * @param {string} [event.jobId] ジョブID
 * @param {string} [event.model] 使用モデル
 * @param {number} [event.promptTokens] プロンプトトークン数
 * @param {number} [event.outputTokens] 出力トークン数
 * @param {number} [event.geminiCalls] Gemini 呼び出し回数
 * @param {number} [event.tavilyCredits] Tavily クレジット数
 * @param {string} [event.status] 'done' | 'error' | 'cancelled'
 * @returns {Promise<object|null>}
 */
async function recordUsageEvent({
  userId,
  kind,
  jobId = null,
  model = modelConfig.DEFAULT_GEMINI_MODEL,
  promptTokens = 0,
  outputTokens = 0,
  geminiCalls = 0,
  tavilyCredits = 0,
  status = 'done',
}) {
  const normUserId = String(userId || 'anonymous').trim();
  const normKind = String(kind || 'research_quick').trim();
  const normModel = modelConfig.normalizeModel(model);
  const pTokens = Math.max(0, parseInt(promptTokens, 10) || 0);
  const oTokens = Math.max(0, parseInt(outputTokens, 10) || 0);
  const gCalls = Math.max(0, parseInt(geminiCalls, 10) || 0);
  const tCredits = Math.max(0, parseInt(tavilyCredits, 10) || 0);
  const estCostJpy = calculateEstimatedCostJpy({
    model: normModel,
    promptTokens: pTokens,
    outputTokens: oTokens,
    tavilyCredits: tCredits,
  });

  const record = {
    user_id: normUserId,
    kind: normKind,
    job_id: jobId ? String(jobId) : null,
    model: normModel,
    prompt_tokens: pTokens,
    output_tokens: oTokens,
    gemini_calls: gCalls,
    tavily_credits: tCredits,
    est_cost_jpy: estCostJpy,
    status: ['done', 'error', 'cancelled'].includes(status) ? status : 'done',
    created_at: new Date().toISOString(),
  };

  // メモリ配列に常に保持（テスト・デバッグ用）
  localUsageEvents.push(record);
  if (localUsageEvents.length > 500) localUsageEvents.shift();

  // 原価が新規記録された場合は直近キャッシュに反映しつつ次回参照時に再取得させる
  const todayJst = getJstDateString();
  if (dailyCostCache && dailyCostCache.jstDate === todayJst) {
    dailyCostCache.costJpy = Number((dailyCostCache.costJpy + estCostJpy).toFixed(4));
    dailyCostCache.fetchedAt = 0;
  }

  // クラウド環境（Supabase）への永続化
  if (env.IS_CLOUD) {
    try {
      const baseUrl = getSupabaseUrl();
      const serviceKey = getServiceRoleKey();
      if (baseUrl && serviceKey) {
        const res = await fetch(`${baseUrl}/rest/v1/usage_events`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(record),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn(`[usage-events] Supabase insert warning (${res.status}): ${errText}`);
        } else {
          const inserted = await res.json().catch(() => null);
          return inserted && inserted[0] ? inserted[0] : record;
        }
      }
    } catch (err) {
      // 本処理を失敗させないフェイルセーフ設計
      console.warn('[usage-events] Failed to record usage event:', err.message);
    }
  }

  return record;
}

/**
 * 日本時間 (Asia/Tokyo) 当日 00:00:00 の ISO 文字列 (UTC) を返す
 * @param {Date} [date]
 * @returns {string}
 */
function getJstDayStartIso(date = new Date()) {
  return new Date(`${getJstDateString(date)}T00:00:00+09:00`).toISOString();
}

function maybeWarnDailyCostHigh(costJpy, todayJst) {
  const limitJpy = getDailyCostLimitJpy();
  if (limitJpy > 0 && costJpy >= limitJpy * 0.8 && lastWarnedJstDate !== todayJst) {
    lastWarnedJstDate = todayJst;
    console.warn(`[usage-events] 警告: 本日のAI推定原価が日次上限の80%を超えました (${costJpy} / ${limitJpy} JPY)`);
  }
}

/**
 * 日本時間当日0時以降のAI推定原価合計 (JPY) を取得する (R-5)
 * - クラウド版は Supabase RPC usage_cost_since を呼び出し、60秒間キャッシュ
 * - 取得失敗時は当日キャッシュがあればフォールバック、キャッシュもなければ例外を投げる
 * @returns {Promise<number>}
 */
async function getTodayCostJpy() {
  const now = Date.now();
  const todayJst = getJstDateString(new Date(now));
  const dayStartIso = getJstDayStartIso(new Date(now));

  if (
    dailyCostCache &&
    dailyCostCache.jstDate === todayJst &&
    now - dailyCostCache.fetchedAt < DAILY_COST_CACHE_TTL_MS
  ) {
    maybeWarnDailyCostHigh(dailyCostCache.costJpy, todayJst);
    return dailyCostCache.costJpy;
  }

  if (env.IS_CLOUD) {
    const baseUrl = getSupabaseUrl();
    const serviceKey = getServiceRoleKey();
    try {
      if (!baseUrl || !serviceKey) {
        throw new Error('Supabase credentials missing for usage_cost_since RPC');
      }

      const res = await fetch(`${baseUrl}/rest/v1/rpc/usage_cost_since`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_since: dayStartIso }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`usage_cost_since RPC failed (${res.status}): ${errBody}`);
      }

      const payload = await res.json();
      const total = Number(payload);
      if (!Number.isFinite(total)) {
        throw new Error(`Unexpected usage_cost_since response: ${JSON.stringify(payload)}`);
      }

      dailyCostCache = { costJpy: total, fetchedAt: now, jstDate: todayJst };
      maybeWarnDailyCostHigh(total, todayJst);
      return total;
    } catch (err) {
      if (dailyCostCache && dailyCostCache.jstDate === todayJst) {
        console.warn(`[usage-events] usage_cost_since 取得失敗のため直近キャッシュを使用します: ${err.message}`);
        maybeWarnDailyCostHigh(dailyCostCache.costJpy, todayJst);
        return dailyCostCache.costJpy;
      }
      throw err;
    }
  }

  // ローカル版はメモリ記録から集計
  const total = Number(
    localUsageEvents
      .filter((e) => e.created_at >= dayStartIso)
      .reduce((acc, e) => acc + (Number(e.est_cost_jpy) || 0), 0)
      .toFixed(4)
  );
  dailyCostCache = { costJpy: total, fetchedAt: now, jstDate: todayJst };
  maybeWarnDailyCostHigh(total, todayJst);
  return total;
}

function _clearDailyCostCacheForTest() {
  dailyCostCache = null;
  lastWarnedJstDate = null;
}

function parseSupabaseCount(res, rows) {
  const range = res.headers.get('content-range');
  if (range) {
    const match = range.match(/\/(\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  if (Array.isArray(rows)) return rows.length;
  throw new Error('Unexpected count response from Supabase usage_events');
}

/**
 * レポート単位・利用者1日単位の深掘り対話回数を取得する (R-4)
 * クラウド版で Supabase からの件数取得に失敗した場合は例外を投げる（503 用）。
 * @param {string} userId
 * @param {string} reportId
 * @returns {Promise<{ reportCount: number, dailyCount: number }>}
 */
async function countDeepDiveUsage(userId, reportId) {
  const normUserId = String(userId || 'owner-user').trim();
  const normReportId = String(reportId || '').trim();
  const dayStartIso = getJstDayStartIso();

  if (env.IS_CLOUD) {
    const baseUrl = getSupabaseUrl();
    const serviceKey = getServiceRoleKey();
    if (!baseUrl || !serviceKey) {
      throw new Error('Supabase credentials missing for countDeepDiveUsage');
    }

    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
    };

    const reportUrl =
      `${baseUrl}/rest/v1/usage_events?user_id=eq.${encodeURIComponent(normUserId)}` +
      `&job_id=eq.${encodeURIComponent(normReportId)}` +
      `&kind=eq.deepdive&status=eq.done&select=id`;
    const dailyUrl =
      `${baseUrl}/rest/v1/usage_events?user_id=eq.${encodeURIComponent(normUserId)}` +
      `&kind=eq.deepdive&status=eq.done&created_at=gte.${encodeURIComponent(dayStartIso)}&select=id`;

    const [reportRes, dailyRes] = await Promise.all([
      fetch(reportUrl, { headers, signal: AbortSignal.timeout(5000) }),
      fetch(dailyUrl, { headers, signal: AbortSignal.timeout(5000) }),
    ]);

    if (!reportRes.ok) {
      throw new Error(`Failed to fetch report deepdive count (${reportRes.status})`);
    }
    if (!dailyRes.ok) {
      throw new Error(`Failed to fetch daily deepdive count (${dailyRes.status})`);
    }

    const [reportRows, dailyRows] = await Promise.all([reportRes.json(), dailyRes.json()]);
    return {
      reportCount: parseSupabaseCount(reportRes, reportRows),
      dailyCount: parseSupabaseCount(dailyRes, dailyRows),
    };
  }

  const reportCount = normReportId
    ? localUsageEvents.filter(
        (e) => e.user_id === normUserId && e.job_id === normReportId && e.kind === 'deepdive' && e.status === 'done'
      ).length
    : 0;
  const dailyCount = localUsageEvents.filter(
    (e) => e.user_id === normUserId && e.kind === 'deepdive' && e.status === 'done' && e.created_at >= dayStartIso
  ).length;

  return { reportCount, dailyCount };
}

/**
 * ローカル記録されたイベント一覧を取得（テスト用）
 */
function getLocalUsageEvents(userId = null) {
  if (!userId) return [...localUsageEvents];
  return localUsageEvents.filter((e) => e.user_id === userId);
}

/**
 * ローカル記録をクリア（テスト用）
 */
function clearLocalUsageEvents() {
  localUsageEvents.length = 0;
}

module.exports = {
  calculateTavilyCredits,
  calculateEstimatedCostJpy,
  recordUsageEvent,
  getJstDayStartIso,
  getDailyCostLimitJpy,
  getTodayCostJpy,
  countDeepDiveUsage,
  getLocalUsageEvents,
  clearLocalUsageEvents,
  _clearDailyCostCacheForTest,
};


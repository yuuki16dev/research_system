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
  // Tavily 1クレジットあたり参考価格 ($0.005)
  const tavilyCostUsd = tavilyCredits * 0.005;
  const totalUsd = promptCostUsd + outputCostUsd + tavilyCostUsd;
  return Number((totalUsd * modelConfig.USD_JPY_RATE).toFixed(4));
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
  getLocalUsageEvents,
  clearLocalUsageEvents,
};


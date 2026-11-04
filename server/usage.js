'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');

const FILE = path.join(DATA_DIR, 'usage.json');


// Gemini 3.8 Flash / 2.5 Flash 参考価格 ($ per 1,000,000 tokens)
const GEMINI_PRICING = {
  inputPerMillion: 0.075,
  outputPerMillion: 0.30,
};
const USD_JPY_RATE = 150; // 参考レート

function loadUsage() {
  try {
    if (fs.existsSync(FILE)) {
      return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[usage] load error:', e.message);
  }
  return {
    gemini: {
      totalRequests: 0,
      todayRequests: 0,
      lastDate: new Date().toISOString().slice(0, 10),
      totalPromptTokens: 0,
      totalCandidatesTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      estimatedCostJpy: 0,
      lastUsed: null,
      history: [],
    },
    searches: {
      tavilyTotal: 0,
      duckduckgoTotal: 0,
      lastUsed: null,
    },
  };
}

function saveUsage(data) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[usage] save error:', e.message);
  }
}

function recordGemini({ model, promptTokens = 0, candidatesTokens = 0, totalTokens = 0 }) {
  const data = loadUsage();
  const today = new Date().toISOString().slice(0, 10);
  if (data.gemini.lastDate !== today) {
    data.gemini.todayRequests = 0;
    data.gemini.lastDate = today;
  }
  data.gemini.totalRequests += 1;
  data.gemini.todayRequests += 1;
  data.gemini.totalPromptTokens += promptTokens;
  data.gemini.totalCandidatesTokens += candidatesTokens;
  data.gemini.totalTokens += (totalTokens || (promptTokens + candidatesTokens));
  data.gemini.lastUsed = new Date().toISOString();

  // コスト換算
  const promptCost = (data.gemini.totalPromptTokens / 1_000_000) * GEMINI_PRICING.inputPerMillion;
  const candCost = (data.gemini.totalCandidatesTokens / 1_000_000) * GEMINI_PRICING.outputPerMillion;
  data.gemini.estimatedCostUsd = Number((promptCost + candCost).toFixed(5));
  data.gemini.estimatedCostJpy = Math.round(data.gemini.estimatedCostUsd * USD_JPY_RATE * 100) / 100;

  // 履歴ログ (直近30件)
  if (!Array.isArray(data.gemini.history)) data.gemini.history = [];
  data.gemini.history.unshift({
    timestamp: new Date().toISOString(),
    model: model || 'gemini',
    promptTokens,
    candidatesTokens,
    totalTokens: totalTokens || (promptTokens + candidatesTokens),
  });
  if (data.gemini.history.length > 30) data.gemini.history = data.gemini.history.slice(0, 30);

  saveUsage(data);
  return data;
}

function recordSearch({ provider, count = 1 }) {
  const data = loadUsage();
  if (provider === 'tavily') {
    data.searches.tavilyTotal += count;
  } else {
    data.searches.duckduckgoTotal += count;
  }
  data.searches.lastUsed = new Date().toISOString();
  saveUsage(data);
  return data;
}

/** 次回の日次クォータ更新までの時間計算（太平洋時間 00:00 = 日本時間 16:00 または 17:00） */
function getNextQuotaReset() {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(7, 0, 0, 0); // 07:00 UTC = 16:00 JST = 00:00 PDT
  if (now.getTime() >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  const diffMs = target.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  return {
    targetISO: target.toISOString(),
    formattedTargetJST: '毎日 16:00 JST（太平洋時間 0:00）',
    remainingText: `あと約 ${diffHours}時間 ${diffMins}分`,
    hoursLeft: diffHours,
    minutesLeft: diffMins,
  };
}

/** Tavily キャッシュ・直近成功データ管理 */
let tavilyCache = {
  key: '',
  data: null,
  cachedAt: 0,
};
let lastSuccessfulTavilyUsage = null;

const TAVILY_CACHE_TTL_MS = 120000; // 2分間キャッシュ（10分10回制限回避のため）

/** テスト用キャッシュクリア関数 */
function resetTavilyCacheForTest() {
  tavilyCache = { key: '', data: null, cachedAt: 0 };
  lastSuccessfulTavilyUsage = null;
}

/** キーの安全なマスク表示作成 */
function maskApiKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••' + k.slice(-2);
  return k.slice(0, 5) + '••••••' + k.slice(-4);
}

/** Tavily 公式 API /usage エンドポイントを問い合わせ（キャッシュ・429レート制限フォールバック対応） */
async function fetchLiveTavilyUsage(apiKey, { forceRefresh = false, fetchFn = globalThis.fetch } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) {
    return {
      configured: false,
      ok: false,
      maskedKey: '',
      message: 'APIキー未設定',
      dashboardUrl: 'https://app.tavily.com/home',
    };
  }

  const now = Date.now();
  // キャッシュが有効かつ強制更新でない場合はキャッシュを即返却
  if (!forceRefresh && tavilyCache.key === key && tavilyCache.data && (now - tavilyCache.cachedAt < TAVILY_CACHE_TTL_MS)) {
    return {
      ...tavilyCache.data,
      fromCache: true,
      cachedAt: new Date(tavilyCache.cachedAt).toISOString(),
    };
  }

  try {
    const res = await fetchFn('https://api.tavily.com/usage', {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      let detailMsg = '';
      try {
        const j = await res.json();
        detailMsg = (j.detail && (j.detail.error || j.detail)) || j.error || j.message || '';
      } catch {
        /* ignore json parse failure */
      }

      // 429 Too Many Requests（Tavily /usage は 10分10回の厳格制限）
      if (res.status === 429) {
        if (lastSuccessfulTavilyUsage && lastSuccessfulTavilyUsage.key === key) {
          return {
            ...lastSuccessfulTavilyUsage.data,
            isRateLimited: true,
            fromCache: true,
            rateLimitNotice: 'Tavily利用状況APIがレート制限（10分10回）中のため、直近取得したクォータ情報を表示しています。',
          };
        }
        return {
          configured: true,
          ok: false,
          maskedKey: maskApiKey(key),
          isRateLimited: true,
          error: 'Tavily利用状況APIのレート制限（10分間に10リクエスト）にかかっています。少し時間をおいて再度お試しください。',
          dashboardUrl: 'https://app.tavily.com/home',
        };
      }

      // 401 / 403 認証エラー
      if (res.status === 401 || res.status === 403) {
        return {
          configured: true,
          ok: false,
          maskedKey: maskApiKey(key),
          error: `APIキーが無効または認証に失敗しました (${res.status})${detailMsg ? ': ' + detailMsg : ''}`,
          dashboardUrl: 'https://app.tavily.com/home',
        };
      }

      return {
        configured: true,
        ok: false,
        maskedKey: maskApiKey(key),
        error: `Tavily API エラー (${res.status})${detailMsg ? ': ' + detailMsg : ''}`,
        dashboardUrl: 'https://app.tavily.com/home',
      };
    }

    const d = await res.json();
    const acct = d.account || {};
    const keyInfo = d.key || {};
    const planUsage = Number(acct.plan_usage ?? keyInfo.usage ?? 0);
    const planLimit = Number(acct.plan_limit ?? keyInfo.limit ?? 1000);
    const remaining = Math.max(0, planLimit - planUsage);
    const pct = planLimit > 0 ? Math.min(100, Math.round((planUsage / planLimit) * 100)) : 0;

    const result = {
      configured: true,
      ok: true,
      maskedKey: maskApiKey(key),
      plan: acct.current_plan || 'Researcher',
      planUsage,
      planLimit,
      remaining,
      percent: pct,
      details: {
        search: acct.search_usage ?? keyInfo.search_usage ?? planUsage,
        crawl: acct.crawl_usage ?? keyInfo.crawl_usage ?? 0,
        extract: acct.extract_usage ?? keyInfo.extract_usage ?? 0,
        map: acct.map_usage ?? keyInfo.map_usage ?? 0,
        research: acct.research_usage ?? keyInfo.research_usage ?? 0,
      },
      renewalNotice: '毎月のアカウント更新日（月次リセット）',
      dashboardUrl: 'https://app.tavily.com/home',
      lastFetchedAt: new Date().toISOString(),
      isRateLimited: false,
    };

    // キャッシュ保存
    tavilyCache = {
      key,
      data: result,
      cachedAt: now,
    };
    lastSuccessfulTavilyUsage = {
      key,
      data: result,
    };

    return result;
  } catch (e) {
    // ネットワークエラー・タイムアウト時、既存キャッシュがあればフォールバック
    if (lastSuccessfulTavilyUsage && lastSuccessfulTavilyUsage.key === key) {
      return {
        ...lastSuccessfulTavilyUsage.data,
        fromCache: true,
        connectionNotice: `一時的な通信エラー (${e.message}) のため、直近取得したクォータ情報を表示しています。`,
      };
    }

    return {
      configured: true,
      ok: false,
      maskedKey: maskApiKey(key),
      error: `通信エラー: ${e.message}`,
      dashboardUrl: 'https://app.tavily.com/home',
    };
  }
}

/** 全体の利用状況サマリーを取得 */
async function getFullUsageSummary(settingsObj = {}, options = {}) {
  const local = loadUsage();
  const tavilyKey = settingsObj.tavilyApiKey;
  const tavilyData = await fetchLiveTavilyUsage(tavilyKey, options);
  const resetInfo = getNextQuotaReset();

  return {
    gemini: {
      configured: !!settingsObj.geminiApiKey,
      model: settingsObj.geminiModel || 'gemini-3.8-flash',
      totalRequests: local.gemini.totalRequests,
      todayRequests: local.gemini.todayRequests,
      totalPromptTokens: local.gemini.totalPromptTokens,
      totalCandidatesTokens: local.gemini.totalCandidatesTokens,
      totalTokens: local.gemini.totalTokens,
      estimatedCostUsd: local.gemini.estimatedCostUsd,
      estimatedCostJpy: local.gemini.estimatedCostJpy,
      lastUsed: local.gemini.lastUsed,
      recentCalls: (local.gemini.history || []).slice(0, 10),
      quotas: {
        rpd: '1,500 回 / 日（無料枠・Flash系）',
        rpm: '15 回 / 分（Flash系）',
        tpm: '1,000,000 トークン / 分',
        pricing: '入力: $0.075 / 100万tok (~¥0.011/千tok) / 出力: $0.30 / 100万tok (~¥0.045/千tok)',
      },
      resetInfo,
      officialUrls: {
        dashboard: 'https://aistudio.google.com/app/plan_information',
        apiKey: 'https://aistudio.google.com/apikey',
        quotas: 'https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas',
        billing: 'https://console.cloud.google.com/billing',
      },
    },
    tavily: {
      ...tavilyData,
      localTotalSearches: local.searches.tavilyTotal,
    },
    duckduckgo: {
      isUnlimited: true,
      totalSearches: local.searches.duckduckgoTotal,
      cost: '完全無料（クレジット消費なし）',
    },
    tips: [
      {
        title: '調査深度を「クイック」にする',
        desc: 'ディープ調査に比べ、検索クエリ数とAI解析トークンが約半減し、大幅にクレジットを節約できます。',
      },
      {
        title: '特定サイト巡回を活用する',
        desc: '調査範囲で「特定サイト」を指定すると、関係のないWebサイトへの不要な巡回を抑えられます。',
      },
      {
        title: '検索プロバイダを DuckDuckGo に切り替える',
        desc: 'Tavilyの月1,000件枠を温存したい場合は、API設定で「DuckDuckGo」を選択することで完全無料で調査できます。',
      },
    ],
  };
}

module.exports = {
  loadUsage,
  recordGemini,
  recordSearch,
  fetchLiveTavilyUsage,
  getNextQuotaReset,
  getFullUsageSummary,
  resetTavilyCacheForTest,
};

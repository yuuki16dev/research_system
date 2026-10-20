// @ts-check
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

/** Tavily 公式 API /usage エンドポイントをリアルタイム問い合わせ */
async function fetchLiveTavilyUsage(apiKey) {
  if (!apiKey) {
    return {
      configured: false,
      message: 'APIキー未設定',
      dashboardUrl: 'https://app.tavily.com/home',
    };
  }
  try {
    const res = await fetch('https://api.tavily.com/usage', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        error: `ステータス ${res.status}`,
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

    return {
      configured: true,
      ok: true,
      plan: acct.current_plan || 'Researcher',
      planUsage,
      planLimit,
      remaining,
      percent: pct,
      details: {
        search: acct.search_usage ?? keyInfo.search_usage ?? planUsage,
        crawl: acct.crawl_usage ?? keyInfo.crawl_usage ?? 0,
        extract: acct.extract_usage ?? keyInfo.extract_usage ?? 0,
      },
      renewalNotice: '月次更新（毎月のアカウント登録日または1日）',
      dashboardUrl: 'https://app.tavily.com/home',
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e.message,
      dashboardUrl: 'https://app.tavily.com/home',
    };
  }
}

/** 全体の利用状況サマリーを取得 */
async function getFullUsageSummary(settingsObj) {
  const local = loadUsage();
  const tavilyKey = settingsObj.tavilyApiKey;
  const tavilyData = await fetchLiveTavilyUsage(tavilyKey);
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
};

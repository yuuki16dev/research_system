'use strict';

/**
 * モデル定義および単価設定（C-2 / R-6）
 *
 * ※ 単価の既定値は仮の参考値です。AI Studio の請求画面で確認して
 *   環境変数 MODEL_PRICING_JSON / TAVILY_USD_PER_CREDIT / USD_JPY_RATE で設定してください。
 */

const env = require('./env');

// 廃止モデル一覧
const OBSOLETE_GEMINI_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

// デフォルトの既定モデル
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

// ローカル版向けのデフォルトフォールバックモデル一覧（クラウド版の既定は空）
const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
];

// モデルごとの単価設定 ($ per 1,000,000 tokens)
// 注意: 単価の値は未決定の仮値です。AI Studio の請求画面で確認して設定してください。
const MODEL_PRICING = {
  'gemini-3.8-flash': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-3.7-flash': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-3.5-flash': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-flash-latest': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
  'gemini-3.1-flash-lite': {
    inputPerMillion: 0.0375,
    outputPerMillion: 0.15,
  },
  // デフォルト（未知のモデル用フォールバック価格）
  default: {
    inputPerMillion: 0.075,
    outputPerMillion: 0.30,
  },
};

// Tavily 1クレジットあたり仮単価 (USD)
const DEFAULT_TAVILY_USD_PER_CREDIT = 0.008;
const TAVILY_USD_PER_CREDIT = DEFAULT_TAVILY_USD_PER_CREDIT;

// 為替レート（参考レート）
const DEFAULT_USD_JPY_RATE = 150;
const USD_JPY_RATE = DEFAULT_USD_JPY_RATE;

const warnedInvalidEnv = new Set();

function warnOnceInvalid(key, raw, detail) {
  const sig = `${key}=${raw}`;
  if (warnedInvalidEnv.has(sig)) return;
  warnedInvalidEnv.add(sig);
  console.warn(`[model-config] 警告: ${key} が不正な値です (${detail})。既定値を使用します`);
}

function parseNonNegativeNumber(val) {
  if (typeof val !== 'number' && (typeof val !== 'string' || !val.trim())) {
    return null;
  }
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  return num;
}

/**
 * Tavily 1クレジット単価 (USD) を取得（環境変数 TAVILY_USD_PER_CREDIT で上書き可能）
 */
function getTavilyUsdPerCredit() {
  const raw = process.env.TAVILY_USD_PER_CREDIT;
  if (raw === undefined || !String(raw).trim()) {
    return DEFAULT_TAVILY_USD_PER_CREDIT;
  }
  const num = parseNonNegativeNumber(String(raw).trim());
  if (num === null) {
    warnOnceInvalid('TAVILY_USD_PER_CREDIT', raw, '0以上の数値が必要');
    return DEFAULT_TAVILY_USD_PER_CREDIT;
  }
  return num;
}

/**
 * 為替レート (JPY/USD) を取得（環境変数 USD_JPY_RATE で上書き可能）
 */
function getUsdJpyRate() {
  const raw = process.env.USD_JPY_RATE;
  if (raw === undefined || !String(raw).trim()) {
    return DEFAULT_USD_JPY_RATE;
  }
  const num = parseNonNegativeNumber(String(raw).trim());
  if (num === null || num <= 0) {
    warnOnceInvalid('USD_JPY_RATE', raw, '0より大きい数値が必要');
    return DEFAULT_USD_JPY_RATE;
  }
  return num;
}

/**
 * 環境変数 MODEL_PRICING_JSON の上書き定義を解析
 */
function parseModelPricingOverrides() {
  const raw = process.env.MODEL_PRICING_JSON;
  if (raw === undefined || !String(raw).trim()) {
    return { overrides: {}, hasValidOverride: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnOnceInvalid('MODEL_PRICING_JSON', raw, `JSON解析失敗: ${err.message}`);
    return { overrides: {}, hasValidOverride: false };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnOnceInvalid('MODEL_PRICING_JSON', raw, 'JSONオブジェクトである必要があります');
    return { overrides: {}, hasValidOverride: false };
  }

  const overrides = {};
  let validCount = 0;

  for (const [key, val] of Object.entries(parsed)) {
    const modelKey = String(key || '').trim().toLowerCase();
    if (!modelKey || !val || typeof val !== 'object' || Array.isArray(val)) {
      warnOnceInvalid('MODEL_PRICING_JSON', raw, `エントリ "${key}" が不正です`);
      continue;
    }
    const input = parseNonNegativeNumber(val.inputPerMillion);
    const output = parseNonNegativeNumber(val.outputPerMillion);
    if (input === null || output === null) {
      warnOnceInvalid('MODEL_PRICING_JSON', raw, `エントリ "${key}" の単価が不正です`);
      continue;
    }
    overrides[modelKey] = {
      inputPerMillion: input,
      outputPerMillion: output,
    };
    validCount++;
  }

  if (validCount === 0) {
    warnOnceInvalid('MODEL_PRICING_JSON', raw, '有効なモデル単価定義が含まれていません');
    return { overrides: {}, hasValidOverride: false };
  }

  return { overrides, hasValidOverride: true };
}

/**
 * モデル単価が既定の仮値のままかどうかを返す
 */
function isUsingDefaultModelPricing() {
  const { hasValidOverride } = parseModelPricingOverrides();
  return !hasValidOverride;
}

/**
 * 実効的な既定モデル名を取得（環境変数 GEMINI_MODEL で上書き可能）
 */
function getDefaultModel() {
  const envModel = process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim();
  if (envModel && !OBSOLETE_GEMINI_MODELS.includes(envModel.toLowerCase())) {
    return envModel.toLowerCase();
  }
  return DEFAULT_GEMINI_MODEL;
}

/**
 * 切り替え先（フォールバック）モデル一覧を取得（環境変数 GEMINI_FALLBACK_MODELS で上書き可能）
 * クラウド版では既定が空であり、GEMINI_FALLBACK_MODELS が設定されたときのみ切り替える。
 * @param {string} [currentModel] 除外する現行モデル
 */
function getFallbackModels(currentModel) {
  let list = env.IS_CLOUD ? [] : DEFAULT_FALLBACK_MODELS;
  const raw = process.env.GEMINI_FALLBACK_MODELS;
  if (raw && raw.trim()) {
    list = raw
      .split(/[\r\n,;]+/)
      .map((m) => m.trim().toLowerCase())
      .filter((m) => m && !OBSOLETE_GEMINI_MODELS.includes(m));
  }
  const normCurrent = currentModel ? String(currentModel).trim().toLowerCase() : '';
  return list.filter((m) => m !== normCurrent);
}

/**
 * モデル名の正規化（廃止モデルや不正値は既定モデルへ補正）
 */
function normalizeModel(m) {
  const norm = String(m || '').toLowerCase().trim();
  if (!norm || OBSOLETE_GEMINI_MODELS.includes(norm)) {
    return getDefaultModel();
  }
  return norm;
}

/**
 * モデルごとの価格定義を取得（MODEL_PRICING_JSON による上書きを反映）
 */
function getModelPricing(modelName) {
  const norm = normalizeModel(modelName);
  const { overrides } = parseModelPricingOverrides();
  return overrides[norm] || MODEL_PRICING[norm] || overrides.default || MODEL_PRICING.default;
}

function _clearWarningsForTest() {
  warnedInvalidEnv.clear();
}

module.exports = {
  OBSOLETE_GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_FALLBACK_MODELS,
  MODEL_PRICING,
  DEFAULT_TAVILY_USD_PER_CREDIT,
  TAVILY_USD_PER_CREDIT,
  DEFAULT_USD_JPY_RATE,
  USD_JPY_RATE,
  getTavilyUsdPerCredit,
  getUsdJpyRate,
  isUsingDefaultModelPricing,
  getDefaultModel,
  getFallbackModels,
  normalizeModel,
  getModelPricing,
  _clearWarningsForTest,
};

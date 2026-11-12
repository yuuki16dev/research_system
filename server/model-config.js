'use strict';

/**
 * モデル定義および単価設定（C-2: レビュー M9、M10）
 * 
 * ※ 単価の値は仮の参考値です。AI Studio の請求画面で確認して更新してください。
 */

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

// デフォルトのフォールバックモデル一覧
const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
];

// モデルごとの単価設定 ($ per 1,000,000 tokens)
// 注意: 単価の値は未決定の仮値です。AI Studio の請求画面で確認して更新してください。
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

// 為替レート（参考レート）
const USD_JPY_RATE = 150;

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
 * @param {string} [currentModel] 除外する現行モデル
 */
function getFallbackModels(currentModel) {
  let list = DEFAULT_FALLBACK_MODELS;
  if (process.env.GEMINI_FALLBACK_MODELS) {
    const parsed = process.env.GEMINI_FALLBACK_MODELS
      .split(/[\r\n,;]+/)
      .map((m) => m.trim().toLowerCase())
      .filter((m) => m && !OBSOLETE_GEMINI_MODELS.includes(m));
    if (parsed.length > 0) {
      list = parsed;
    }
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
 * モデルごとの価格定義を取得
 */
function getModelPricing(modelName) {
  const norm = normalizeModel(modelName);
  return MODEL_PRICING[norm] || MODEL_PRICING.default;
}

module.exports = {
  OBSOLETE_GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_FALLBACK_MODELS,
  MODEL_PRICING,
  USD_JPY_RATE,
  getDefaultModel,
  getFallbackModels,
  normalizeModel,
  getModelPricing,
};


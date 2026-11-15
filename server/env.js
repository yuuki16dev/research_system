'use strict';

/**
 * 実行環境判定および Supabase 環境変数正規化ヘルパー (v2.15.0 / 指示書 A-1, A-2)
 */

/**
 * 環境変数値の前後空白および外側の引用符を除去する
 * @param {string|undefined|null} raw
 * @returns {string}
 */
function normalizeEnvValue(raw) {
  if (raw === undefined || raw === null) return '';
  let val = String(raw).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

/**
 * SUPABASE_URL の前後空白・引用符・末尾スラッシュ・誤貼り付けされた /rest/v1 を正規化する
 * @param {string|undefined|null} raw
 * @returns {string}
 */
function normalizeSupabaseUrl(raw) {
  let val = normalizeEnvValue(raw);
  if (!val) return '';
  val = val.replace(/\/+$/, '');
  val = val.replace(/\/rest\/v1$/i, '');
  return val.replace(/\/+$/, '');
}

function getSupabaseUrl() {
  return normalizeSupabaseUrl(process.env.SUPABASE_URL);
}

function getSupabaseAnonKey() {
  return normalizeEnvValue(process.env.SUPABASE_ANON_KEY);
}

function getSupabaseServiceRoleKey() {
  return normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getIsCloud() {
  return Boolean(getSupabaseUrl());
}

function getIsProduction() {
  return process.env.NODE_ENV === 'production';
}

function getTestUsersEnabled() {
  // 明示的に ENABLE_TEST_USERS=true (または 1) が設定されている場合のみ有効（既定は無効）
  return process.env.ENABLE_TEST_USERS === 'true' || process.env.ENABLE_TEST_USERS === '1';
}

const env = {
  normalizeEnvValue,
  normalizeSupabaseUrl,
  getSupabaseUrl,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  get IS_CLOUD() {
    return getIsCloud();
  },
  get IS_PRODUCTION() {
    return getIsProduction();
  },
  get TEST_USERS_ENABLED() {
    return getTestUsersEnabled();
  },
};

module.exports = env;

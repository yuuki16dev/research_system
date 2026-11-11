'use strict';

/**
 * 実行環境判定フラグ (v2.15.0 / 指示書 A-1, A-2)
 */

function getIsCloud() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_URL.trim());
}

function getIsProduction() {
  return process.env.NODE_ENV === 'production';
}

function getTestUsersEnabled() {
  const isProd = getIsProduction();
  return !isProd && (process.env.ENABLE_TEST_USERS === 'true' || process.env.NODE_ENV === 'test');
}

const env = {
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

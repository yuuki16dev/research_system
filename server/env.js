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
  // 明示的に ENABLE_TEST_USERS が設定されている場合は最優先（production でも明示的有効化を許可）
  if (process.env.ENABLE_TEST_USERS !== undefined) {
    return process.env.ENABLE_TEST_USERS === 'true' || process.env.ENABLE_TEST_USERS === '1';
  }
  // テスト実行時はデフォルトで有効
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  // 本番環境（production）では明示指定がない限りセキュリティのため無効
  if (getIsProduction()) {
    return false;
  }
  // 開発・ローカル環境ではデフォルトで有効
  return true;
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

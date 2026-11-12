'use strict';

/**
 * 履歴管理ルーター (v2.16.0 / B-2)
 *
 * - IS_CLOUD === true かつ 本番Supabase利用者（UUID）: Supabase の user_reports テーブル（server/history-cloud.js）を使用（非同期）
 * - IS_CLOUD === false または テストアカウント（user-a/user-b等）: ローカルファイル（server/history-local.js）を使用（同期）
 * - ピン留め（pinned）および更新（update）にも完全対応
 */

const env = require('./env');
const localHistory = require('./history-local');
const cloudHistory = require('./history-cloud');

const isUuid = (id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

function getDelegate(userId) {
  if (!env.IS_CLOUD) {
    return localHistory;
  }
  // テスト用アカウント（user-a, user-b, admin-user, owner-user 等）はローカルファイルで分離保持
  if (userId && typeof userId === 'string' && !isUuid(userId)) {
    return localHistory;
  }
  return cloudHistory;
}

function save(result) {
  const userId = result ? result.userId : null;
  return getDelegate(userId).save(result);
}

function list(userId = null, userPlan = 'admin', options = {}) {
  return getDelegate(userId).list(userId, userPlan, options);
}

function get(id, userId = null, userPlan = 'admin', options = {}) {
  return getDelegate(userId).get(id, userId, userPlan, options);
}

function remove(id, userId = null, userPlan = 'admin', options = {}) {
  return getDelegate(userId).remove(id, userId, userPlan, options);
}

function update(id, patch, userId = null, userPlan = 'admin', options = {}) {
  return getDelegate(userId).update(id, patch, userId, userPlan, options);
}

function togglePin(id, userId = null, userPlan = 'admin', options = {}) {
  return getDelegate(userId).togglePin(id, userId, userPlan, options);
}

function getAllForUser(userId = null, userPlan = 'admin', options = {}) {
  return getDelegate(userId).getAllForUser(userId, userPlan, options);
}

function restoreReports(reports = [], targetUserId = 'owner-user') {
  return getDelegate(targetUserId).restoreReports(reports, targetUserId);
}

module.exports = {
  save,
  list,
  get,
  remove,
  update,
  togglePin,
  getAllForUser,
  restoreReports,
  // 委譲先参照（テスト等の参照用）
  local: localHistory,
  cloud: cloudHistory,
};

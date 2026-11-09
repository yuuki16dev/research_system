'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');

const DIR = path.join(DATA_DIR, 'history');
const MAX_ITEMS = 100;
const isId = (id) => /^[0-9a-f-]{36}$/i.test(id);

function save(result) {
  if (!result || !result.id) return;
  if (!result.userId) {
    result.userId = 'owner-user';
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${result.id}.json`), JSON.stringify(result), 'utf8');
  prune();
}

/**
 * 履歴一覧の取得（ユーザーごとの分離対応）
 * @param {string|null} userId ユーザーID（nullまたは管理者は全件）
 * @param {string} userPlan プラン（'admin'は全件）
 */
function list(userId = null, userPlan = 'admin') {
  if (!fs.existsSync(DIR)) return [];
  const isAdmin = userPlan === 'admin' || !userId;

  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && isId(f.slice(0, -5)))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        // ユーザーごとのフィルタリング
        if (!isAdmin && r.userId && r.userId !== userId) {
          return null;
        }
        return {
          id: r.id,
          userId: r.userId || 'owner-user',
          theme: r.theme,
          title: r.title,
          createdAt: r.createdAt,
          mode: r.mode,
          depth: r.depth,
          scope: r.scope,
          scopeLabel: r.scopeLabel,
          period: r.period || 'year',
          periodLabel: r.periodLabel || '直近1年',
          sourceCount: (r.sources || []).length,
          pinned: !!r.pinned,
          isDeltaTracking: !!r.isDeltaTracking,
          isCrossSynthesis: !!r.isCrossSynthesis,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
}

/**
 * 単一レポートの取得
 * @param {string} id
 * @param {string|null} userId 認可チェック用（指定時、他人のレポートは拒否）
 * @param {string} userPlan
 */
function get(id, userId = null, userPlan = 'admin') {
  if (!isId(id)) return null;
  try {
    const item = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    const isAdmin = userPlan === 'admin' || !userId;
    if (!isAdmin && item.userId && item.userId !== userId) {
      return null;
    }
    return item;
  } catch {
    return null;
  }
}

/**
 * レポートの削除
 */
function remove(id, userId = null, userPlan = 'admin') {
  if (!isId(id)) return false;
  const item = get(id, userId, userPlan);
  if (!item) return false;

  try {
    fs.unlinkSync(path.join(DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

/**
 * レポートの更新
 */
function update(id, patch, userId = null, userPlan = 'admin') {
  const item = get(id, userId, userPlan);
  if (!item) return null;
  const updated = { ...item, ...patch };
  save(updated);
  return updated;
}

/**
 * ピン留めトグル
 */
function togglePin(id, userId = null, userPlan = 'admin') {
  const item = get(id, userId, userPlan);
  if (!item) return null;
  item.pinned = !item.pinned;
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(item), 'utf8');
  return item;
}

function prune() {
  const items = list(null, 'admin');
  items.slice(MAX_ITEMS).forEach((x) => remove(x.id, null, 'admin'));
}

module.exports = { save, list, get, remove, update, togglePin };

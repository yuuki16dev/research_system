'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./settings');

const DIR = path.join(DATA_DIR, 'history');
const MAX_ITEMS = 100;
const isId = (id) => /^[0-9a-f-]{36}$/i.test(id);

// B-4: 更新可能な許可フィールドホワイトリスト（id, userId, createdAt は不可変）
const ALLOWED_UPDATE_FIELDS = [
  'title',
  'subtitle',
  'summary',
  'tags',
  'pinned',
  'keyPoints',
  'metrics',
  'table',
  'sections',
  'insights',
  'deepDives',
  'theme',
  'reportTheme',
  'scope',
  'scopeLabel',
  'period',
  'periodLabel',
  'sources',
  'chart',
];

function sanitizeUpdatePatch(patch = {}) {
  const safe = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (patch[key] !== undefined) {
      safe[key] = patch[key];
    }
  }
  return safe;
}

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
 * 履歴一覧の取得（ユーザーごとの分離対応 / A-4: 未ログインは管理者扱いしない）
 * @param {string|null} userId ユーザーID
 * @param {string} userPlan プラン（'admin'は全件）
 * @param {object} options オプション（{ all: true } で明示的全件指定）
 */
function list(userId = null, userPlan = 'admin', options = {}) {
  if (!fs.existsSync(DIR)) return [];
  const isAdmin = userPlan === 'admin' || Boolean(options && options.all);
  if (!isAdmin && !userId) return [];

  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && isId(f.slice(0, -5)))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        const reportUserId = r.userId || 'owner-user';
        // ユーザーごとのフィルタリング
        if (!isAdmin && reportUserId !== userId) {
          return null;
        }
        return {
          id: r.id,
          userId: reportUserId,
          theme: r.theme,
          title: r.title,
          summary: r.summary || '',
          tags: Array.isArray(r.tags) ? r.tags : [],
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
 * @param {object} options
 */
function get(id, userId = null, userPlan = 'admin', options = {}) {
  if (!isId(id)) return null;
  const isAdmin = userPlan === 'admin' || Boolean(options && options.all);
  if (!isAdmin && !userId) return null;

  try {
    const item = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    const reportUserId = item.userId || 'owner-user';
    if (!isAdmin && reportUserId !== userId) {
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
function remove(id, userId = null, userPlan = 'admin', options = {}) {
  if (!isId(id)) return false;
  const item = get(id, userId, userPlan, options);
  if (!item) return false;

  try {
    fs.unlinkSync(path.join(DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

/**
 * レポートの更新（B-4: ホワイトリスト化＆持ち主改ざん防止）
 */
function update(id, patch, userId = null, userPlan = 'admin', options = {}) {
  const item = get(id, userId, userPlan, options);
  if (!item) return null;
  const safePatch = sanitizeUpdatePatch(patch);
  const updated = {
    ...item,
    ...safePatch,
    id: item.id, // 不可変
    userId: item.userId, // 不可変
    createdAt: item.createdAt, // 不可変
  };
  save(updated);
  return updated;
}

/**
 * ピン留めトグル
 */
function togglePin(id, userId = null, userPlan = 'admin', options = {}) {
  const item = get(id, userId, userPlan, options);
  if (!item) return null;
  item.pinned = !item.pinned;
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(item), 'utf8');
  return item;
}

function prune() {
  const items = list(null, 'admin', { all: true });
  items.slice(MAX_ITEMS).forEach((x) => remove(x.id, null, 'admin', { all: true }));
}

/**
 * ユーザーの全レポートを完全データで取得（一括バックアップ用）
 * @param {string|null} userId
 * @param {string} userPlan
 * @param {object} options
 */
function getAllForUser(userId = null, userPlan = 'admin', options = {}) {
  if (!fs.existsSync(DIR)) return [];
  const isAdmin = userPlan === 'admin' || Boolean(options && options.all);
  if (!isAdmin && !userId) return [];

  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && isId(f.slice(0, -5)))
    .map((f) => {
      try {
        const item = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        const reportUserId = item.userId || 'owner-user';
        if (!isAdmin && reportUserId !== userId) {
          return null;
        }
        return item;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * レポートの一括復元（バックアップからのリストア用 / B-4: ID重複時新UUID採番＆サイズ・件数上限）
 * @param {Array<Object>} reports
 * @param {string} targetUserId
 */
function restoreReports(reports = [], targetUserId = 'owner-user') {
  if (!Array.isArray(reports)) return { restored: 0, skipped: 0 };
  let restored = 0;
  let skipped = 0;

  // 1回最大50件に制限
  const targets = reports.slice(0, 50);
  if (reports.length > 50) {
    skipped += reports.length - 50;
  }

  fs.mkdirSync(DIR, { recursive: true });

  for (const r of targets) {
    if (!r || typeof r !== 'object' || !r.id || !isId(r.id)) {
      skipped++;
      continue;
    }

    // 1件あたり1MB上限（JSONサイズ）
    let jsonStr = '';
    try {
      jsonStr = JSON.stringify(r);
      if (Buffer.byteLength(jsonStr, 'utf8') > 1048576) {
        skipped++;
        continue;
      }
    } catch {
      skipped++;
      continue;
    }

    // 既存IDと重複する場合は他人のデータ上書き防止のため新規UUIDを採番
    let finalId = r.id;
    const existingFile = path.join(DIR, `${finalId}.json`);
    if (fs.existsSync(existingFile)) {
      finalId = crypto.randomUUID();
    }

    const cloned = {
      ...r,
      id: finalId,
      userId: targetUserId || 'owner-user',
    };

    try {
      fs.writeFileSync(path.join(DIR, `${cloned.id}.json`), JSON.stringify(cloned), 'utf8');
      restored++;
    } catch {
      skipped++;
    }
  }

  prune();
  return { restored, skipped };
}

module.exports = { save, list, get, remove, update, togglePin, getAllForUser, restoreReports };


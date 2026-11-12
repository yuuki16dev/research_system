'use strict';

/**
 * クラウド環境（Supabase）向けリサーチ履歴管理モジュール (v2.16.0 / B-2)
 *
 * - すべての REST 問い合わせに user_id=eq.<利用者ID> を必須付与（完全なテナント分離）
 * - 利用者ごとの件数上限（HISTORY_MAX_PER_USER、既定 100件）管理と古いレポートの自動削除
 * - 利用者ごとの保持期間（HISTORY_RETENTION_DAYS、既定 0 = 無期限）管理
 * - サービスロール（SUPABASE_SERVICE_ROLE_KEY）を用いた安全なデータベース操作
 */

const crypto = require('crypto');

const isId = (id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);

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

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
}

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
}

function getMaxItemsPerUser() {
  const val = parseInt(process.env.HISTORY_MAX_PER_USER, 10);
  return Number.isFinite(val) && val > 0 ? val : 100;
}

function getRetentionDays() {
  const val = parseInt(process.env.HISTORY_RETENTION_DAYS, 10);
  return Number.isFinite(val) && val > 0 ? val : 0;
}

async function requestSupabase(path, options = {}) {
  const baseUrl = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();
  if (!baseUrl || !serviceKey) {
    throw new Error('Supabase URL or Service Role Key is missing in cloud mode');
  }

  const url = `${baseUrl}${path}`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal || AbortSignal.timeout(8000),
  });

  return res;
}

/**
 * レポート保存 (UPSERT)
 * @param {Object} result
 */
async function save(result) {
  if (!result || !result.id || !isId(result.id)) return;
  const userId = result.userId;
  if (!userId) {
    throw new Error('user_id is required to save report in cloud mode');
  }

  const maxItems = getMaxItemsPerUser();

  // 1. 利用者ごとの件数管理と Prune
  try {
    const listRes = await requestSupabase(
      `/rest/v1/user_reports?user_id=eq.${encodeURIComponent(userId)}&select=id,pinned,created_at&order=pinned.asc,created_at.asc`
    );
    if (listRes.ok) {
      const rows = await listRes.json();
      if (Array.isArray(rows) && rows.length >= maxItems) {
        // 現在保存しようとしている ID が既に存在するか確認
        const alreadyExists = rows.some((r) => r.id === result.id);
        if (!alreadyExists) {
          const excessCount = rows.length - maxItems + 1;
          const toDelete = rows.slice(0, excessCount).map((r) => r.id);
          if (toDelete.length > 0) {
            const inList = toDelete.map((id) => `"${id}"`).join(',');
            await requestSupabase(
              `/rest/v1/user_reports?user_id=eq.${encodeURIComponent(userId)}&id=in.(${inList})`,
              { method: 'DELETE' }
            );
          }
        }
      }
    }
  } catch (err) {
    console.warn('[history-cloud] Prune error:', err.message);
  }

  // 2. レポートの保存 (UPSERT)
  const nowIso = new Date().toISOString();
  const payload = {
    id: result.id,
    user_id: userId,
    theme: result.theme || result.title || '無題',
    title: result.title || result.theme || '無題',
    purpose: result.purpose || result.style || null,
    period: result.period || null,
    pinned: Boolean(result.pinned),
    report_json: result,
    created_at: result.createdAt || nowIso,
    updated_at: nowIso,
  };

  const res = await requestSupabase('/rest/v1/user_reports', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates',
    },
    body: payload,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to save report to Supabase: ${res.status} ${text}`);
  }
}

/**
 * 履歴一覧の取得
 * @param {string|null} userId ユーザーID (必須)
 * @param {string} userPlan
 * @param {Object} options
 */
async function list(userId = null, userPlan = 'admin', options = {}) {
  if (!userId) return [];

  const retentionDays = getRetentionDays();
  let retentionQuery = '';
  if (retentionDays > 0) {
    const cutoffDate = new Date(Date.now() - retentionDays * 86400000);
    const cutoffIso = cutoffDate.toISOString();
    retentionQuery = `&created_at=gte.${encodeURIComponent(cutoffIso)}`;

    // 期限切れレコードの非同期削除（バックグラウンドで実施）
    requestSupabase(
      `/rest/v1/user_reports?user_id=eq.${encodeURIComponent(userId)}&created_at=lt.${encodeURIComponent(cutoffIso)}&pinned=eq.false`,
      { method: 'DELETE' }
    ).catch((err) => console.warn('[history-cloud] retention cleanup error:', err.message));
  }

  const res = await requestSupabase(
    `/rest/v1/user_reports?user_id=eq.${encodeURIComponent(userId)}${retentionQuery}&order=pinned.desc,created_at.desc&select=id,user_id,theme,title,purpose,period,pinned,created_at,report_json`
  );

  if (!res.ok) {
    console.warn('[history-cloud] list error:', res.status);
    return [];
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows.map((r) => {
    const j = r.report_json || {};
    return {
      id: r.id,
      userId: r.user_id,
      theme: r.theme,
      title: r.title,
      summary: j.summary || '',
      tags: Array.isArray(j.tags) ? j.tags : [],
      createdAt: r.created_at,
      mode: j.mode,
      depth: j.depth,
      scope: j.scope,
      scopeLabel: j.scopeLabel,
      period: r.period || j.period || 'year',
      periodLabel: j.periodLabel || '直近1年',
      sourceCount: (j.sources || []).length,
      pinned: Boolean(r.pinned),
      isDeltaTracking: Boolean(j.isDeltaTracking),
      isCrossSynthesis: Boolean(j.isCrossSynthesis),
    };
  });
}

/**
 * 単一レポートの取得
 * @param {string} id
 * @param {string|null} userId ユーザーID (必須)
 * @param {string} userPlan
 * @param {Object} options
 */
async function get(id, userId = null, userPlan = 'admin', options = {}) {
  if (!userId || !isId(id)) return null;

  const res = await requestSupabase(
    `/rest/v1/user_reports?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,theme,title,purpose,period,pinned,created_at,updated_at,report_json`
  );

  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const row = rows[0];
  const report = row.report_json || {};
  report.id = row.id;
  report.userId = row.user_id;
  report.pinned = Boolean(row.pinned);
  report.createdAt = row.created_at;
  return report;
}

/**
 * レポートの削除
 * @param {string} id
 * @param {string|null} userId ユーザーID (必須)
 * @param {string} userPlan
 * @param {Object} options
 */
async function remove(id, userId = null, userPlan = 'admin', options = {}) {
  if (!userId || !isId(id)) return false;

  const res = await requestSupabase(
    `/rest/v1/user_reports?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        Prefer: 'return=representation',
      },
    }
  );

  if (!res.ok) return false;
  const deleted = await res.json();
  return Array.isArray(deleted) && deleted.length > 0;
}

/**
 * レポートの更新
 * @param {string} id
 * @param {Object} patch
 * @param {string|null} userId
 * @param {string} userPlan
 * @param {Object} options
 */
async function update(id, patch = {}, userId = null, userPlan = 'admin', options = {}) {
  if (!userId || !isId(id)) return null;

  const current = await get(id, userId, userPlan, options);
  if (!current) return null;

  const safePatch = sanitizeUpdatePatch(patch);
  const updatedJson = { ...current, ...safePatch };
  // 識別子と持ち主と作成日時は不変
  updatedJson.id = current.id;
  updatedJson.userId = userId;
  updatedJson.createdAt = current.createdAt;

  const nowIso = new Date().toISOString();
  const updatePayload = {
    report_json: updatedJson,
    updated_at: nowIso,
  };

  if (safePatch.theme) updatePayload.theme = safePatch.theme;
  if (safePatch.title) updatePayload.title = safePatch.title;
  if (safePatch.purpose) updatePayload.purpose = safePatch.purpose;
  if (safePatch.period) updatePayload.period = safePatch.period;
  if (safePatch.pinned !== undefined) {
    updatePayload.pinned = Boolean(safePatch.pinned);
    updatedJson.pinned = updatePayload.pinned;
  }

  const res = await requestSupabase(
    `/rest/v1/user_reports?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        Prefer: 'return=representation',
      },
      body: updatePayload,
    }
  );

  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return updatedJson;
}

/**
 * ピン留めトグル
 * @param {string} id
 * @param {string|null} userId
 * @param {string} userPlan
 * @param {Object} options
 */
async function togglePin(id, userId = null, userPlan = 'admin', options = {}) {
  if (!userId || !isId(id)) return null;

  const current = await get(id, userId, userPlan, options);
  if (!current) return null;

  const nextPinned = !current.pinned;
  return await update(id, { pinned: nextPinned }, userId, userPlan, options);
}

/**
 * ユーザーの全レポートを完全データで取得（一括バックアップ用）
 * @param {string|null} userId
 * @param {string} userPlan
 * @param {Object} options
 */
async function getAllForUser(userId = null, userPlan = 'admin', options = {}) {
  if (!userId) return [];

  const res = await requestSupabase(
    `/rest/v1/user_reports?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&select=id,user_id,pinned,created_at,report_json`
  );

  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const report = row.report_json || {};
    report.id = row.id;
    report.userId = row.user_id;
    report.pinned = Boolean(row.pinned);
    report.createdAt = row.created_at;
    return report;
  });
}

/**
 * レポートの一括復元（バックアップからのリストア用 / B-4: ID重複時新UUID採番＆サイズ・件数上限）
 * @param {Array<Object>} reports
 * @param {string} targetUserId
 */
async function restoreReports(reports = [], targetUserId) {
  if (!targetUserId || !Array.isArray(reports)) return { restored: 0, skipped: 0 };
  let restored = 0;
  let skipped = 0;

  // 1回最大50件に制限
  const targets = reports.slice(0, 50);
  if (reports.length > 50) {
    skipped += reports.length - 50;
  }

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

    try {
      // 既存IDと重複するか確認（他人のデータ上書き防止）
      let finalId = r.id;
      const checkRes = await requestSupabase(
        `/rest/v1/user_reports?id=eq.${encodeURIComponent(finalId)}&select=id`
      );
      if (checkRes.ok) {
        const rows = await checkRes.json();
        if (Array.isArray(rows) && rows.length > 0) {
          finalId = crypto.randomUUID();
        }
      }

      const cloned = {
        ...r,
        id: finalId,
        userId: targetUserId,
      };
      await save(cloned);
      restored++;
    } catch {
      skipped++;
    }
  }

  return { restored, skipped };
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
  // テスト検証用ヘルパー
  getMaxItemsPerUser,
  getRetentionDays,
};


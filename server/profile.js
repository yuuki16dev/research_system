'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./env');
const { DATA_DIR } = require('./settings');

const DIR = path.join(DATA_DIR, 'profiles');
const isUuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

let warnedMissingColumn = false;

function safeLocalFilename(uid) {
  const clean = String(uid || 'owner-user').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `${clean || 'owner-user'}.json`;
}

function defaultProfile(uid) {
  return {
    userId: uid,
    displayName: '',
    avatar: '👤',
    defaultPurpose: 'general',
    defaultTheme: 'corporate-blue',
    updatedAt: null,
  };
}

function normalizeProfile(uid, raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    userId: uid,
    displayName: typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 50) : '',
    avatar: typeof data.avatar === 'string' && data.avatar.trim() ? data.avatar.trim().slice(0, 10) : '👤',
    defaultPurpose: typeof data.defaultPurpose === 'string' && data.defaultPurpose ? data.defaultPurpose : 'general',
    defaultTheme: typeof data.defaultTheme === 'string' && data.defaultTheme ? data.defaultTheme : 'corporate-blue',
    updatedAt: data.updatedAt || null,
  };
}

function applyProfilePatch(current, patch = {}) {
  const p = patch && typeof patch === 'object' ? patch : {};
  return {
    ...current,
    displayName: typeof p.displayName === 'string' ? p.displayName.trim().slice(0, 50) : current.displayName,
    avatar: typeof p.avatar === 'string' && p.avatar.trim() ? p.avatar.trim().slice(0, 10) : current.avatar,
    defaultPurpose: typeof p.defaultPurpose === 'string' && p.defaultPurpose ? p.defaultPurpose : current.defaultPurpose,
    defaultTheme: typeof p.defaultTheme === 'string' && p.defaultTheme ? p.defaultTheme : current.defaultTheme,
    updatedAt: new Date().toISOString(),
  };
}

function warnMissingProfileColumnOnce() {
  if (warnedMissingColumn) return;
  warnedMissingColumn = true;
  console.warn(
    '[profile] profiles.profile_settings 列が未適用です。supabase/migrations/20261126_profile_settings.sql（または all_in_one.sql）を適用するまで一時的にローカルフォールバックします。'
  );
}

/**
 * ユーザープロフィールの同期取得（ローカル版・テストアカウント向け）
 * @param {string} userId
 */
function getProfile(userId = 'owner-user') {
  const uid = userId || 'owner-user';
  const file = path.join(DIR, safeLocalFilename(uid));
  if (!fs.existsSync(file)) {
    return defaultProfile(uid);
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeProfile(uid, data);
  } catch {
    return defaultProfile(uid);
  }
}

/**
 * ユーザープロフィールの同期更新（ローカル版・テストアカウント向け）
 * @param {string} userId
 * @param {Object} patch
 */
function updateProfile(userId = 'owner-user', patch = {}) {
  const uid = userId || 'owner-user';
  fs.mkdirSync(DIR, { recursive: true });
  const current = getProfile(uid);
  const updated = applyProfilePatch(current, patch);
  fs.writeFileSync(path.join(DIR, safeLocalFilename(uid)), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

function shouldUseCloudProfile(uid) {
  return Boolean(env.IS_CLOUD && isUuid(uid) && env.getSupabaseUrl() && env.getSupabaseServiceRoleKey());
}

/**
 * ユーザープロフィールの非同期取得（クラウド本番は Supabase profiles.profile_settings を参照）
 * @param {string} userId
 * @returns {Promise<Object>}
 */
async function getProfileAsync(userId = 'owner-user') {
  const uid = userId || 'owner-user';
  if (!shouldUseCloudProfile(uid)) {
    return getProfile(uid);
  }

  const baseUrl = env.getSupabaseUrl();
  const serviceKey = env.getSupabaseServiceRoleKey();
  try {
    const res = await fetch(
      `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}&select=profile_settings&limit=1`,
      {
        headers: env.buildSupabaseHeaders(serviceKey),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      return normalizeProfile(uid, row && row.profile_settings);
    }
    const errText = await res.text().catch(() => '');
    if (res.status === 400 && (errText.includes('42703') || errText.includes('profile_settings'))) {
      warnMissingProfileColumnOnce();
      return getProfile(uid);
    }
    console.warn(`[profile] Supabase getProfile warning (${res.status}): ${errText.slice(0, 200)}`);
    return defaultProfile(uid);
  } catch (err) {
    console.warn('[profile] Supabase getProfile error:', err.message);
    return defaultProfile(uid);
  }
}

/**
 * ユーザープロフィールの非同期更新（クラウド本番は Supabase profiles.profile_settings へ永続化）
 * @param {string} userId
 * @param {Object} patch
 * @returns {Promise<Object>}
 */
async function updateProfileAsync(userId = 'owner-user', patch = {}) {
  const uid = userId || 'owner-user';
  if (!shouldUseCloudProfile(uid)) {
    return updateProfile(uid, patch);
  }

  const current = await getProfileAsync(uid);
  const updated = applyProfilePatch(current, patch);
  const baseUrl = env.getSupabaseUrl();
  const serviceKey = env.getSupabaseServiceRoleKey();

  const res = await fetch(
    `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      headers: env.buildSupabaseHeaders(serviceKey, {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify({
        profile_settings: {
          displayName: updated.displayName,
          avatar: updated.avatar,
          defaultPurpose: updated.defaultPurpose,
          defaultTheme: updated.defaultTheme,
          updatedAt: updated.updatedAt,
        },
        updated_at: updated.updatedAt,
      }),
      signal: AbortSignal.timeout(6000),
    }
  );

  if (res.ok) {
    const rows = await res.json().catch(() => null);
    const saved = Array.isArray(rows) && rows[0] ? rows[0].profile_settings : updated;
    return normalizeProfile(uid, saved);
  }

  const errText = await res.text().catch(() => '');
  if (res.status === 400 && (errText.includes('42703') || errText.includes('profile_settings'))) {
    warnMissingProfileColumnOnce();
    return updateProfile(uid, patch);
  }

  throw new Error(`プロフィールの保存に失敗しました (HTTP ${res.status})`);
}

/**
 * ローカル保存のプロフィールファイルを削除（退会時のクリーンアップ用）
 * @param {string} userId
 */
function deleteLocalProfile(userId) {
  if (!userId) return;
  try {
    const file = path.join(DIR, safeLocalFilename(userId));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
}

module.exports = {
  getProfile,
  updateProfile,
  getProfileAsync,
  updateProfileAsync,
  deleteLocalProfile,
};

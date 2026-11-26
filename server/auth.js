'use strict';

/**
 * ユーザー認証＆デュアルモード（テストアカウント / Supabase / ローカル）ミドルウェア (v2.12.0)
 *
 * 1. プリセット・テストアカウント（user-a@test.local, user-b@test.local, admin@test.local）を即座に利用可能
 * 2. 新規テストアカウントの即時サインアップ＆ログイン対応
 * 3. SUPABASE_URL 設定時は本番 Supabase Auth へシームレスに連携
 * 4. ユーザーごとのリサーチ履歴・月間クォータ分離に対応
 */

const crypto = require('crypto');
const env = require('./env');

function isAuthRequired() {
  if (env.IS_CLOUD) {
    return process.env.ALLOW_ANONYMOUS_CLOUD !== 'true';
  }
  return process.env.ENABLE_AUTH === 'true';
}

const getSupabaseUrl = env.getSupabaseUrl;
const getSupabaseAnonKey = env.getSupabaseAnonKey;
const getSupabaseServiceRoleKey = env.getSupabaseServiceRoleKey;

// プロファイルキャッシュ（利用者ID -> { plan, subscriptionStatus, expiresAt }）60秒TTL (B-1)
const profileCache = new Map();
const MAX_PROFILE_CACHE_SIZE = 1000;

function clearProfileCache() {
  profileCache.clear();
}

function setProfileCache(userId, entry) {
  if (profileCache.size >= MAX_PROFILE_CACHE_SIZE) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey !== undefined) profileCache.delete(oldestKey);
  }
  profileCache.set(userId, entry);
}

async function getProfileFromSupabase(userId) {
  const now = Date.now();
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    return { plan: 'free', subscriptionStatus: 'active', expiresAt: now + 60000 };
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,subscription_status`, {
      headers: env.buildSupabaseHeaders(serviceKey),
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const item = {
          plan: rows[0].plan || 'free',
          subscriptionStatus: rows[0].subscription_status || 'active',
          expiresAt: now + 60000,
        };
        setProfileCache(userId, item);
        return item;
      }
      return { plan: 'free', subscriptionStatus: 'active', expiresAt: now + 60000 };
    }
  } catch (err) {
    console.warn('[auth] Failed to fetch profile from Supabase:', err.message);
  }

  // 一時障害時はキャッシュせず次回リクエストで再取得できるようにする
  return { plan: 'free', subscriptionStatus: 'active', expiresAt: now + 60000 };
}

// プリセットのテストアカウント一覧
const PRESET_TEST_USERS = [
  {
    id: 'user-a',
    email: 'user-a@test.local',
    password: 'password123',
    plan: 'free',
    role: 'authenticated',
  },
  {
    id: 'user-b',
    email: 'user-b@test.local',
    password: 'password123',
    plan: 'free',
    role: 'authenticated',
  },
  {
    id: 'user-std',
    email: 'standard@test.local',
    password: 'standardpass',
    plan: 'standard',
    role: 'authenticated',
  },
  {
    id: 'admin-user',
    email: 'admin@test.local',
    password: 'adminpassword',
    plan: 'admin',
    role: 'authenticated',
  },
];

// サインアップで作成された追加テストユーザーのメモリ保持
const customTestUsers = new Map();

function findTestUserByEmail(email) {
  if (!env.TEST_USERS_ENABLED) return null;
  const normEmail = String(email || '').trim().toLowerCase();
  const preset = PRESET_TEST_USERS.find((u) => u.email.toLowerCase() === normEmail);
  if (preset) return preset;
  return customTestUsers.get(normEmail) || null;
}

function findTestUserById(id) {
  if (!env.TEST_USERS_ENABLED) return null;
  const preset = PRESET_TEST_USERS.find((u) => u.id === id);
  if (preset) return preset;
  for (const u of customTestUsers.values()) {
    if (u.id === id) return u;
  }
  return null;
}

/**
 * Bearer トークンからユーザー情報を取得（テストトークンまたは Supabase トークン）
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function verifyToken(token) {
  if (!token) return null;

  // テストアカウントのトークン形式: test-token-<userId> (TEST_USERS_ENABLED が真のときのみ有効)
  if (env.TEST_USERS_ENABLED && token.startsWith('test-token-')) {
    const userId = token.slice('test-token-'.length);
    const u = findTestUserById(userId);
    if (u) {
      return {
        id: u.id,
        email: u.email,
        plan: u.plan,
        role: u.role || 'authenticated',
        isTestUser: true,
      };
    }
  }

  // Supabase JWT トークンの検証 (B-1: profiles テーブルからプラン判定)
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (env.IS_CLOUD && anonKey) {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.id) return null;

      // profiles テーブルから plan と subscription_status を取得 (B-1)
      const profile = await getProfileFromSupabase(data.id);
      let plan = profile.plan || 'free';

      // クラウド版の管理者制限: ADMIN_USER_IDS に含まれるUUIDのみ admin、それ以外は free 扱い (B-1)
      const adminUserIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (adminUserIds.includes(data.id)) {
        plan = 'admin';
      } else if (plan === 'admin') {
        plan = 'free';
      }

      return {
        id: data.id,
        email: data.email,
        plan,
        subscription_status: profile.subscriptionStatus || 'active',
        role: data.role || 'authenticated',
        isTestUser: false,
      };
    } catch (err) {
      console.warn('[auth] Supabase token verification failed:', err.message);
      return null;
    }
  }

  return null;
}

/**
 * 認証不要モード時に付与する匿名/ローカルユーザーオブジェクトを生成
 */
function buildAnonymousUser() {
  const isCloudAnon = Boolean(env.IS_CLOUD);
  return {
    id: 'owner-user',
    email: isCloudAnon ? 'anonymous@cloud.local' : 'owner@local',
    role: 'authenticated',
    plan: isCloudAnon ? 'free' : 'admin',
    isLocal: !isCloudAnon,
    isAnonymousCloud: isCloudAnon,
  };
}

/**
 * 認証ミドルウェア（必須）
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (match) {
    const user = await verifyToken(match[1]);
    if (user) {
      req.user = user;
      req.user.isLocal = false;
      return next();
    }
  }

  // 認証不要モード（ローカル既定、またはクラウド環境で ALLOW_ANONYMOUS_CLOUD=true の場合のみ）
  if (!isAuthRequired()) {
    req.user = buildAnonymousUser();
    return next();
  }

  return res.status(401).json({
    error: '認証が必要です。ログインしてから再度お試しください。',
    code: 'UNAUTHORIZED',
  });
}

/**
 * 認証ミドルウェア（任意：ログインしていればユーザー情報を付与、未ログインでも通過）
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (match) {
    const user = await verifyToken(match[1]);
    if (user) {
      req.user = user;
      req.user.isLocal = false;
      return next();
    }
  }

  if (!isAuthRequired()) {
    req.user = buildAnonymousUser();
    return next();
  }

  req.user = null;
  next();
}

const AUTH_UNAVAILABLE_MESSAGE = '認証サーバーに接続できませんでした。しばらくしてから再度お試しください';

function createAuthError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function postSupabaseAuth(endpoint, anonKey, payload, authFailureMessage, clientStatus) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.error('[auth] Supabase auth connection error:', err?.message || err);
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    if (res.status >= 500 || !res.ok) {
      console.error('[auth] Supabase auth invalid response:', res.status, err?.message || err);
      throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
    }
    throw createAuthError(authFailureMessage, clientStatus);
  }

  if (res.status >= 500) {
    console.error('[auth] Supabase auth server error:', res.status, data?.msg || data?.message || '');
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }

  if (!res.ok) {
    throw createAuthError(
      data?.error_description || data?.msg || data?.message || authFailureMessage,
      clientStatus
    );
  }

  return data;
}

/**
 * 新規ユーザー登録（テスト環境または Supabase）
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>}
 */
async function signupUser(email, password) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail || !password || String(password).length < 8) {
    throw createAuthError('有効なメールアドレスと8文字以上のパスワードを入力してください', 400);
  }

  // 既存テストアカウントとの重複チェック (TEST_USERS_ENABLED 有効時のみ)
  if (env.TEST_USERS_ENABLED && findTestUserByEmail(normEmail)) {
    throw createAuthError('このメールアドレスは既に登録されています', 400);
  }

  // テストアカウント（@test.local）の場合はSupabase未設定でも即時作成 (TEST_USERS_ENABLED 有効時のみ)
  if (env.TEST_USERS_ENABLED && normEmail.endsWith('@test.local')) {
    const newId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const userObj = {
      id: newId,
      email: normEmail,
      password: String(password),
      plan: 'free',
      role: 'authenticated',
    };
    customTestUsers.set(normEmail, userObj);

    return {
      access_token: `test-token-${newId}`,
      token_type: 'bearer',
      user: {
        id: newId,
        email: normEmail,
        plan: 'free',
        role: 'authenticated',
      },
    };
  }

  // Supabase が未設定の場合のエラー通知
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!env.IS_CLOUD || !anonKey) {
    throw createAuthError(
      'クラウド認証（Supabase）が設定されていません。' + (env.TEST_USERS_ENABLED ? '検証用のテストアカウント（@test.local）をご利用ください。' : ''),
      400
    );
  }

  // Supabase Auth へプロキシ (B-1: data.plan を送信しない)
  return postSupabaseAuth(
    `${supabaseUrl}/auth/v1/signup`,
    anonKey,
    { email: normEmail, password },
    'ユーザー登録に失敗しました',
    400
  );
}

/**
 * メール・パスワードログイン（テストアカウントまたは Supabase）
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>}
 */
async function loginUser(email, password) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail || !password) {
    throw createAuthError('メールアドレスとパスワードを入力してください', 400);
  }

  // 1. テストユーザーの照合 (TEST_USERS_ENABLED 有効時のみ)
  if (env.TEST_USERS_ENABLED) {
    const testUser = findTestUserByEmail(normEmail);
    if (testUser) {
      if (testUser.password === password) {
        return {
          access_token: `test-token-${testUser.id}`,
          token_type: 'bearer',
          user: {
            id: testUser.id,
            email: testUser.email,
            plan: testUser.plan,
            role: testUser.role,
          },
        };
      } else {
        throw createAuthError('メールアドレスまたはパスワードが正しくありません', 401);
      }
    }
  }

  // 2. Supabase Auth での認証
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!env.IS_CLOUD || !anonKey) {
    throw createAuthError(
      'クラウド認証（Supabase）が設定されていません。' + (env.TEST_USERS_ENABLED ? '検証用のテストアカウント（@test.local）をご利用ください。' : ''),
      401
    );
  }

  return postSupabaseAuth(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    anonKey,
    { email: normEmail, password },
    'メールアドレスまたはパスワードが正しくありません',
    401
  );
}

/* ------------------------------------------- S-3: Turnstile / Reset / Delete */

const isUuid = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

function getTurnstileSiteKey() {
  return env.normalizeEnvValue(process.env.TURNSTILE_SITE_KEY);
}

function getTurnstileSecretKey() {
  return env.normalizeEnvValue(process.env.TURNSTILE_SECRET_KEY);
}

function isTurnstileEnabled() {
  return Boolean(env.IS_CLOUD && getTurnstileSiteKey() && getTurnstileSecretKey());
}

/**
 * Cloudflare Turnstile トークンを検証する（未設定時はスキップ）
 * @param {string} token
 * @param {string} [remoteIp]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
async function verifyTurnstileToken(token, remoteIp = '') {
  if (!isTurnstileEnabled()) {
    return { ok: true, skipped: true };
  }
  const cleanToken = typeof token === 'string' ? token.trim() : '';
  if (!cleanToken) {
    return { ok: false, error: 'ボット対策認証（Turnstile）を完了してから登録してください' };
  }
  const verifyUrl = env.normalizeEnvValue(process.env.TURNSTILE_VERIFY_URL) ||
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';

  try {
    const body = new URLSearchParams({
      secret: getTurnstileSecretKey(),
      response: cleanToken,
    });
    if (remoteIp) body.append('remoteip', String(remoteIp).trim());

    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[auth] Turnstile verification HTTP error:', res.status);
      return { ok: false, error: 'ボット対策認証の確認に失敗しました。しばらくしてから再度お試しください' };
    }
    const data = await res.json();
    if (data && data.success === true) {
      return { ok: true };
    }
    return { ok: false, error: 'ボット対策認証に失敗しました。もう一度チェックを入れてお試しください' };
  } catch (err) {
    console.error('[auth] Turnstile verification exception:', err.message);
    return { ok: false, error: 'ボット対策認証サーバーに接続できませんでした。しばらくしてから再度お試しください' };
  }
}

/**
 * パスワード再設定メールを送信する（メールアドレス存在有無は秘匿）
 * @param {string} email
 * @param {string} [redirectTo]
 * @returns {Promise<{ ok: boolean }>}
 */
async function requestPasswordReset(email, redirectTo = '') {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
    throw createAuthError('有効なメールアドレスを入力してください', 400);
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!env.IS_CLOUD || !supabaseUrl || !anonKey) {
    throw createAuthError('クラウド認証（Supabase）が設定されていないため、パスワード再設定は利用できません', 400);
  }

  let endpoint = `${supabaseUrl}/auth/v1/recover`;
  if (redirectTo && /^https?:\/\//i.test(redirectTo)) {
    endpoint += `?redirect_to=${encodeURIComponent(redirectTo)}`;
  }

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
      },
      body: JSON.stringify({ email: normEmail }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.error('[auth] Supabase recover connection error:', err?.message || err);
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }

  if (res.status >= 500) {
    console.error('[auth] Supabase recover server error:', res.status);
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }
  if (res.status === 429) {
    throw createAuthError('再設定メールの送信回数上限に達しました。しばらく時間をおいて再試行してください', 429);
  }

  // アカウント存在推測（Enumeration）を防ぐため、400系含め一律成功として扱う
  return { ok: true };
}

/**
 * リカバリートークンまたはログイン中トークンで新しいパスワードを設定する
 * @param {string} accessToken
 * @param {string} newPassword
 * @returns {Promise<{ ok: boolean }>}
 */
async function updatePasswordWithToken(accessToken, newPassword) {
  const cleanToken = String(accessToken || '').trim();
  if (!cleanToken) {
    throw createAuthError('認証トークンが見つかりません。再設定リンクをもう一度開いてください', 401);
  }
  if (!newPassword || String(newPassword).length < 8) {
    throw createAuthError('新しいパスワードは8文字以上で設定してください', 400);
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!env.IS_CLOUD || !supabaseUrl || !anonKey) {
    throw createAuthError('クラウド認証（Supabase）が設定されていません', 400);
  }

  let res;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${cleanToken}`,
      },
      body: JSON.stringify({ password: String(newPassword) }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.error('[auth] Supabase update password connection error:', err?.message || err);
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }

  if (res.status >= 500) {
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw createAuthError(
      (data && (data.msg || data.message || data.error_description)) || 'パスワードの更新に失敗しました（リンクの有効期限切れの可能性があります）',
      res.status === 401 || res.status === 403 ? 401 : 400
    );
  }

  return { ok: true };
}

/**
 * クラウドユーザーの退会（関連データ削除・原価ログ匿名化・Authユーザー削除）
 * @param {string} userId
 * @returns {Promise<{ ok: boolean }>}
 */
async function deleteAccount(userId) {
  if (!env.IS_CLOUD) {
    throw createAuthError('ローカル版ではアカウント削除は不要です', 400);
  }
  const uid = String(userId || '').trim();
  if (!isUuid(uid)) {
    throw createAuthError('このアカウントは削除対象外です（テスト・匿名アカウント）', 400);
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }

  const headers = env.buildSupabaseHeaders(serviceKey, { 'Content-Type': 'application/json' });

  // 1. usage_events の利用者IDを匿名化（日次原価集計を壊さずに個人紐付けを除去）
  try {
    await fetch(`${supabaseUrl}/rest/v1/usage_events?user_id=eq.${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ user_id: 'deleted-user' }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.warn('[auth] deleteAccount usage_events anonymize warning:', err.message);
  }

  // 2. 関連テーブルの明示削除（ON DELETE CASCADE と二重防御）
  for (const target of [
    `/rest/v1/user_reports?user_id=eq.${encodeURIComponent(uid)}`,
    `/rest/v1/research_usage?user_id=eq.${encodeURIComponent(uid)}`,
    `/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`,
  ]) {
    try {
      await fetch(`${supabaseUrl}${target}`, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(6000),
      });
    } catch (err) {
      console.warn(`[auth] deleteAccount table cleanup warning (${target}):`, err.message);
    }
  }

  // 3. Supabase Auth 本体からユーザーを削除（必須・失敗時はエラー返却）
  let delRes;
  try {
    delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[auth] deleteAccount admin delete connection error:', err.message);
    throw createAuthError(AUTH_UNAVAILABLE_MESSAGE, 503);
  }

  if (!delRes.ok && delRes.status !== 404) {
    const errText = await delRes.text().catch(() => '');
    console.error(`[auth] deleteAccount failed (HTTP ${delRes.status}): ${errText.slice(0, 200)}`);
    throw createAuthError('アカウントの削除処理に失敗しました。しばらくしてから再度お試しください', 503);
  }

  // 4. サーバー内キャッシュおよびローカル残骸の消去
  profileCache.delete(uid);
  try {
    const profileMod = require('./profile');
    if (typeof profileMod.deleteLocalProfile === 'function') {
      profileMod.deleteLocalProfile(uid);
    }
  } catch {}

  return { ok: true };
}

module.exports = {
  PRESET_TEST_USERS,
  buildAnonymousUser,
  isAuthRequired,
  requireAuth,
  optionalAuth,
  verifyToken,
  signupUser,
  loginUser,
  getTurnstileSiteKey,
  isTurnstileEnabled,
  verifyTurnstileToken,
  requestPasswordReset,
  updatePasswordWithToken,
  deleteAccount,
  clearProfileCache,
  isCloudAuthEnabled: () => Boolean(env.IS_CLOUD || env.TEST_USERS_ENABLED),
};

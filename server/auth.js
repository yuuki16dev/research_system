'use strict';

/**
 * ユーザー認証＆デュアルモード（テストアカウント / Supabase / ローカル）ミドルウェア (v2.12.0)
 *
 * 1. プリセット・テストアカウント（user-a@test.local, user-b@test.local, admin@test.local）を即座に利用可能
 * 2. 新規テストアカウントの即時サインアップ＆ログイン対応
 * 3. SUPABASE_URL 設定時は本番 Supabase Auth へシームレスに連携
 * 4. ユーザーごとのリサーチ履歴・月間クォータ分離に対応
 */

const env = require('./env');

function isAuthEnforced() {
  return process.env.ENABLE_AUTH === 'true';
}

function isAuthRequired() {
  if (process.env.NODE_ENV === 'test') {
    return env.IS_CLOUD || process.env.ENABLE_AUTH === 'true';
  }
  // ユーザー指示「公開・クラウド環境もログイン不要にして欲しい。サービス公開前に戻す」に従い、
  // 公開・クラウド環境では明示的に ENABLE_AUTH === 'true' が設定されない限りログイン不要（admin仕様）
  return process.env.ENABLE_AUTH === 'true';
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
}
function getSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || '';
}
function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
}

// プロファイルキャッシュ（利用者ID -> { plan, subscriptionStatus, expiresAt }）60秒TTL (B-1)
const profileCache = new Map();

function clearProfileCache() {
  profileCache.clear();
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
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
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
        profileCache.set(userId, item);
        return item;
      }
    }
  } catch (err) {
    console.warn('[auth] Failed to fetch profile from Supabase:', err.message);
  }

  const fallback = { plan: 'free', subscriptionStatus: 'active', expiresAt: now + 60000 };
  profileCache.set(userId, fallback);
  return fallback;
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

  // 認証が不要な環境（ローカル、およびサービス公開前の公開・クラウド環境）: 未ログインを管理者（owner-user / admin）として自動通過
  if (!isAuthRequired()) {
    req.user = {
      id: 'owner-user',
      email: 'owner@local',
      role: 'authenticated',
      plan: 'admin',
      isLocal: !env.IS_CLOUD,
    };
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

  // トークンがない場合、認証不要環境では管理者として設定
  if (!isAuthRequired()) {
    req.user = {
      id: 'owner-user',
      email: 'owner@local',
      role: 'authenticated',
      plan: 'admin',
      isLocal: !env.IS_CLOUD,
    };
    return next();
  }

  req.user = null;
  next();
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
    throw new Error('有効なメールアドレスと8文字以上のパスワードを入力してください');
  }

  // 既存テストアカウントとの重複チェック (TEST_USERS_ENABLED 有効時のみ)
  if (env.TEST_USERS_ENABLED && findTestUserByEmail(normEmail)) {
    throw new Error('このメールアドレスは既に登録されています');
  }

  // テストアカウント（@test.local）の場合はSupabase未設定でも即時作成 (TEST_USERS_ENABLED 有効時のみ)
  if (env.TEST_USERS_ENABLED && normEmail.endsWith('@test.local')) {
    const newId = `user-${Date.now().toString(36)}`;
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
    throw new Error('クラウド認証（Supabase）が設定されていません。' + (env.TEST_USERS_ENABLED ? '検証用のテストアカウント（@test.local）をご利用ください。' : ''));
  }

  // Supabase Auth へプロキシ (B-1: data.plan を送信しない)
  const res = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: normEmail,
      password,
    }),
    signal: AbortSignal.timeout(6000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || data.message || 'ユーザー登録に失敗しました');
  }
  return data;
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
    throw new Error('メールアドレスとパスワードを入力してください');
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
        throw new Error('メールアドレスまたはパスワードが正しくありません');
      }
    }
  }

  // 2. Supabase Auth での認証
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!env.IS_CLOUD || !anonKey) {
    throw new Error('クラウド認証（Supabase）が設定されていません。' + (env.TEST_USERS_ENABLED ? '検証用のテストアカウント（@test.local）をご利用ください。' : ''));
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
    },
    body: JSON.stringify({ email: normEmail, password }),
    signal: AbortSignal.timeout(6000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.message || 'メールアドレスまたはパスワードが正しくありません');
  }
  return data;
}

module.exports = {
  PRESET_TEST_USERS,
  isAuthEnforced,
  isAuthRequired,
  requireAuth,
  optionalAuth,
  verifyToken,
  verifySupabaseToken: verifyToken, // 後方互換性
  signupUser,
  loginUser,
  clearProfileCache,
  isCloudAuthEnabled: () => Boolean(env.IS_CLOUD || env.TEST_USERS_ENABLED),
};

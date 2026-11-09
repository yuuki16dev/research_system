'use strict';

/**
 * ユーザー認証＆デュアルモード（テストアカウント / Supabase / ローカル）ミドルウェア (v2.12.0)
 *
 * 1. プリセット・テストアカウント（user-a@test.local, user-b@test.local, admin@test.local）を即座に利用可能
 * 2. 新規テストアカウントの即時サインアップ＆ログイン対応
 * 3. SUPABASE_URL 設定時は本番 Supabase Auth へシームレスに連携
 * 4. ユーザーごとのリサーチ履歴・月間クォータ分離に対応
 */

const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const ENABLE_AUTH = process.env.ENABLE_AUTH === 'true';

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
  const normEmail = String(email || '').trim().toLowerCase();
  const preset = PRESET_TEST_USERS.find((u) => u.email.toLowerCase() === normEmail);
  if (preset) return preset;
  return customTestUsers.get(normEmail) || null;
}

function findTestUserById(id) {
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

  // テストアカウントのトークン形式: test-token-<userId>
  if (token.startsWith('test-token-')) {
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

  // Supabase JWT トークンの検証
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return {
        ...data,
        plan: (data.user_metadata && data.user_metadata.plan) || 'free',
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

  // 認証が強制されていない環境で未ログインの場合は、デフォルト管理者として通過
  if (!ENABLE_AUTH && !SUPABASE_URL) {
    req.user = {
      id: 'owner-user',
      email: 'owner@local',
      role: 'authenticated',
      plan: 'admin',
      isLocal: true,
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

  // トークンがない場合、未強制環境ではローカル管理者
  if (!ENABLE_AUTH && !SUPABASE_URL) {
    req.user = {
      id: 'owner-user',
      email: 'owner@local',
      role: 'authenticated',
      plan: 'admin',
      isLocal: true,
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
  if (!normEmail || !password || password.length < 6) {
    throw new Error('有効なメールアドレスと6文字以上のパスワードを入力してください');
  }

  // 既存テストアカウントとの重複チェック
  if (findTestUserByEmail(normEmail)) {
    throw new Error('このメールアドレスは既に登録されています');
  }

  // テストアカウント（@test.local）の場合はSupabase未設定でも即時作成
  if (normEmail.endsWith('@test.local')) {
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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('クラウド認証（Supabase）が設定されていません。検証用のテストアカウント（@test.local）をご利用ください。');
  }

  // Supabase Auth へプロキシ
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: normEmail,
      password,
      data: { plan: 'free' },
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

  // 1. テストユーザーの照合
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

  // 2. Supabase Auth での認証
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('クラウド認証（Supabase）が設定されていません。検証用のテストアカウント（@test.local）をご利用ください。');
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
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
  requireAuth,
  optionalAuth,
  verifyToken,
  verifySupabaseToken: verifyToken, // 後方互換性
  signupUser,
  loginUser,
  isCloudAuthEnabled: () => true, // テストアカウント機能により常に認証UI利用可能
};

'use strict';

/**
 * Supabase 認証＆デュアルモード（ローカル/クラウド）ミドルウェア
 *
 * SUPABASE_URL が未設定の環境（ローカル実行・テスト環境）では自動的に
 * ローカル管理者（plan: 'admin'）として振る舞い、後方互換性を100%維持します。
 * クラウド環境（SUPABASE_URL 設定時）では Bearer JWT トークンを検証します。
 */

const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
// 一般ユーザー向け認証を明示的に有効化する場合のみ true (デフォルトはオーナー直接利用モード)
const ENABLE_AUTH = process.env.ENABLE_AUTH === 'true';

/**
 * Bearer トークンから Supabase ユーザー情報を取得
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function verifySupabaseToken(token) {
  if (!SUPABASE_URL || !token) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[auth] Supabase token verification failed:', err.message);
    return null;
  }
}

/**
 * 認証ミドルウェア（必須）
 */
function requireAuth(req, res, next) {
  // 認証が明示的に有効化されていない場合（オーナー直接利用・テストモード）
  // または SUPABASE_URL が未設定の場合は自動でオーナー（無制限）として通過
  if (!ENABLE_AUTH || !SUPABASE_URL) {
    req.user = {
      id: 'owner-user',
      email: 'owner@local',
      role: 'authenticated',
      plan: 'admin',
      isLocal: !SUPABASE_URL,
    };
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({
      error: '認証が必要です。ログインしてから再度お試しください。',
      code: 'UNAUTHORIZED',
    });
  }

  const token = match[1];
  verifySupabaseToken(token).then((user) => {
    if (!user) {
      return res.status(401).json({
        error: '認証セッションが無効または期限切れです。再ログインしてください。',
        code: 'INVALID_TOKEN',
      });
    }
    req.user = user;
    req.user.isLocal = false;
    next();
  }).catch((err) => {
    res.status(500).json({ error: '認証処理中にエラーが発生しました: ' + err.message });
  });
}

/**
 * 認証ミドルウェア（任意：ログインしていればユーザー情報を付与、未ログインでも通過）
 */
function optionalAuth(req, res, next) {
  if (!ENABLE_AUTH || !SUPABASE_URL) {
    req.user = {
      id: 'owner-user',
      email: 'owner@local',
      role: 'authenticated',
      plan: 'admin',
      isLocal: !SUPABASE_URL,
    };
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    req.user = null;
    return next();
  }

  verifySupabaseToken(match[1]).then((user) => {
    req.user = user || null;
    next();
  }).catch(() => {
    req.user = null;
    next();
  });
}

/**
 * Supabase Auth での新規ユーザー登録
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>}
 */
async function signupUser(email, password) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase 認証が設定されていません');
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email,
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
 * Supabase Auth でのメール・パスワードログイン
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>}
 */
async function loginUser(email, password) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase 認証が設定されていません');
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(6000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.message || 'メールアドレスまたはパスワードが正しくありません');
  }
  return data;
}

module.exports = {
  requireAuth,
  optionalAuth,
  verifySupabaseToken,
  signupUser,
  loginUser,
  isCloudAuthEnabled: () => ENABLE_AUTH && !!SUPABASE_URL,
};


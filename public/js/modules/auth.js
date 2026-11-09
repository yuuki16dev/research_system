// ==========================================================================
// Research Studio — 認証＆サブスクリプション回数メーター モジュール
// ==========================================================================

import { api } from '../api.js';
import { toast, openModal, closeModal } from '../ui.js';
import { loadRecentHistory, renderHistoryDrawerList } from './history.js';

export const authState = {
  isCloud: false,
  hasSupabase: false,
  isLocal: true,
  authenticated: false,
  user: null,
  quota: null,
};

/**
 * 認証ヘッダー用トークンを取得
 */
export function getAuthToken() {
  try {
    return localStorage.getItem('rs_auth_token') || '';
  } catch {
    return '';
  }
}

/**
 * トークンとユーザー情報を保存
 */
export function setAuthSession(token, user) {
  try {
    if (token) {
      localStorage.setItem('rs_auth_token', token);
    } else {
      localStorage.removeItem('rs_auth_token');
    }
    if (user) {
      localStorage.setItem('rs_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('rs_user');
    }
  } catch (e) {
    console.warn('[auth] localStorage error:', e);
  }
}

/**
 * 残り回数メーター＆ユーザーバッジの UI を更新
 */
export function updateQuotaMeterUI() {
  const container = document.getElementById('auth-meter-container');
  if (!container) return;

  const loginBtn = document.getElementById('btn-open-auth-modal');
  const userBadge = document.getElementById('user-quota-badge');
  const planPill = document.getElementById('user-plan-pill');
  const countEl = document.getElementById('user-quota-count');

  if (!loginBtn || !userBadge) return;

  // 未ログインの場合 ➔ ログインボタンを表示
  if (!authState.authenticated) {
    loginBtn.style.display = 'inline-flex';
    userBadge.style.display = 'none';
    return;
  }

  // ログイン中 ➔ ユーザー情報・残り回数バッジを表示
  loginBtn.style.display = 'none';
  userBadge.style.display = 'inline-flex';

  const q = authState.quota;
  const plan = (q && q.plan) || (authState.user && authState.user.plan) || (authState.isLocal ? 'admin' : 'free');

  if (planPill) {
    planPill.textContent = plan.toUpperCase();
    planPill.className = `user-plan-pill plan-${plan.toLowerCase()}`;
  }

  if (countEl) {
    if (plan === 'admin' || (q && q.limit === null)) {
      countEl.innerHTML = '<span class="quota-unlimited">無制限</span>';
    } else if (q) {
      const remaining = Math.max(0, q.remaining ?? 0);
      const limit = q.limit ?? 3;
      const isLow = remaining <= 1;
      countEl.innerHTML = `残り <strong class="${isLow ? 'quota-low' : ''}">${remaining}</strong> / ${limit} 回`;
    } else {
      countEl.textContent = '回数確認中…';
    }
  }
}

/**
 * ユーザー詳細・アカウントメニューモーダルの内容を更新
 */
export function updateAccountDetailsUI() {
  const emailEl = document.getElementById('account-email');
  const planEl = document.getElementById('account-plan');
  const usedEl = document.getElementById('account-used');
  const limitEl = document.getElementById('account-limit');
  const remainingEl = document.getElementById('account-remaining');
  const resetEl = document.getElementById('account-reset');

  const u = authState.user;
  const q = authState.quota;

  if (emailEl) emailEl.textContent = (u && u.email) || (authState.isLocal ? 'ローカル管理者 (ローカル起動)' : 'ゲスト');
  if (planEl) planEl.textContent = ((q && q.plan) || 'FREE').toUpperCase();

  if (q) {
    if (usedEl) usedEl.textContent = `${q.used || 0} 回`;
    if (limitEl) limitEl.textContent = q.limit === null ? '無制限' : `${q.limit} 回`;
    if (remainingEl) remainingEl.textContent = q.limit === null ? '無制限' : `${q.remaining} 回`;
    if (resetEl) {
      if (q.resetAt) {
        try {
          const d = new Date(q.resetAt);
          resetEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 00:00`;
        } catch {
          resetEl.textContent = q.resetAt;
        }
      } else {
        resetEl.textContent = '来月1日';
      }
    }
  }
}

/**
 * サーバーから最新のユーザー・クォータ情報を取得
 */
export async function refreshAuthStatus() {
  try {
    const config = await api.authConfig();
    authState.isCloud = !!config.enabled;
    authState.hasSupabase = !!config.hasSupabase;
    authState.isLocal = !!config.isLocal;

    const me = await api.authMe();
    if (me && me.authenticated) {
      authState.authenticated = true;
      authState.user = me.user;
      authState.quota = me.quota;
    } else {
      authState.authenticated = false;
      authState.user = null;
      authState.quota = null;
    }

    updateQuotaMeterUI();
  } catch (err) {
    console.warn('[auth] 認証状態の取得に失敗:', err.message);
    updateQuotaMeterUI();
  }
}

/**
 * 認証モジュールのイベントバインドと初期化
 */
export function initAuth() {
  // 1. ヘッダーボタンのバインド
  const openAuthBtn = document.getElementById('btn-open-auth-modal');
  if (openAuthBtn) {
    openAuthBtn.addEventListener('click', () => {
      openAuthModal('login');
    });
  }

  const userBadge = document.getElementById('user-quota-badge');
  if (userBadge) {
    userBadge.addEventListener('click', () => {
      updateAccountDetailsUI();
      openModal(document.getElementById('modal-account'));
    });
  }

  // 2. 認証モーダルのタブ切り替え
  const tabLogin = document.getElementById('auth-tab-login');
  const tabSignup = document.getElementById('auth-tab-signup');
  const formLogin = document.getElementById('auth-form-login');
  const formSignup = document.getElementById('auth-form-signup');

  if (tabLogin && tabSignup) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabSignup.classList.remove('active');
      if (formLogin) formLogin.hidden = false;
      if (formSignup) formSignup.hidden = true;
    });

    tabSignup.addEventListener('click', () => {
      tabSignup.classList.add('active');
      tabLogin.classList.remove('active');
      if (formSignup) formSignup.hidden = false;
      if (formLogin) formLogin.hidden = true;
    });
  }

  // 3. ログインフォーム送信
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('auth-login-email');
      const passInput = document.getElementById('auth-login-password');
      const errEl = document.getElementById('auth-login-error');
      const submitBtn = formLogin.querySelector('button[type="submit"]');

      if (!emailInput || !passInput) return;
      if (errEl) errEl.textContent = '';

      const email = emailInput.value.trim();
      const password = passInput.value;

      if (!email || !password) {
        if (errEl) errEl.textContent = 'メールアドレスとパスワードを入力してください';
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'ログイン中…';
      }

      try {
        const res = await api.login({ email, password });
        if (res.access_token) {
          setAuthSession(res.access_token, res.user);
          await refreshAuthStatus();
          closeModal(document.getElementById('modal-auth'));
          toast(`ログインしました（ようこそ、${(res.user && res.user.email) || ''}さん！）`, 'success');
          await loadRecentHistory();
          await renderHistoryDrawerList();
        } else {
          throw new Error('アクセストークンの取得に失敗しました');
        }
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'ログインに失敗しました';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'ログイン';
        }
      }
    });
  }

  // 4. 新規登録フォーム送信
  if (formSignup) {
    formSignup.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('auth-signup-email');
      const passInput = document.getElementById('auth-signup-password');
      const errEl = document.getElementById('auth-signup-error');
      const submitBtn = formSignup.querySelector('button[type="submit"]');

      if (!emailInput || !passInput) return;
      if (errEl) errEl.textContent = '';

      const email = emailInput.value.trim();
      const password = passInput.value;

      if (!email || !password) {
        if (errEl) errEl.textContent = 'メールアドレスとパスワードを入力してください';
        return;
      }
      if (password.length < 6) {
        if (errEl) errEl.textContent = 'パスワードは6文字以上で設定してください';
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'アカウント作成中…';
      }

      try {
        const res = await api.signup({ email, password });
        if (res.access_token) {
          setAuthSession(res.access_token, res.user);
          await refreshAuthStatus();
          closeModal(document.getElementById('modal-auth'));
          toast('アカウント作成が完了しました！月3回まで無料でお使いいただけます。', 'success', 5000);
          await loadRecentHistory();
          await renderHistoryDrawerList();
        } else {
          // メール確認が必要な設定の場合
          closeModal(document.getElementById('modal-auth'));
          toast('登録確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。', 'info', 7000);
        }
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'アカウント作成に失敗しました';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '無料で新規登録';
        }
      }
    });
  }

  // 5. テストアカウント ワンクリックログイン (v2.12.0)
  const quickTestBtns = document.querySelectorAll('.btn-quick-test-user');
  quickTestBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.dataset.email;
      const password = btn.dataset.pass;
      if (!email || !password) return;

      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.textContent = '切替中…';

      try {
        const res = await api.login({ email, password });
        if (res.access_token) {
          setAuthSession(res.access_token, res.user);
          await refreshAuthStatus();
          closeModal(document.getElementById('modal-auth'));
          toast(`「${res.user.email}」としてログインしました`, 'success');
          await loadRecentHistory();
          await renderHistoryDrawerList();
        } else {
          throw new Error('アクセストークン取得失敗');
        }
      } catch (err) {
        toast(`ログイン失敗: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    });
  });

  // 6. アカウント切替ボタン (v2.12.0)
  const switchBtn = document.getElementById('btn-account-switch');
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      closeModal(document.getElementById('modal-account'));
      openAuthModal('login');
    });
  }

  // 7. ログアウトボタン
  const logoutBtn = document.getElementById('btn-account-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      setAuthSession(null, null);
      await refreshAuthStatus();
      closeModal(document.getElementById('modal-account'));
      toast('ログアウトしました', 'info');
      await loadRecentHistory();
      await renderHistoryDrawerList();
    });
  }

  // 6. 初回ステータス取得
  refreshAuthStatus();
}

/**
 * 認証モーダルを開く
 * @param {'login'|'signup'} mode
 */
export function openAuthModal(mode = 'login') {
  const modal = document.getElementById('modal-auth');
  if (!modal) return;

  const tabLogin = document.getElementById('auth-tab-login');
  const tabSignup = document.getElementById('auth-tab-signup');
  const formLogin = document.getElementById('auth-form-login');
  const formSignup = document.getElementById('auth-form-signup');
  const errLogin = document.getElementById('auth-login-error');
  const errSignup = document.getElementById('auth-signup-error');

  if (errLogin) errLogin.textContent = '';
  if (errSignup) errSignup.textContent = '';

  if (mode === 'signup') {
    if (tabSignup) tabSignup.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
    if (formSignup) formSignup.hidden = false;
    if (formLogin) formLogin.hidden = true;
  } else {
    if (tabLogin) tabLogin.classList.add('active');
    if (tabSignup) tabSignup.classList.remove('active');
    if (formLogin) formLogin.hidden = false;
    if (formSignup) formSignup.hidden = true;
  }

  openModal(modal);
}


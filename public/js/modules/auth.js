// ==========================================================================
// Research Studio — 認証＆サブスクリプション回数メーター モジュール
// ==========================================================================

import { api } from '../api.js';
import { toast, openModal, closeModal } from '../ui.js';
import { appState } from './state.js';
import { historyState, loadRecentHistory, renderHistoryDrawerList, updateCrossBar } from './history.js';
import { resetDeepDiveState } from './deep-dive.js';

export const authState = {
  isCloud: false,
  hasSupabase: false,
  isLocal: true,
  testUsersEnabled: false,
  authenticated: false,
  user: null,
  quota: null,
  profile: null,
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
  const avatarBadge = document.getElementById('user-avatar-badge');
  const nameBadge = document.getElementById('user-name-badge');

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

  // プロフィール表示の反映
  const prof = authState.profile;
  if (avatarBadge) {
    avatarBadge.textContent = (prof && prof.avatar) || '👤';
  }
  if (nameBadge) {
    if (prof && prof.displayName) {
      nameBadge.textContent = prof.displayName;
      nameBadge.style.display = 'inline';
    } else {
      nameBadge.style.display = 'none';
    }
  }

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
  const nameInput = document.getElementById('profile-display-name');
  const avatarSelector = document.getElementById('profile-avatar-selector');

  const u = authState.user;
  const q = authState.quota;
  const prof = authState.profile;

  if (emailEl) emailEl.textContent = (u && u.email) || (authState.isLocal ? 'ローカル管理者 (ローカル起動)' : 'ゲスト');
  if (planEl) planEl.textContent = ((q && q.plan) || 'FREE').toUpperCase();

  // プロフィール入力欄の初期化
  if (nameInput) {
    nameInput.value = (prof && prof.displayName) || '';
  }
  if (avatarSelector) {
    const curAvatar = (prof && prof.avatar) || '👤';
    const choices = avatarSelector.querySelectorAll('.btn-avatar-choice');
    choices.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.avatar === curAvatar);
    });
  }

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
  } else {
    if (usedEl) usedEl.textContent = '—';
    if (limitEl) limitEl.textContent = '—';
    if (remainingEl) remainingEl.textContent = '—';
    if (resetEl) resetEl.textContent = '—';
  }
}

function clearSessionWorkspaceUI() {
  appState.currentResult = null;
  historyState.selectedCrossIds.clear();
  updateCrossBar();
  const resultsSection = document.getElementById('results-section');
  if (resultsSection) resultsSection.hidden = true;
  const reportEl = document.getElementById('report');
  if (reportEl) reportEl.innerHTML = '';
  resetDeepDiveState();
}

async function completeAuthSession(token, user, welcomeMsg, toastMs = 3000) {
  const prevUserId = authState.user && authState.user.id;
  setAuthSession(token, user);
  await refreshAuthStatus();
  if (prevUserId && (!user || prevUserId !== user.id)) {
    clearSessionWorkspaceUI();
  }
  updateAccountDetailsUI();
  closeModal(document.getElementById('modal-auth'));
  closeModal(document.getElementById('modal-account'));
  toast(welcomeMsg, 'success', toastMs);
  await loadRecentHistory();
  await renderHistoryDrawerList();
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
    authState.testUsersEnabled = !!config.testUsersEnabled;
    authState.anonymousMode = !!config.anonymousMode;
    authState.turnstileSiteKey = config.turnstileSiteKey || '';

    const dangerZone = document.getElementById('account-danger-zone');
    if (dangerZone) {
      dangerZone.hidden = Boolean(config.isLocal || config.anonymousMode);
    }

    if (authState.turnstileSiteKey) {
      ensureTurnstileWidget(authState.turnstileSiteKey);
    }

    // クラウド匿名テスト公開モード警告バナー制御 (R-1)
    const anonBanner = document.getElementById('anonymous-mode-banner');
    if (anonBanner) {
      anonBanner.hidden = !config.anonymousMode;
    }

    // テストユーザーUIの表示制御 (A-2)
    const quickBox = document.getElementById('auth-test-quick-box');
    if (quickBox) {
      quickBox.style.display = config.testUsersEnabled ? 'block' : 'none';
    }
    const accountQuickBox = document.getElementById('account-test-quick-box');
    if (accountQuickBox) {
      accountQuickBox.style.display = config.testUsersEnabled ? 'block' : 'none';
    }

    // クラウド版の管理系UI非表示制御 (A-3) & 共有リンク一時停止 (A-6)
    if (!config.isLocal) {
      const btnSettings = document.getElementById('btn-settings');
      const btnUsage = document.getElementById('btn-usage');
      const btnMobile = document.getElementById('btn-mobile');
      const btnShutdown = document.getElementById('btn-power-shutdown');
      const btnLogs = document.getElementById('btn-view-logs');
      const btnShare = document.getElementById('btn-share-report');

      if (btnSettings) btnSettings.style.display = 'none';
      if (btnUsage) btnUsage.style.display = 'none';
      if (btnMobile) btnMobile.style.display = 'none';
      if (btnShutdown) btnShutdown.style.display = 'none';
      if (btnLogs) btnLogs.style.display = 'none';
      if (btnShare) btnShare.style.display = 'none';
      document.querySelectorAll('.btn-share-action').forEach((el) => {
        el.style.display = 'none';
      });

      // D-4: クラウド版ではファイル添付および手持ち資料入力欄を非表示にする
      document.querySelectorAll('[data-local-only="attachment"]').forEach((el) => {
        el.hidden = true;
        el.style.display = 'none';
      });
      const byodLegend = document.getElementById('byod-legend-text');
      if (byodLegend) byodLegend.textContent = '先行調査する参考URL（任意）';
      const byodHint = document.getElementById('byod-field-hint');
      if (byodHint) byodHint.textContent = '指定した公開URLの一次情報とWeb最新情報をAIが突き合わせて分析します';
      const presDocInput = document.getElementById('pres-document-input');
      if (presDocInput) {
        presDocInput.placeholder = '直近のリサーチ結果を引用するか、スライド化したいテキストを入力してください…（クラウド版ではファイル添付は無効です）';
      }
      const footerEnvLabel = document.getElementById('footer-env-label');
      if (footerEnvLabel) footerEnvLabel.textContent = 'Cloud Web App';
    }

    const me = await api.authMe();
    if (me && me.authenticated) {
      authState.authenticated = true;
      authState.user = me.user;
      authState.quota = me.quota;
      // プロフィールの取得
      try {
        const profRes = await api.getProfile();
        authState.profile = (profRes && profRes.profile) || null;
      } catch {
        authState.profile = null;
      }
    } else {
      authState.authenticated = false;
      authState.user = null;
      authState.quota = null;
      authState.profile = null;
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
      openModal('modal-account');
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
          await completeAuthSession(
            res.access_token,
            res.user,
            `ログインしました（ようこそ、${(res.user && res.user.email) || ''}さん！）`
          );
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
      if (password.length < 8) {
        if (errEl) errEl.textContent = 'パスワードは8文字以上で設定してください';
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'アカウント作成中…';
      }

      try {
        const captchaToken = authState.turnstileSiteKey ? getTurnstileToken() : '';
        if (authState.turnstileSiteKey && !captchaToken) {
          if (errEl) errEl.textContent = 'ボット対策認証（チェック）を完了してください';
          return;
        }
        const res = await api.signup({ email, password, captchaToken });
        if (res.access_token) {
          await completeAuthSession(
            res.access_token,
            res.user,
            'アカウント作成が完了しました！月3クレジットまで通常リサーチを無料でお使いいただけます。',
            5000
          );
        } else {
          // メール確認が必要な設定の場合
          closeModal(document.getElementById('modal-auth'));
          closeModal(document.getElementById('modal-account'));
          toast('登録確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。', 'info', 7000);
        }
      } catch (err) {
        resetTurnstileWidget();
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
          await completeAuthSession(res.access_token, res.user, `「${res.user.email}」としてログインしました`);
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
      clearSessionWorkspaceUI();
      await refreshAuthStatus();
      updateAccountDetailsUI();
      closeModal(document.getElementById('modal-account'));
      toast('ログアウトしました', 'info');
      await loadRecentHistory();
      await renderHistoryDrawerList();
    });
  }

  // 8. プロフィール設定・アバター選択 (v2.13.0)
  const avatarChoices = document.querySelectorAll('.btn-avatar-choice');
  avatarChoices.forEach((btn) => {
    btn.addEventListener('click', () => {
      avatarChoices.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const saveProfileBtn = document.getElementById('btn-save-profile');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('profile-display-name');
      const activeAvatarBtn = document.querySelector('.btn-avatar-choice.active');
      const displayName = nameInput ? nameInput.value.trim() : '';
      const avatar = activeAvatarBtn ? activeAvatarBtn.dataset.avatar : '👤';

      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = '保存中…';

      try {
        const res = await api.updateProfile({ displayName, avatar });
        if (res && res.profile) {
          authState.profile = res.profile;
          updateQuotaMeterUI();
          toast('プロフィールを保存しました！', 'success');
        }
      } catch (err) {
        toast(`プロフィールの保存に失敗しました: ${err.message}`, 'error');
      } finally {
        saveProfileBtn.disabled = false;
        saveProfileBtn.textContent = 'プロフィールを保存';
      }
    });
  }

  // 9. 一括バックアップダウンロード (v2.13.0)
  const handleBackup = async () => {
    try {
      toast('バックアップデータを生成中…', 'info');
      const backup = await api.backupHistory();
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `research_studio_backup_${backup.userId || 'my'}_${ymd}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(`全 ${backup.count || 0} 件のレポートを一括バックアップしました`, 'success');
    } catch (err) {
      toast(`バックアップの生成に失敗しました: ${err.message}`, 'error');
    }
  };

  const backupBtn = document.getElementById('btn-backup-history');
  if (backupBtn) backupBtn.addEventListener('click', handleBackup);

  const quickBackupBtn = document.getElementById('btn-history-backup-quick');
  if (quickBackupBtn) quickBackupBtn.addEventListener('click', handleBackup);

  // 10. バックアップからの全履歴復元・インポート (v2.13.0)
  const restoreInput = document.getElementById('input-restore-file');
  if (restoreInput) {
    restoreInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        toast('バックアップファイルを解析中…', 'info');
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !Array.isArray(data.reports)) {
          throw new Error('有効なバックアップファイル (JSON) ではありません');
        }

        const res = await api.restoreHistory(data);
        if (res && res.ok) {
          toast(`バックアップから ${res.restored} 件のレポートを復元しました！`, 'success');
          await loadRecentHistory();
          await renderHistoryDrawerList();
          await refreshAuthStatus();
        } else {
          throw new Error('復元に失敗しました');
        }
      } catch (err) {
        toast(`復元エラー: ${err.message}`, 'error');
      } finally {
        restoreInput.value = '';
      }
    });
  }

  // 11. パスワード再設定・リカバリー・アカウント削除ハンドラ (S-3)
  const formReset = document.getElementById('auth-form-reset');
  const formUpdatePass = document.getElementById('auth-form-update-password');
  const btnShowReset = document.getElementById('btn-show-reset-password');
  const btnBackToLogin = document.getElementById('btn-back-to-login');
  let activeRecoveryToken = '';

  if (btnShowReset) {
    btnShowReset.addEventListener('click', () => {
      if (formLogin) formLogin.hidden = true;
      if (formSignup) formSignup.hidden = true;
      if (formUpdatePass) formUpdatePass.hidden = true;
      if (formReset) formReset.hidden = false;
      const msgEl = document.getElementById('auth-reset-msg');
      if (msgEl) msgEl.textContent = '';
    });
  }

  if (btnBackToLogin) {
    btnBackToLogin.addEventListener('click', () => {
      if (formReset) formReset.hidden = true;
      if (formUpdatePass) formUpdatePass.hidden = true;
      if (formLogin) formLogin.hidden = false;
    });
  }

  if (formReset) {
    formReset.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('auth-reset-email');
      const msgEl = document.getElementById('auth-reset-msg');
      const submitBtn = formReset.querySelector('button[type="submit"]');
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) {
        if (msgEl) msgEl.textContent = 'メールアドレスを入力してください';
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '送信中…';
      }
      try {
        const res = await api.resetPassword({ email });
        toast(res.message || 'パスワード再設定メールを送信しました', 'info', 7000);
        if (msgEl) {
          msgEl.style.color = '#34d399';
          msgEl.textContent = res.message || '再設定メールを送信しました。メール内のリンクをご確認ください。';
        }
      } catch (err) {
        if (msgEl) {
          msgEl.style.color = '';
          msgEl.textContent = err.message || '送信に失敗しました';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '再設定メールを送信';
        }
      }
    });
  }

  if (formUpdatePass) {
    formUpdatePass.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = (document.getElementById('auth-new-password') || {}).value || '';
      const p2 = (document.getElementById('auth-new-password-confirm') || {}).value || '';
      const msgEl = document.getElementById('auth-update-password-msg');
      const submitBtn = formUpdatePass.querySelector('button[type="submit"]');
      if (msgEl) msgEl.textContent = '';
      if (p1.length < 8) {
        if (msgEl) msgEl.textContent = '新しいパスワードは8文字以上で設定してください';
        return;
      }
      if (p1 !== p2) {
        if (msgEl) msgEl.textContent = '確認用パスワードが一致しません';
        return;
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '更新中…';
      }
      try {
        await api.updatePassword(p1, activeRecoveryToken);
        activeRecoveryToken = '';
        toast('パスワードを更新しました。新しいパスワードでログインしてください。', 'success', 6000);
        openAuthModal('login');
      } catch (err) {
        if (msgEl) msgEl.textContent = err.message || 'パスワード更新に失敗しました';
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '新しいパスワードを保存';
        }
      }
    });
  }

  // Supabase のパスワード再設定リンク (#access_token=...&type=recovery) を自動検知
  try {
    const hash = window.location.hash || '';
    if (hash.includes('type=recovery') && hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const token = params.get('access_token');
      if (token) {
        activeRecoveryToken = token;
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        openAuthModal('recovery');
      }
    }
  } catch {}

  const btnDeleteToggle = document.getElementById('btn-account-delete-toggle');
  const deleteConfirmBox = document.getElementById('account-delete-confirm-box');
  const btnDeleteAccount = document.getElementById('btn-account-delete');
  if (btnDeleteToggle && deleteConfirmBox) {
    btnDeleteToggle.addEventListener('click', () => {
      deleteConfirmBox.hidden = !deleteConfirmBox.hidden;
    });
  }
  if (btnDeleteAccount) {
    btnDeleteAccount.addEventListener('click', async () => {
      const confirmInput = document.getElementById('account-delete-confirm-input');
      const errEl = document.getElementById('account-delete-error');
      const typed = confirmInput ? confirmInput.value.trim() : '';
      if (errEl) errEl.textContent = '';
      if (typed !== 'DELETE') {
        if (errEl) errEl.textContent = '確認のため "DELETE" と入力してください';
        return;
      }
      btnDeleteAccount.disabled = true;
      btnDeleteAccount.textContent = '削除処理中…';
      try {
        const res = await api.deleteAccount({ confirm: 'DELETE' });
        setAuthSession(null, null);
        clearSessionWorkspaceUI();
        if (confirmInput) confirmInput.value = '';
        if (deleteConfirmBox) deleteConfirmBox.hidden = true;
        await refreshAuthStatus();
        updateAccountDetailsUI();
        closeModal(document.getElementById('modal-account'));
        toast((res && res.message) || 'アカウントを削除しました', 'info', 6000);
        await loadRecentHistory();
        await renderHistoryDrawerList();
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'アカウント削除に失敗しました';
      } finally {
        btnDeleteAccount.disabled = false;
        btnDeleteAccount.textContent = 'アカウントを完全に削除する';
      }
    });
  }

  // 12. 初回ステータス取得
  refreshAuthStatus();
}

// Cloudflare Turnstile ヘルパー (S-3)
let turnstileWidgetId = null;
let turnstileTokenValue = '';
let turnstileScriptLoaded = false;

function getTurnstileToken() {
  return turnstileTokenValue || '';
}

function resetTurnstileWidget() {
  turnstileTokenValue = '';
  try {
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  } catch {}
}

function ensureTurnstileWidget(siteKey) {
  if (!siteKey) return;
  const container = document.getElementById('turnstile-signup-container');
  if (!container) return;
  container.hidden = false;

  const renderWidget = () => {
    if (!window.turnstile || turnstileWidgetId !== null) return;
    try {
      turnstileWidgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token) => {
          turnstileTokenValue = token || '';
        },
        'expired-callback': () => {
          turnstileTokenValue = '';
        },
        'error-callback': () => {
          turnstileTokenValue = '';
        },
      });
    } catch {}
  };

  if (window.turnstile) {
    renderWidget();
    return;
  }
  if (turnstileScriptLoaded) return;
  turnstileScriptLoaded = true;
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.defer = true;
  script.onload = renderWidget;
  document.head.appendChild(script);
}

/**
 * 認証モーダルを開く
 * @param {'login'|'signup'|'recovery'} mode
 */
export function openAuthModal(mode = 'login') {
  const modal = document.getElementById('modal-auth');
  if (!modal) return;

  const tabLogin = document.getElementById('auth-tab-login');
  const tabSignup = document.getElementById('auth-tab-signup');
  const formLogin = document.getElementById('auth-form-login');
  const formSignup = document.getElementById('auth-form-signup');
  const formReset = document.getElementById('auth-form-reset');
  const formUpdatePass = document.getElementById('auth-form-update-password');
  const errLogin = document.getElementById('auth-login-error');
  const errSignup = document.getElementById('auth-signup-error');

  if (errLogin) errLogin.textContent = '';
  if (errSignup) errSignup.textContent = '';
  if (formReset) formReset.hidden = true;
  if (formUpdatePass) formUpdatePass.hidden = true;

  if (mode === 'recovery') {
    if (formLogin) formLogin.hidden = true;
    if (formSignup) formSignup.hidden = true;
    if (formUpdatePass) formUpdatePass.hidden = false;
  } else if (mode === 'signup') {
    if (tabSignup) tabSignup.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
    if (formSignup) formSignup.hidden = false;
    if (formLogin) formLogin.hidden = true;
    if (authState.turnstileSiteKey) ensureTurnstileWidget(authState.turnstileSiteKey);
  } else {
    if (tabLogin) tabLogin.classList.add('active');
    if (tabSignup) tabSignup.classList.remove('active');
    if (formLogin) formLogin.hidden = false;
    if (formSignup) formSignup.hidden = true;
  }

  openModal('modal-auth');
}

// グローバルフォールバック用として window に公開
if (typeof window !== 'undefined') {
  window.rsOpenAuthModal = openAuthModal;
}


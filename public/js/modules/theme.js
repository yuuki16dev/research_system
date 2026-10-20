// ==========================================================================
// テーマ & アプリケーションステータス (Theme & Status Pill)
// ==========================================================================

import { $, icon, hydrateIcons, toast, openModal, esc } from '../ui.js';
import { api } from '../api.js';
import { appState } from './state.js';

/** テーマ切替 (Dark / Light) */
export function initTheme() {
  const btn = $('#btn-theme');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('rs-theme', next);
    } catch {}
    toast(next === 'light' ? '☀️ ライトモードに切り替えました' : '🌙 ダークモードに切り替えました', 'info', 2000);
  });
}

/** アプリステータス & 接続情報の取得 */
export async function refreshAppInfo() {
  try {
    const info = await api.info();
    appState.settings = info.settings;
    appState.lanInfo = info.lan || [];

    updateStatusPill(info.settings);
    updateModeHint(info.settings);

    const fMode = $('#footer-mode');
    if (fMode) {
      fMode.textContent = info.settings.effectiveMode === 'live' ? 'LIVE (Gemini API)' : 'DEMO (モックデータ)';
    }
  } catch (e) {
    const pill = $('#status-pill');
    if (pill) pill.className = 'status-pill offline';
    const txt = $('#status-text');
    if (txt) txt.textContent = 'オフライン';
  }
}

export function updateStatusPill(settings) {
  const pill = $('#status-pill');
  const txt = $('#status-text');
  if (!pill || !txt) return;
  if (settings.effectiveMode === 'live') {
    pill.className = 'status-pill live';
    txt.textContent = 'LIVE モード';
    pill.title = `Gemini (${settings.geminiModel}) 接続中`;
  } else {
    pill.className = 'status-pill demo';
    txt.textContent = 'DEMO モード';
    pill.title = 'APIキー未設定またはモック強制中';
  }
}

export function updateModeHint(settings) {
  const hint = $('#mode-hint');
  if (!hint) return;
  if (settings.effectiveMode === 'live') {
    hint.className = 'mode-hint live';
    hint.innerHTML = `<span data-icon="sparkles"></span><span><strong>LIVEモード</strong>（${esc(settings.geminiModel)} + ${esc(settings.effectiveSearch)}）で実調査を実行します</span>`;
  } else {
    hint.className = 'mode-hint';
    hint.innerHTML = `<span data-icon="info"></span><span>現在は<strong>DEMOモード</strong>です。<a id="link-open-settings">APIキーを設定</a>すると本物のWeb調査が可能です</span>`;
    const a = $('#link-open-settings', hint);
    if (a) a.addEventListener('click', () => openModal('modal-settings'));
  }
  hydrateIcons(hint);
}

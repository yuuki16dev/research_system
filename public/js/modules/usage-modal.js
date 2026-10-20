// ==========================================================================
// 利用状況モニタリングモーダル (Usage & Quota Dashboard)
// ==========================================================================

import { $, $$, icon, hydrateIcons, openModal, closeModal, toast, esc } from '../ui.js';
import { api } from '../api.js';
import { refreshAppInfo } from './theme.js';

export function bindUsageModal() {
  const btn = $('#btn-usage');
  if (btn) {
    btn.addEventListener('click', () => {
      openModal('modal-usage');
      refreshUsageModalContent();
    });
  }

  const pill = $('#status-pill');
  if (pill) {
    pill.style.cursor = 'pointer';
    pill.addEventListener('click', () => {
      openModal('modal-usage');
      refreshUsageModalContent();
    });
  }

  const btnFromSettings = $('#btn-open-usage-from-settings');
  if (btnFromSettings) {
    btnFromSettings.addEventListener('click', () => {
      closeModal('modal-settings');
      openModal('modal-usage');
      refreshUsageModalContent();
    });
  }

  const btnFromUsage = $('#btn-open-settings-from-usage');
  if (btnFromUsage) {
    btnFromUsage.addEventListener('click', () => {
      closeModal('modal-usage');
      openModal('modal-settings');
      loadSettingsIntoForm();
    });
  }

  const btnRefresh = $('#btn-refresh-usage');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      refreshUsageModalContent();
      toast('利用状況を最新に更新しました', 'info', 1500);
    });
  }
}

export async function refreshUsageModalContent() {
  const body = $('#usage-body');
  if (!body) return;
  body.innerHTML = `
    <div style="padding: 32px; text-align: center; color: var(--text-2);">
      <span class="pulse-orb" style="display: inline-block; margin-bottom: 12px;"></span>
      <p>各サービスのAPI利用状況・クォータを取得中…</p>
    </div>
  `;

  try {
    const data = await api.usage();
    renderUsageDashboard(data, body);
  } catch (err) {
    body.innerHTML = `
      <div class="notice" style="margin: 20px 0;">
        <span data-icon="alert"></span>
        <div>
          <strong>利用状況の取得に失敗しました</strong>
          <p>${esc(err.message)}</p>
        </div>
      </div>
    `;
    hydrateIcons(body);
  }
}

let currentUsageViewMode = 'gauge';

function renderUsageDashboard(data, container) {
  const { gemini, tavily, duckduckgo, tips } = data;

  // Geminiの残量計算
  const geminiLimit = 1500; // 日次無料枠 (RPD)
  const geminiUsed = gemini.todayRequests || 0;
  const geminiRemain = Math.max(0, geminiLimit - geminiUsed);
  const geminiUsedPct = Math.min(100, ((geminiUsed / geminiLimit) * 100).toFixed(1));
  const geminiRemainPct = (100 - geminiUsedPct).toFixed(1);
  const geminiResearchesLeft = Math.floor(geminiRemain / 3); // 1リサーチ約3回AI呼出換算

  // Tavilyの残量計算
  const tavilyLimit = tavily.planLimit || 1000;
  const tavilyUsed = tavily.planUsage || 0;
  const tavilyRemain = Math.max(0, tavilyLimit - tavilyUsed);
  const tavilyUsedPct = Math.min(100, ((tavilyUsed / tavilyLimit) * 100).toFixed(1));
  const tavilyRemainPct = (100 - tavilyUsedPct).toFixed(1);
  const tavilyResearchesLeft = Math.floor(tavilyRemain / 3); // 1リサーチ約3クエリ検索換算

  const reset = gemini.resetInfo || {};
  const promptTok = gemini.totalPromptTokens || 0;
  const candTok = gemini.totalCandidatesTokens || 0;
  const totalTok = gemini.totalTokens || 0;

  let html = `
    <!-- 表示モード切替タブ -->
    <div class="view-mode-tabs" role="tablist">
      <button type="button" class="view-mode-tab ${currentUsageViewMode === 'gauge' ? 'active' : ''}" data-view="gauge">
        <span data-icon="chart"></span>残量メーター（あと何回リサーチできるか）
      </button>
      <button type="button" class="view-mode-tab ${currentUsageViewMode === 'detail' ? 'active' : ''}" data-view="detail">
        <span data-icon="list"></span>トークン詳細・履歴・API仕様
      </button>
    </div>
  `;

  if (currentUsageViewMode === 'gauge') {
    // =========================================================================
    // 【表示方法 1】残量メーター＆リサーチ可能回数重視（バッテリー/残高スタイル）
    // =========================================================================
    html += `
      <!-- 1. Gemini 残量メーターカード -->
      <div class="capacity-hero-card">
        <div class="capacity-top">
          <div class="cap-title">
            <span class="cap-service-icon">🤖</span>
            <div>
              <h4>Google Gemini API (本日の残り利用枠)</h4>
              <small style="color: var(--text-3);">${esc(gemini.model)} · 日次1,500回無料枠</small>
            </div>
          </div>
          <span class="cap-status-badge ${gemini.configured ? 'ok' : 'off'}">
            ${gemini.configured ? `🟢 残り ${geminiRemainPct}%` : '⚪ 未設定'}
          </span>
        </div>

        ${gemini.configured ? `
          <div class="capacity-main-stat">
            <div class="stat-highlight">
              <span class="stat-label">今日あと使える回数</span>
              <div class="stat-big-num">
                <strong class="remain-num success">${geminiRemain.toLocaleString()}</strong>
                <span class="denom">/ ${geminiLimit.toLocaleString()} 回</span>
              </div>
            </div>
            <div class="stat-conversion">
              <span class="conv-tag">💡 リサーチ実行目安</span>
              <div class="conv-val">
                あと約 <strong>${geminiResearchesLeft.toLocaleString()}</strong> 回
              </div>
              <small>※1リサーチあたり約3回AI呼出換算</small>
            </div>
          </div>

          <!-- 視覚的残量メーター -->
          <div class="capacity-meter-wrap">
            <div class="meter-bar-track">
              <div class="meter-bar-used" style="width: ${Math.max(1.5, geminiUsedPct)}%;"></div>
            </div>
            <div class="meter-legend">
              <span>本日利用: <strong>${geminiUsed.toLocaleString()} 回</strong> (${geminiUsedPct}%)</span>
              <span style="color: var(--success-light);">残り枠: <strong>${geminiRemain.toLocaleString()} 回</strong> (${geminiRemainPct}%)</span>
            </div>
          </div>

          <div class="capacity-reset-pill">
            <span data-icon="clock"></span>
            <span>次回リセット: <strong>${esc(reset.formattedTargetJST || '毎日 16:00 JST')}</strong>（${esc(reset.remainingText || '')}で1,500回全快）</span>
          </div>
        ` : `
          <div class="notice" style="margin: 12px 0;">
            <span data-icon="alert"></span>
            <div>
              <strong>Gemini APIキーが未設定です</strong>
              <p style="margin-top: 4px; font-size: 13px;">画面右上の「⚙️ 設定」アイコンから無料の API キーを入力してください。（※キー未設定時はデモデータで動作します）</p>
            </div>
          </div>
        `}

        <div class="usage-actions-row" style="margin-top: 6px;">
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.dashboard)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>AI Studio 公式ダッシュボードを開く ↗
          </a>
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.quotas)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>GCP クォータ制限 ↗
          </a>
        </div>
      </div>

      <!-- 2. Tavily 残量メーターカード -->
      <div class="capacity-hero-card">
        <div class="capacity-top">
          <div class="cap-title">
            <span class="cap-service-icon">🔍</span>
            <div>
              <h4>Tavily Search API (今月の残り検索枠)</h4>
              <small style="color: var(--text-3);">${esc(tavily.plan || 'Researcher')} プラン</small>
            </div>
          </div>
          <span class="cap-status-badge ${tavily.ok ? 'ok' : 'off'}">
            ${tavily.ok ? `🟢 残り ${tavilyRemainPct}%` : '⚪ 未設定 (DuckDuckGo使用中)'}
          </span>
        </div>

        ${tavily.ok ? `
          <div class="capacity-main-stat">
            <div class="stat-highlight">
              <span class="stat-label">今月あと使える検索枠</span>
              <div class="stat-big-num">
                <strong class="remain-num success">${tavilyRemain.toLocaleString()}</strong>
                <span class="denom">/ ${tavilyLimit.toLocaleString()} 件</span>
              </div>
            </div>
            <div class="stat-conversion">
              <span class="conv-tag">💡 リサーチ実行目安</span>
              <div class="conv-val">
                あと約 <strong>${tavilyResearchesLeft.toLocaleString()}</strong> 回
              </div>
              <small>※1リサーチあたり約3クエリ検索換算</small>
            </div>
          </div>

          <!-- 視覚的残量メーター -->
          <div class="capacity-meter-wrap">
            <div class="meter-bar-track">
              <div class="meter-bar-used" style="width: ${Math.max(1, tavilyUsedPct)}%;"></div>
            </div>
            <div class="meter-legend">
              <span>今月利用: <strong>${tavilyUsed.toLocaleString()} 件</strong> (${tavilyUsedPct}%)</span>
              <span style="color: var(--success-light);">残り枠: <strong>${tavilyRemain.toLocaleString()} 件</strong> (${tavilyRemainPct}%)</span>
            </div>
          </div>

          <div class="capacity-reset-pill">
            <span data-icon="clock"></span>
            <span>更新タイミング: <strong>${esc(tavily.renewalNotice || '毎月のアカウント更新日（月次リセット）')}</strong></span>
          </div>
        ` : `
          <div class="notice" style="margin: 12px 0;">
            <span data-icon="info"></span>
            <div>
              <strong>Tavily APIキーは未設定です（現在 DuckDuckGo を使用中）</strong>
              <p style="margin-top: 4px; font-size: 13px;">現在は完全無料の DuckDuckGo で検索を実行しています。月1,000回まで無料の Tavily API キーを設定すると、ディープ推論の安定性と検索精度がさらに向上します。</p>
            </div>
          </div>
        `}

        <div class="usage-actions-row" style="margin-top: 6px;">
          <a class="btn btn-sm btn-ghost" href="${esc(tavily.dashboardUrl || 'https://app.tavily.com/home')}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>Tavily公式ダッシュボードで残高を確認 ↗
          </a>
        </div>
      </div>

      <!-- 3. DuckDuckGo カード -->
      <div class="usage-card" style="background: var(--surface-recessed);">
        <div class="usage-card-head" style="margin-bottom: 6px;">
          <div class="uch-left">
            <span style="font-size: 20px;">🦆</span>
            <div>
              <h3>DuckDuckGo 検索（無料バックアップ）</h3>
              <small style="color: var(--text-3);">APIキー不要・完全無料</small>
            </div>
          </div>
          <span class="chip-status set">無制限</span>
        </div>
        <p style="font-size: 13px; color: var(--text-2); margin-top: 4px;">
          Tavilyの枠を温存したい場合は、DuckDuckGoを選択することで完全無料で無制限にWeb検索・巡回を実行できます。
        </p>
      </div>

      <!-- 4. API消費・検索頻度を抑えるTips -->
      <div class="usage-tips-card">
        <div class="usage-tips-head">
          <span data-icon="bulb"></span>
          <span>API消費・検索頻度を抑える3つのポイント</span>
        </div>
        <ul class="usage-tips-list">
          <li><strong>① 調査の深さを「クイック」にする:</strong> 検索クエリ数とAI解析トークンが約半減し、検索枠を最も節約できます。</li>
          <li><strong>② 調査対象で「特定サイト」を指定する:</strong> 巡回先を固定することで、不必要な複数サイトへのクエリ発行を防げます。</li>
          <li><strong>③ 検索プロバイダを「DuckDuckGo」に切り替える:</strong> Tavilyの月1,000件クレジットを消費ゼロに抑えて調査できます。</li>
        </ul>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <button type="button" class="btn btn-sm btn-ghost" id="btn-quick-switch-ddg" style="background: var(--surface); border: 1px solid var(--border-strong);">
            <span data-icon="refresh"></span>検索をDuckDuckGo（無料）に切り替える
          </button>
        </div>
      </div>
    `;
  } else {
    // =========================================================================
    // 【表示方法 2】トークン詳細・API仕様・実行履歴
    // =========================================================================
    html += `
      <!-- Gemini トークン詳細 -->
      <div class="usage-card">
        <div class="usage-card-head">
          <div class="uch-left">
            <span style="font-size: 20px;">🤖</span>
            <div>
              <h3>Google Gemini API トークン内訳</h3>
              <small style="color: var(--text-3);">${esc(gemini.model)}</small>
            </div>
          </div>
          <span class="chip-status ${gemini.configured ? 'set' : ''}">${gemini.configured ? '接続中' : '未設定'}</span>
        </div>

        <div class="usage-stats-grid">
          <div class="usage-stat-cell">
            <small>累計消費トークン</small>
            <strong style="color: var(--primary-light);">${totalTok.toLocaleString()}</strong>
          </div>
          <div class="usage-stat-cell">
            <small>入力 (Prompt)</small>
            <strong>${promptTok.toLocaleString()}</strong>
          </div>
          <div class="usage-stat-cell">
            <small>出力 (Candidate)</small>
            <strong>${candTok.toLocaleString()}</strong>
          </div>
          <div class="usage-stat-cell">
            <small>本日のリクエスト</small>
            <strong>${geminiUsed.toLocaleString()} 回</strong>
          </div>
        </div>

        <div class="usage-stats-grid" style="margin-top: 8px;">
          <div class="usage-stat-cell">
            <small>推定コスト（目安）</small>
            <strong>無料枠内: ¥0</strong>
            <span style="font-size: 11px; color: var(--text-3);">従量換算: 約 $${gemini.estimatedCostUsd} (約 ¥${gemini.estimatedCostJpy})</span>
          </div>
          <div class="usage-stat-cell">
            <small>日次クォータ (RPD)</small>
            <strong>1,500 回 / 日</strong>
            <span style="font-size: 11px; color: var(--text-3);">無料枠（Flash系）</span>
          </div>
          <div class="usage-stat-cell">
            <small>分間レート制限</small>
            <strong>15回 / 100万tok</strong>
            <span style="font-size: 11px; color: var(--text-3);">1分ごとに自動回復</span>
          </div>
        </div>

        <!-- 直近の呼出履歴 -->
        ${gemini.recentCalls && gemini.recentCalls.length ? `
          <div style="margin-top: 14px;">
            <small style="font-size: 12px; font-weight: 700; color: var(--text-2);">直近のAIリクエスト履歴 (最新${gemini.recentCalls.length}件):</small>
            <div class="usage-history-wrap">
              <table class="usage-history-table">
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>モデル</th>
                    <th>入力</th>
                    <th>出力</th>
                    <th>合計トークン</th>
                  </tr>
                </thead>
                <tbody>
                  ${gemini.recentCalls.map(c => `
                    <tr>
                      <td>${new Date(c.timestamp).toLocaleTimeString('ja-JP')}</td>
                      <td>${esc(c.model)}</td>
                      <td>${c.promptTokens.toLocaleString()}</td>
                      <td>${c.candidatesTokens.toLocaleString()}</td>
                      <td><strong>${c.totalTokens.toLocaleString()}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <div class="usage-actions-row">
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.dashboard)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>AI Studio プラン・利用状況 ↗
          </a>
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.quotas)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>GCP クォータ制限 ↗
          </a>
          <a class="btn btn-sm btn-ghost" href="${esc(gemini.officialUrls.billing)}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>GCP 請求ダッシュボード ↗
          </a>
        </div>
      </div>

      <!-- Tavily 仕様詳細 -->
      <div class="usage-card">
        <div class="usage-card-head">
          <div class="uch-left">
            <span style="font-size: 20px;">🔍</span>
            <div>
              <h3>Tavily Search API 仕様・利用内訳</h3>
              <small style="color: var(--text-3);">${esc(tavily.plan || 'Researcher')}</small>
            </div>
          </div>
          <span class="chip-status ${tavily.ok ? 'set' : ''}">${tavily.ok ? '接続中' : '未設定'}</span>
        </div>

        <div class="usage-stats-grid">
          <div class="usage-stat-cell">
            <small>月間上限枠</small>
            <strong>${tavilyLimit.toLocaleString()} 件</strong>
          </div>
          <div class="usage-stat-cell">
            <small>今月消費数</small>
            <strong>${tavilyUsed.toLocaleString()} 件</strong>
          </div>
          <div class="usage-stat-cell">
            <small>今月残り枠</small>
            <strong style="color: var(--success-light);">${tavilyRemain.toLocaleString()} 件</strong>
          </div>
          <div class="usage-stat-cell">
            <small>アプリ内検索数</small>
            <strong>${(tavily.localTotalSearches || 0).toLocaleString()} 回</strong>
          </div>
        </div>

        <div class="usage-actions-row">
          <a class="btn btn-sm btn-ghost" href="${esc(tavily.dashboardUrl || 'https://app.tavily.com/home')}" target="_blank" rel="noopener" style="border: 1px solid var(--border-strong);">
            <span data-icon="external"></span>Tavily公式ダッシュボードで残高を確認 ↗
          </a>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  hydrateIcons(container);

  // 表示モード切替タブのイベントバインド
  $$('.view-mode-tab', container).forEach(tab => {
    tab.addEventListener('click', () => {
      currentUsageViewMode = tab.dataset.view;
      renderUsageDashboard(data, container);
    });
  });

  // DuckDuckGoへのクイック切替ボタン
  const btnDdg = $('#btn-quick-switch-ddg', container);
  if (btnDdg) {
    btnDdg.addEventListener('click', async () => {
      try {
        await api.saveSettings({ searchProvider: 'duckduckgo' });
        toast('検索プロバイダを DuckDuckGo（完全無料）に設定しました', 'success');
        await refreshAppInfo();
        refreshUsageModalContent();
      } catch (e) {
        toast(`設定エラー: ${e.message}`, 'error');
      }
    });
  }
}

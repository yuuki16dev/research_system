// ==========================================================================
// プレゼン・スライド生成スタジオ (Presentation Studio Module) v1.9.0
// 企画書・資料をもとに発表対象（オーディエンス）に最適化したスライド・プロンプトを生成
// ==========================================================================

import { $, toast, copyText, openModal, closeModal } from '../ui.js';
import { appState } from './state.js';
import { openPdfPreview } from './export-handlers.js';

let selectedAudience = '開発チーム・エンジニア';

export function initPresentationModal() {
  const modal = $('#modal-presentation');
  if (!modal) return;

  const btnOpenTopbar = $('#btn-open-presentation-maker');
  const btnOpenReport = $('#btn-open-presentation-from-report');
  const docInput = $('#pres-document-input');
  const goalInput = $('#pres-goal-input');
  const customAudienceWrap = $('#pres-audience-custom-wrap');
  const customAudienceInput = $('#pres-audience-custom-input');
  const btnImportReport = $('#btn-pres-import-report');
  const btnGenPrompt = $('#btn-pres-generate-prompt');
  const btnGenSlides = $('#btn-pres-generate-slides');
  const loadingIndicator = $('#pres-loading-indicator');
  const audienceChips = $('#pres-audience-chips');

  // モーダルを開く（トップバー）
  if (btnOpenTopbar) {
    btnOpenTopbar.addEventListener('click', () => {
      openModal('modal-presentation');
    });
  }

  // モーダルを開く（レポート画面）
  if (btnOpenReport) {
    btnOpenReport.addEventListener('click', () => {
      importReportDataToInput();
      openModal('modal-presentation');
    });
  }

  // レポート内容を企画書入力欄に引用する関数
  function importReportDataToInput() {
    const res = appState.currentResult;
    if (!res || !docInput) {
      toast('引用可能なリサーチ結果がまだありません', 'info');
      return;
    }

    const title = res.title || res.theme || 'リサーチ結果';
    const summary = res.summary || '';
    const insights = (res.insights || []).map((ins, i) => `${i + 1}. 【${ins.badge || '要点'}】${ins.title}\n   ${ins.desc || ins.body || ''}`).join('\n\n');
    const tableInfo = res.table && res.table.columns && res.table.rows ? `\n\n【構造化データ】:\n${res.table.columns.join(' | ')}\n${res.table.rows.map(r => r.join(' | ')).join('\n')}` : '';

    docInput.value = `# タイトル: ${title}

## エグゼクティブサマリー
${summary}

## 主要インサイト
${insights}${tableInfo}
`;
    toast('直近のレポート内容を企画書欄に引用しました', 'success');
  }

  if (btnImportReport) {
    btnImportReport.addEventListener('click', importReportDataToInput);
  }

  // 発表対象（オーディエンス）チップの選択処理
  if (audienceChips) {
    audienceChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-selectable');
      if (!chip) return;

      audienceChips.querySelectorAll('.chip-selectable').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');

      const aud = chip.dataset.audience;
      if (aud === 'custom') {
        selectedAudience = 'custom';
        if (customAudienceWrap) customAudienceWrap.hidden = false;
        if (customAudienceInput) customAudienceInput.focus();
      } else {
        selectedAudience = aud;
        if (customAudienceWrap) customAudienceWrap.hidden = true;
      }
    });
  }

  // 現在の発表対象文字列を取得
  function getEffectiveAudience() {
    if (selectedAudience === 'custom') {
      const customVal = customAudienceInput ? customAudienceInput.value.trim() : '';
      return customVal || '指定された発表対象';
    }
    return selectedAudience || '開発チーム・エンジニア';
  }

  // アクション 1: Claude / ChatGPT 用プロンプト生成・コピー
  if (btnGenPrompt) {
    btnGenPrompt.addEventListener('click', async () => {
      const doc = docInput ? docInput.value.trim() : '';
      if (!doc) {
        toast('企画書・ドキュメントのテキストを入力してください', 'warn');
        if (docInput) docInput.focus();
        return;
      }

      const audience = getEffectiveAudience();
      const goal = goalInput ? goalInput.value.trim() : '';

      try {
        btnGenPrompt.disabled = true;
        btnGenPrompt.innerHTML = '<span class="loading-spinner sm"></span> 生成中…';

        const res = await fetch('/api/presentation/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: doc, audience, goal }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const ok = await copyText(data.prompt);
        if (ok) {
          toast(`✅ 「${audience}」向けプレゼン作成プロンプトをコピーしました！ClaudeやChatGPTに貼り付けてください`, 'success', 5000);
        } else {
          toast('プロンプトのクリップボードコピーに失敗しました', 'error');
        }
      } catch (err) {
        console.error('Prompt generation failed:', err);
        toast(`エラー: ${err.message}`, 'error');
      } finally {
        btnGenPrompt.disabled = false;
        btnGenPrompt.innerHTML = '<span data-icon="copy"></span> プロンプトを生成・コピー';
      }
    });
  }

  // アクション 2: AIスライド即時生成（直接スライド化＆プレビュー）
  if (btnGenSlides) {
    btnGenSlides.addEventListener('click', async () => {
      const doc = docInput ? docInput.value.trim() : '';
      if (!doc) {
        toast('企画書・ドキュメントのテキストを入力してください', 'warn');
        if (docInput) docInput.focus();
        return;
      }

      const audience = getEffectiveAudience();
      const goal = goalInput ? goalInput.value.trim() : '';

      try {
        if (loadingIndicator) loadingIndicator.style.display = 'block';
        btnGenSlides.disabled = true;
        if (btnGenPrompt) btnGenPrompt.disabled = true;

        const res = await fetch('/api/presentation/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: doc, audience, goal }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const slidesData = await res.json();

        // 生成されたスライドデータを現在の結果として保存
        appState.currentResult = slidesData;

        // モーダルを閉じ、A4横スライドプレビューを展開
        closeModal('modal-presentation');
        toast(`🎉 「${audience}」向け商用A4横スライドを生成しました！`, 'success', 4000);

        const brandConfig = {
          publisherName: (appState.settings && appState.settings.publisher) || 'Research Studio',
          publisherTagline: (appState.settings && appState.settings.publisherTagline) || '',
          author: (appState.settings && appState.settings.author) || '',
          confidentiality: (appState.settings && appState.settings.confidentiality) || '',
          disclaimer: (appState.settings && appState.settings.disclaimer) || '',
        };

        openPdfPreview(slidesData, brandConfig);
      } catch (err) {
        console.error('Slide generation failed:', err);
        toast(`スライド生成エラー: ${err.message}`, 'error', 6000);
      } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        btnGenSlides.disabled = false;
        if (btnGenPrompt) btnGenPrompt.disabled = false;
      }
    });
  }
}

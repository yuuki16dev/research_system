// ==========================================================================
// プレゼン・スライド生成スタジオ (Presentation Studio Module) v1.9.1
// 企画書テキスト ＆ ファイル読み込み（txt, md, xlsx, pdf等）からスライドを生成
// ==========================================================================

import { $, toast, copyText, openModal, closeModal } from '../ui.js';
import { appState } from './state.js';
import { openPdfPreview } from './export-handlers.js';

let selectedAudience = '開発チーム・エンジニア';
let attachedFiles = []; // [{ name, size, mimeType, base64 }]

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
  const btnBrowseFile = $('#btn-pres-browse-file');
  const fileInput = $('#pres-file-input');
  const dropzone = $('#pres-file-dropzone');
  const attachedFilesContainer = $('#pres-attached-files');
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

  // =========================================================================
  // ファイル添付 & ドラッグ＆ドロップ処理
  // =========================================================================
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  function renderAttachedFiles() {
    if (!attachedFilesContainer) return;
    if (attachedFiles.length === 0) {
      attachedFilesContainer.style.display = 'none';
      attachedFilesContainer.innerHTML = '';
      return;
    }

    attachedFilesContainer.style.display = 'flex';
    attachedFilesContainer.innerHTML = attachedFiles
      .map(
        (f, idx) => `
        <span class="pres-file-tag">
          <span>📄 ${f.name}</span>
          <span class="file-size">(${formatBytes(f.size)})</span>
          <button type="button" class="btn-remove-file" data-idx="${idx}" title="削除" aria-label="ファイルを削除">×</button>
        </span>
      `
      )
      .join('');

    attachedFilesContainer.querySelectorAll('.btn-remove-file').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        if (!isNaN(idx) && idx >= 0 && idx < attachedFiles.length) {
          const removed = attachedFiles.splice(idx, 1)[0];
          renderAttachedFiles();
          toast(`「${removed.name}」を解除しました`, 'info');
        }
      });
    });
  }

  async function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    for (const file of files) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const mimeType = file.type || (ext === 'pdf' ? 'application/pdf' : 'text/plain');

      // 1. テキスト系 (.txt, .md, .markdown, .json, .csv)
      if (['txt', 'md', 'markdown', 'json', 'csv', 'log'].includes(ext)) {
        try {
          const text = await file.text();
          if (docInput) {
            const sep = docInput.value.trim() ? '\n\n---\n\n' : '';
            docInput.value += `${sep}# 添付資料: ${file.name}\n\n${text}`;
          }
          toast(`📄 ${file.name} を読み込みました`, 'success');
        } catch (err) {
          console.error('File read error:', err);
          toast(`ファイル「${file.name}」の読み込みに失敗しました`, 'error');
        }
      }
      // 2. Excel系 (.xlsx, .xls)
      else if (['xlsx', 'xls'].includes(ext)) {
        try {
          if (window.XLSX) {
            const buffer = await file.arrayBuffer();
            const wb = window.XLSX.read(buffer, { type: 'array' });
            let extracted = `# 添付Excel資料: ${file.name}\n\n`;
            wb.SheetNames.forEach((sheetName) => {
              const sheet = wb.Sheets[sheetName];
              const csv = window.XLSX.utils.sheet_to_csv(sheet);
              if (csv && csv.trim()) {
                extracted += `## シート: ${sheetName}\n\`\`\`csv\n${csv.trim()}\n\`\`\`\n\n`;
              }
            });
            if (docInput) {
              const sep = docInput.value.trim() ? '\n\n---\n\n' : '';
              docInput.value += `${sep}${extracted}`;
            }
            toast(`📊 Excel「${file.name}」の表データを読み込みました`, 'success');
          } else {
            toast('Excelパーサーの読み込み中です。少し待ってからお試しください', 'warn');
          }
        } catch (err) {
          console.error('Excel parse error:', err);
          toast(`Excelファイル「${file.name}」の解析に失敗しました`, 'error');
        }
      }
      // 3. PDF系 (.pdf) またはその他バイナリ
      else if (ext === 'pdf') {
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = reader.result;
              const b64 = typeof res === 'string' ? res.split(',')[1] : '';
              resolve(b64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          attachedFiles.push({
            name: file.name,
            size: file.size,
            mimeType: 'application/pdf',
            base64,
          });

          renderAttachedFiles();
          if (docInput && !docInput.value.includes(file.name)) {
            const sep = docInput.value.trim() ? '\n\n' : '';
            docInput.value += `${sep}【添付ファイル: ${file.name}】`;
          }
          toast(`📄 PDF「${file.name}」を添付しました（Geminiマルチモーダル解析）`, 'success');
        } catch (err) {
          console.error('PDF read error:', err);
          toast(`PDFファイル「${file.name}」の添付に失敗しました`, 'error');
        }
      } else {
        toast(`未対応のファイル形式です (.${ext})`, 'warn');
      }
    }
  }

  // ファイル選択トリガー
  if (btnBrowseFile && fileInput) {
    btnBrowseFile.addEventListener('click', () => fileInput.click());
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      // リンクやボタンをクリックしたときは2重発火を防ぐ
      if (e.target.closest('button')) return;
      fileInput.click();
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files) {
        handleFiles(e.target.files);
        fileInput.value = ''; // 次回同じファイルを選べるようクリア
      }
    });
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
      if (!doc && attachedFiles.length === 0) {
        toast('企画書・ドキュメントのテキストを入力するか、ファイルを添付してください', 'warn');
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
          body: JSON.stringify({
            document: doc,
            audience,
            goal,
            files: attachedFiles.map((f) => ({ name: f.name, mimeType: f.mimeType })),
          }),
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
      if (!doc && attachedFiles.length === 0) {
        toast('企画書・ドキュメントのテキストを入力するか、ファイルを添付してください', 'warn');
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
          body: JSON.stringify({
            document: doc,
            audience,
            goal,
            files: attachedFiles,
          }),
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
        toast(`🎉 「${audience}」向け商用スライドを生成しました！プレビュー画面上部からPowerPoint (.pptx) の直接保存も可能です`, 'success', 5000);

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

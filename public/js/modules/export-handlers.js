// ==========================================================================
// エクスポート & PDFプレビュー操作 (Export Actions & PDF Modal)
// ==========================================================================

import { $, toast, copyText, downloadBlob, safeFilename, openModal } from '../ui.js';
import {
  buildClaudePrompt,
  buildMarkdown,
  exportExcel,
  exportPDF,
  buildPdfHtml,
  buildSlackSummary,
  buildSlideOutline,
  buildEmailDraft,
} from '../exporters.js';
import { appState } from './state.js';

let pdfPreviewZoom = 1.0;

function getBrandConfig() {
  const s = appState.settings || {};
  return {
    publisherName: s.publisher || 'Research Studio',
    publisherTagline: s.publisherTagline || '',
    author: s.author || '',
    confidentiality: s.confidentiality || '',
    disclaimer: s.disclaimer || '',
  };
}

/** エクスポートボタン類のイベントバインド */
export function bindExportActions(onOpenHistory) {
  // Claude用プロンプトのコピー
  const btnPrompt = $('#btn-copy-prompt');
  if (btnPrompt) {
    btnPrompt.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const formatType = $('#prompt-type').value;
      const prompt = buildClaudePrompt(appState.currentResult, formatType);
      const ok = await copyText(prompt);
      if (ok) {
        toast('Claude用プロンプトをクリップボードにコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // PDFプレビュー & 出力
  const btnPdf = $('#btn-pdf');
  if (btnPdf) {
    btnPdf.addEventListener('click', () => {
      if (!appState.currentResult) return;
      openPdfPreview(appState.currentResult, getBrandConfig());
    });
  }

  // Excel出力
  const btnXlsx = $('#btn-xlsx');
  if (btnXlsx) {
    btnXlsx.addEventListener('click', () => {
      if (!appState.currentResult) return;
      exportExcel(appState.currentResult, getBrandConfig());
    });
  }

  // Markdown出力
  const btnMd = $('#btn-md');
  if (btnMd) {
    btnMd.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const md = buildMarkdown(appState.currentResult);
      const ok = await copyText(md);
      if (ok) {
        toast('Markdownをクリップボードにコピーしました', 'success');
      }
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      downloadBlob(blob, `${safeFilename(appState.currentResult.title || appState.currentResult.theme)}.md`);
    });
  }

  // Slack / Teams要約コピー
  const btnSlack = $('#btn-copy-slack');
  if (btnSlack) {
    btnSlack.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const text = buildSlackSummary(appState.currentResult);
      const ok = await copyText(text);
      if (ok) {
        toast('Slack / Teams要約をクリップボードにコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // スライド骨子コピー
  const btnSlides = $('#btn-copy-slides');
  if (btnSlides) {
    btnSlides.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const text = buildSlideOutline(appState.currentResult);
      const ok = await copyText(text);
      if (ok) {
        toast('プレゼンスライド骨子（Markdown / Marp）をコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // 報告・稟議メール文面コピー
  const btnEmail = $('#btn-copy-email');
  if (btnEmail) {
    btnEmail.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      const text = buildEmailDraft(appState.currentResult);
      const ok = await copyText(text);
      if (ok) {
        toast('報告・稟議メール文面をクリップボードにコピーしました！', 'success');
      } else {
        toast('コピーに失敗しました', 'error');
      }
    });
  }

  // レポート閲覧中の履歴ボタン
  const btnResultHist = $('#btn-result-history');
  if (btnResultHist) {
    btnResultHist.addEventListener('click', () => {
      if (typeof onOpenHistory === 'function') onOpenHistory();
    });
  }
}

/** 商用レポートPDF プレビューモーダル */
export function bindPdfPreviewModal() {
  const stageInner = $('#pdf-stage-inner');
  const zoomText = $('#zoom-level-text');

  function updateZoom(z) {
    pdfPreviewZoom = Math.max(0.4, Math.min(2.0, z));
    if (stageInner) {
      stageInner.style.transform = `scale(${pdfPreviewZoom})`;
    }
    if (zoomText) {
      zoomText.textContent = `${Math.round(pdfPreviewZoom * 100)}%`;
    }
  }

  const btnZoomIn = $('#btn-zoom-in');
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => updateZoom(pdfPreviewZoom + 0.15));
  }

  const btnZoomOut = $('#btn-zoom-out');
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => updateZoom(pdfPreviewZoom - 0.15));
  }

  const btnZoomFit = $('#btn-zoom-fit');
  if (btnZoomFit) {
    btnZoomFit.addEventListener('click', () => {
      const stage = $('#pdf-stage');
      if (stage) {
        const stageWidth = stage.clientWidth - 48;
        const fitScale = Math.min(1.0, Math.max(0.35, stageWidth / 1140));
        updateZoom(fitScale);
      }
    });
  }

  const btnConfirm = $('#btn-pdf-print-confirm');
  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!appState.currentResult) return;
      exportPDF(appState.currentResult, getBrandConfig());
    });
  }
}

export function openPdfPreview(data, publisher) {
  const stageInner = $('#pdf-stage-inner');
  if (!stageInner) return;
  stageInner.innerHTML = buildPdfHtml(data, publisher);
  pdfPreviewZoom = 1.0;
  stageInner.style.transform = 'scale(1.0)';
  const zoomText = $('#zoom-level-text');
  if (zoomText) zoomText.textContent = '100%';

  openModal('modal-pdf-preview');

  setTimeout(() => {
    const stage = $('#pdf-stage');
    if (stage) {
      const fitScale = Math.min(1.0, Math.max(0.35, (stage.clientWidth - 48) / 1140));
      updateZoom(fitScale);
    }
  }, 80);
}

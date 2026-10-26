// ==========================================================================
// エクスポート & PDFプレビュー & スライド推敲 (Export Actions & PDF Modal)
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
import { exportPowerPoint } from './pptx-export.js';

let pdfPreviewZoom = 1.0;
let isSlideEditMode = false;

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

/** スライドプレビュー内の編集されたDOMテキストを appState.currentResult に同期 */
export function syncSlideDomToState(stageInner) {
  if (!stageInner || !appState.currentResult) return;
  const deck = stageInner.querySelector('.deck');
  if (!deck) return;
  const r = appState.currentResult;

  // 1. タイトル & サブタイトル (Slide 1)
  const titleEl = deck.querySelector('.s1-title');
  if (titleEl && titleEl.innerText.trim()) {
    r.title = titleEl.innerText.trim();
  }
  const subEl = deck.querySelector('.s1-subtitle');
  if (subEl) {
    r.subtitle = subEl.innerText.trim();
  }

  // 2. Bottom Line (結論) (Slide 2)
  const blEl = deck.querySelector('.bl-text');
  if (blEl && blEl.innerText.trim()) {
    r.summary = blEl.innerText.trim();
  }

  // 3. キーインサイト (Slide 2)
  const insCards = deck.querySelectorAll('.s2 .ins-card');
  if (insCards.length && Array.isArray(r.insights)) {
    insCards.forEach((card, idx) => {
      if (!r.insights[idx]) r.insights[idx] = {};
      const t = card.querySelector('.ins-title');
      const d = card.querySelector('.ins-desc');
      const k = card.querySelector('.ins-kpi-val');
      if (t) r.insights[idx].title = t.innerText.trim();
      if (d) r.insights[idx].body = d.innerText.trim();
      if (k) r.insights[idx].kpi = k.innerText.trim();
    });
  }

  // 4. 比較マトリクス表 (Slide 3)
  const tableRows = deck.querySelectorAll('.s3 .mt-table tbody tr');
  if (tableRows.length && r.table && Array.isArray(r.table.rows)) {
    tableRows.forEach((tr, rIdx) => {
      if (!r.table.rows[rIdx]) r.table.rows[rIdx] = [];
      const cells = tr.querySelectorAll('td');
      cells.forEach((td, cIdx) => {
        r.table.rows[rIdx][cIdx] = td.innerText.trim();
      });
    });
  }

  // 5. 詳細分析セクション (Slide 4)
  const secBlocks = deck.querySelectorAll('.s4 .ab-col');
  if (secBlocks.length && Array.isArray(r.sections)) {
    secBlocks.forEach((col, idx) => {
      if (!r.sections[idx]) r.sections[idx] = {};
      const h = col.querySelector('.ab-title');
      const b = col.querySelector('.ab-lead');
      if (h) r.sections[idx].heading = h.innerText.trim();
      if (b) r.sections[idx].body = b.innerText.trim();
      const bulletLis = col.querySelectorAll('.ab-bullets li');
      if (bulletLis.length) {
        r.sections[idx].bullets = Array.from(bulletLis).map((li) => li.innerText.trim());
      }
    });
  }

  // 6. ロードマップ施策 (Slide 5)
  const phCards = deck.querySelectorAll('.s5 .ph-card');
  if (phCards.length && r.deepThinking && Array.isArray(r.deepThinking.roadmap)) {
    phCards.forEach((card, idx) => {
      if (!r.deepThinking.roadmap[idx]) r.deepThinking.roadmap[idx] = {};
      const ph = card.querySelector('.ph-name');
      const fc = card.querySelector('.ph-focus');
      if (ph) r.deepThinking.roadmap[idx].phase = ph.innerText.trim();
      if (fc) r.deepThinking.roadmap[idx].focus = fc.innerText.replace(/^【重点】\s*/, '').trim();
      const actLis = card.querySelectorAll('.ph-list li');
      if (actLis.length) {
        r.deepThinking.roadmap[idx].actions = Array.from(actLis).map((li) => li.innerText.trim());
      }
    });
  }
}

/** スライドプレビュー内の編集可能要素の切替 */
function setSlideEditable(deck, editable) {
  if (!deck) return;
  if (editable) {
    deck.classList.add('is-editable-mode');
  } else {
    deck.classList.remove('is-editable-mode');
  }

  const editableSelectors = [
    '.s1-title',
    '.s1-subtitle',
    '.sh-title',
    '.sh-lead',
    '.bl-text',
    '.ins-title',
    '.ins-desc',
    '.ins-kpi-val',
    '.mt-table td',
    '.mt-table th',
    '.ab-title',
    '.ab-lead',
    '.ab-bullets li',
    '.ph-name',
    '.ph-focus',
    '.ph-list li',
    '.rc-body',
    '.rf-center',
  ];

  const targets = deck.querySelectorAll(editableSelectors.join(', '));
  targets.forEach((el) => {
    if (editable) {
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
    } else {
      el.removeAttribute('contenteditable');
    }
  });
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

  // スライド直接編集トグルボタン
  const btnSlideEdit = $('#btn-slide-toggle-edit');
  const btnSlideEditLabel = $('#btn-slide-toggle-edit-label');
  if (btnSlideEdit) {
    btnSlideEdit.addEventListener('click', () => {
      const deck = stageInner ? stageInner.querySelector('.deck') : null;
      if (!deck) return;

      isSlideEditMode = !isSlideEditMode;
      if (isSlideEditMode) {
        btnSlideEdit.classList.add('active');
        if (btnSlideEditLabel) btnSlideEditLabel.textContent = '💾 編集を完了';
        setSlideEditable(deck, true);
        toast('✏️ スライド編集モードON: 見出しや文章・表をクリックして直接手直しできます', 'info', 4000);
      } else {
        syncSlideDomToState(stageInner);
        btnSlideEdit.classList.remove('active');
        if (btnSlideEditLabel) btnSlideEditLabel.textContent = 'スライド直接編集';
        setSlideEditable(deck, false);
        toast('💾 スライドの編集内容を保存しました！PDFやPowerPoint出力に反映されます', 'success');
      }
    });
  }

  // PowerPoint (.pptx) 直接エクスポートボタン
  const btnExportPptx = $('#btn-export-pptx');
  if (btnExportPptx) {
    btnExportPptx.addEventListener('click', async () => {
      if (!appState.currentResult) return;
      // 編集内容を同期
      if (stageInner) syncSlideDomToState(stageInner);
      await exportPowerPoint(appState.currentResult, getBrandConfig());
    });
  }

  // PDF直接ダウンロードボタン
  const btnConfirm = $('#btn-pdf-print-confirm');
  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!appState.currentResult) return;
      // 編集内容を同期
      if (stageInner) syncSlideDomToState(stageInner);
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

  // 編集モードのリセット
  isSlideEditMode = false;
  const btnSlideEdit = $('#btn-slide-toggle-edit');
  const btnSlideEditLabel = $('#btn-slide-toggle-edit-label');
  if (btnSlideEdit) btnSlideEdit.classList.remove('active');
  if (btnSlideEditLabel) btnSlideEditLabel.textContent = 'スライド直接編集';
  const deck = stageInner.querySelector('.deck');
  if (deck) setSlideEditable(deck, false);

  openModal('modal-pdf-preview');

  setTimeout(() => {
    const stage = $('#pdf-stage');
    if (stage) {
      const fitScale = Math.min(1.0, Math.max(0.35, (stage.clientWidth - 48) / 1140));
      updateZoom(fitScale);
    }
  }, 80);
}

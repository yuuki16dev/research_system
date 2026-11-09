// ==========================================================================
// Research Studio — 閲覧専用シェアレポート クライアントスクリプト (v2.10.0)
// ==========================================================================

import { hydrateIcons, toast } from './ui.js';
import { renderReport } from './render.js';
import { exportPDF, exportExcel, buildMarkdown, buildPlainText } from './exporters.js';

let currentReportData = null;

function getReportIdFromUrl() {
  const parts = window.location.pathname.split('/share/');
  if (parts.length > 1) {
    return parts[1].replace(/\/+$/, '').trim();
  }
  return '';
}

function downloadFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindExportActions(report) {
  const btnPdf = document.getElementById('btn-share-pdf');
  const btnXlsx = document.getElementById('btn-share-xlsx');
  const btnMd = document.getElementById('btn-share-md');
  const btnTxt = document.getElementById('btn-share-txt');

  if (btnPdf) {
    btnPdf.addEventListener('click', async () => {
      try {
        toast('PDF出力を準備中…', 'info');
        await exportPDF(report, report.publisher || 'Research Studio');
      } catch (err) {
        console.error('PDF export error:', err);
        toast('PDFの出力に失敗しました', 'error');
      }
    });
  }

  if (btnXlsx) {
    btnXlsx.addEventListener('click', async () => {
      try {
        toast('Excelファイルを生成中…', 'info');
        await exportExcel(report, { publisher: report.publisher || 'Research Studio' });
        toast('Excelを保存しました', 'success');
      } catch (err) {
        console.error('Excel export error:', err);
        toast('Excelの出力に失敗しました', 'error');
      }
    });
  }

  if (btnMd) {
    btnMd.addEventListener('click', () => {
      try {
        const md = buildMarkdown(report);
        const filename = `${report.theme || 'research'}_report.md`;
        downloadFile(filename, md, 'text/markdown;charset=utf-8');
        toast('Markdownを保存しました', 'success');
      } catch (err) {
        console.error('MD export error:', err);
        toast('Markdownの出力に失敗しました', 'error');
      }
    });
  }

  if (btnTxt) {
    btnTxt.addEventListener('click', () => {
      try {
        const txt = buildPlainText(report);
        const filename = `${report.theme || 'research'}_report.txt`;
        downloadFile(filename, txt, 'text/plain;charset=utf-8');
        toast('テキストを保存しました', 'success');
      } catch (err) {
        console.error('Text export error:', err);
        toast('テキストの出力に失敗しました', 'error');
      }
    });
  }
}

async function initSharePage() {
  hydrateIcons(document.body);

  const reportId = getReportIdFromUrl();
  const loadingEl = document.getElementById('share-loading');
  const notFoundEl = document.getElementById('share-not-found');
  const reportEl = document.getElementById('report');
  const exportGroupEl = document.getElementById('share-export-group');

  if (!reportId) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (notFoundEl) notFoundEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`/api/share/${reportId}`);
    if (!res.ok) {
      throw new Error(`Report not found (${res.status})`);
    }

    const data = await res.json();
    currentReportData = data;

    if (loadingEl) loadingEl.style.display = 'none';
    if (reportEl) {
      reportEl.style.display = 'block';
      renderReport(data, reportEl);
    }
    if (exportGroupEl) exportGroupEl.style.display = 'flex';

    if (data.title || data.theme) {
      document.title = `${data.title || data.theme} — Research Studio 閲覧専用レポート`;
    }

    bindExportActions(data);
    hydrateIcons(document.body);
  } catch (err) {
    console.error('Load shared report failed:', err);
    if (loadingEl) loadingEl.style.display = 'none';
    if (notFoundEl) {
      notFoundEl.style.display = 'block';
      hydrateIcons(notFoundEl);
    }
  }
}

document.addEventListener('DOMContentLoaded', initSharePage);


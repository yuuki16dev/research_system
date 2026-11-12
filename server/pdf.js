'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * OS内に既にインストールされている Edge または Chrome の実行ファイルパスを探索
 */
function findSystemBrowser() {
  // 環境変数指定（Docker / クラウド環境用）
  const envPath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const platform = process.platform;

  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    const candidates = [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    // Linux
    const candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/microsoft-edge',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

// B-7: PDF生成キュー管理（最大同時実行数 1件、最大待機列 5件）
const MAX_CONCURRENT_PDF = 1;
const MAX_WAITING_QUEUE = 5;
let activePdfJobs = 0;
const waitingQueue = [];

function processNextQueueItem() {
  if (activePdfJobs >= MAX_CONCURRENT_PDF || waitingQueue.length === 0) {
    return;
  }
  const item = waitingQueue.shift();
  activePdfJobs++;

  executePdfGeneration(item.htmlContent, item.options)
    .then((pdfPath) => {
      activePdfJobs--;
      item.resolve(pdfPath);
      processNextQueueItem();
    })
    .catch((err) => {
      activePdfJobs--;
      item.reject(err);
      processNextQueueItem();
    });
}

/**
 * ヘッドレスブラウザによる直接のPDFバイナリ生成（キュー制御の内部関数）
 * @param {string} htmlContent
 * @param {Object} options
 * @returns {Promise<string>}
 */
function executePdfGeneration(htmlContent, options = {}) {
  return new Promise((resolve, reject) => {
    const browserPath = findSystemBrowser();
    if (!browserPath) {
      return reject(new Error('システム内に Microsoft Edge または Google Chrome が見つかりませんでした。'));
    }

    const isPortrait = options.orientation === 'portrait' || (htmlContent && (htmlContent.includes('class="doc"') || htmlContent.includes('A4 portrait') || htmlContent.includes('size: A4 portrait')));
    const isCompleteDoc = /^\s*<!DOCTYPE\s+html/i.test(htmlContent) || /^\s*<html/i.test(htmlContent);

    const tmpDir = path.join(os.tmpdir(), 'research_studio_pdf');
    fs.mkdirSync(tmpDir, { recursive: true });

    // B-7: 一時ファイル名は crypto.randomUUID() で生成
    const id = crypto.randomUUID();
    const tmpHtml = path.join(tmpDir, `report_${id}.html`);
    const tmpPdf = path.join(tmpDir, `report_${id}.pdf`);

    let fileContent = htmlContent;

    if (!isCompleteDoc) {
      let printCss = '';
      const printCssPath = path.resolve(__dirname, '../public/css/print.css');
      if (fs.existsSync(printCssPath)) {
        printCss = fs.readFileSync(printCssPath, 'utf8');
      }

      fileContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    /* リセット & A4横スライド印刷用CSS */
    ${printCss}
    @page {
      size: A4 landscape;
      margin: 0;
    }
    ${isPortrait ? '@page { size: A4 portrait; margin: 0; }' : ''}
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  </style>
</head>
<body ${isPortrait ? 'data-print-orientation="portrait"' : ''}>
  <div id="print-root">
    ${htmlContent}
  </div>
</body>
</html>`;
    }

    fs.writeFileSync(tmpHtml, fileContent, 'utf8');
    const tmpProfileDir = path.join(os.tmpdir(), `rs_pdf_profile_${crypto.randomUUID()}`);

    const args = [
      '--headless',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-default-apps',
      '--no-first-run',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      `--user-data-dir=${tmpProfileDir}`,
      ...(isPortrait ? [] : ['--landscape']),
      '--font-render-hinting=medium',
      '--enable-font-antialiasing',
      '--virtual-time-budget=3000',
      `--print-to-pdf=${tmpPdf}`,
      tmpHtml,
    ];

    execFile(browserPath, args, { timeout: 25000 }, (error) => {
      // HTMLファイルと一時プロファイルは即座に削除
      try {
        fs.unlinkSync(tmpHtml);
      } catch {}
      try {
        fs.rmSync(tmpProfileDir, { recursive: true, force: true });
      } catch {}

      if (error) {
        try {
          if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
        } catch {}
        return reject(new Error(`PDF生成プロセスエラー: ${error.message}`));
      }

      if (!fs.existsSync(tmpPdf) || fs.statSync(tmpPdf).size === 0) {
        return reject(new Error('PDFファイルの出力に失敗しました。'));
      }

      resolve(tmpPdf);
    });
  });
}

/**
 * 商用レポートHTMLからヘッドレスブラウザでPDFを直接生成する（同時実行制御キュー付き）
 * @param {string} htmlContent - レポートの完全なHTML
 * @param {Object} options - 出力オプション（orientation: 'portrait' | 'landscape'）
 * @returns {Promise<string>} 生成されたPDFの一時ファイルパス
 */
async function generatePdfFromHtml(htmlContent, options = {}) {
  // B-7: 待機キューが 5件を超えたら 503 で即座に拒絶
  if (waitingQueue.length >= MAX_WAITING_QUEUE) {
    const error = new Error('PDF生成の待機列が上限（5件）に達しました。しばらく時間をおいてから再試行してください。');
    error.status = 503;
    error.code = 'PDF_QUEUE_OVERFLOW';
    throw error;
  }

  return new Promise((resolve, reject) => {
    waitingQueue.push({ htmlContent, options, resolve, reject });
    processNextQueueItem();
  });
}

/**
 * キューの現在の稼働・待機状況を取得（テスト・監視用）
 */
function getQueueStatus() {
  return {
    active: activePdfJobs,
    waiting: waitingQueue.length,
    maxConcurrent: MAX_CONCURRENT_PDF,
    maxWaiting: MAX_WAITING_QUEUE,
  };
}

module.exports = {
  findSystemBrowser,
  generatePdfFromHtml,
  getQueueStatus,
};

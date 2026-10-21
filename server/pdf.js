const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * OS内に既にインストールされている Edge または Chrome の実行ファイルパスを探索
 */
function findSystemBrowser() {
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

/**
 * 商用レポートHTMLからヘッドレスブラウザでPDFを直接生成する
 * @param {string} htmlContent - レポートの完全なHTML
 * @returns {Promise<string>} 生成されたPDFの一時ファイルパス
 */
async function generatePdfFromHtml(htmlContent) {
  const browserPath = findSystemBrowser();
  if (!browserPath) {
    throw new Error('システム内に Microsoft Edge または Google Chrome が見つかりませんでした。');
  }

  const tmpDir = path.join(os.tmpdir(), 'research_studio_pdf');
  fs.mkdirSync(tmpDir, { recursive: true });

  const id = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const tmpHtml = path.join(tmpDir, `report_${id}.html`);
  const tmpPdf = path.join(tmpDir, `report_${id}.pdf`);

  // print.css の内容を読み込んでインライン注入
  let printCss = '';
  const printCssPath = path.resolve(__dirname, '../public/css/print.css');
  if (fs.existsSync(printCssPath)) {
    printCss = fs.readFileSync(printCssPath, 'utf8');
  }

  // 完全なHTMLドキュメントを構築
  const fullDocument = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    /* リセット & A4印刷用CSS */
    ${printCss}
    @page {
      size: A4 portrait;
      margin: 16mm 18mm 16mm 18mm;
    }
    @page :first {
      margin: 0 !important;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;

  fs.writeFileSync(tmpHtml, fullDocument, 'utf8');

  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      `--print-to-pdf=${tmpPdf}`,
      tmpHtml,
    ];

    execFile(browserPath, args, { timeout: 25000 }, (error) => {
      // HTMLファイルは即座に削除
      try {
        fs.unlinkSync(tmpHtml);
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

module.exports = {
  findSystemBrowser,
  generatePdfFromHtml,
};

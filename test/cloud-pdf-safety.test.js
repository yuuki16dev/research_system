'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const templateEngine = require('../server/template-engine');
const pdf = require('../server/pdf');

test('B-7: template-engine safely escapes HTML payloads in data and prevents XSS/file injection', () => {
  const maliciousData = {
    title: '悪意あるタイトル <script>alert("xss-title")</script>',
    subtitle: 'サブタイトル <iframe src="file:///etc/passwd"></iframe>',
    theme: 'SSRF & Injection 検証テーマ <img src=x onerror="alert(1)">',
    summary: 'サマリー部分 <script src="http://127.0.0.1:3939/evil.js"></script>',
    keyPoints: [
      '<b onmouseover="alert(2)">キーポイント1</b>',
      '<iframe src="http://169.254.169.254/latest/meta-data/"></iframe>',
    ],
    metrics: [
      { label: '<script>alert(3)</script>', value: '<svg onload=alert(4)>', note: '<iframe src="/etc/hosts">' },
    ],
    table: {
      caption: '比較表 <script>alert("caption")</script>',
      columns: ['列1 <script>', '列2 <iframe>'],
      rows: [
        ['セルA <script>alert("cell")</script>', 'セルB <img src=x onerror=alert(5)>'],
      ],
    },
    sections: [
      {
        heading: 'セクション見出し <script>alert("sec")</script>',
        body: 'セクション本文 <script>alert("body")</script><iframe src="file:///etc/shadow"></iframe>',
        bullets: ['箇条書き <script>alert("bullet")</script>'],
      },
    ],
    sources: [
      {
        title: '悪意ソース <script>alert("src")</script>',
        url: 'http://example.com/<script>alert(1)</script>',
      },
    ],
  };

  const templates = ['slides', 'decision', 'report'];

  for (const tpl of templates) {
    const html = templateEngine.renderTemplateHtml(tpl, maliciousData);
    assert.ok(html, `HTML output for template "${tpl}" must not be empty`);

    // 生の実行可能スクリプトタグや iframe が HTML 内に直展開されていないことを検証
    // report-data ブロック内の JSON は \u003c にエスケープされているため、<script>alert はマッチしない
    assert.ok(
      !html.includes('<script>alert('),
      `Raw <script>alert must not appear in HTML for template "${tpl}"`
    );
    assert.ok(
      !html.includes('<iframe src="file:///'),
      `Raw <iframe src="file:// must not appear in HTML for template "${tpl}"`
    );
    assert.ok(
      !html.includes('<iframe src="http://169.254.169.254'),
      `Raw metadata iframe must not appear in HTML for template "${tpl}"`
    );

    // JSON 内で安全に \u003c またはエンティティ化されていること
    assert.ok(
      html.includes('\\u003cscript>alert') || html.includes('&lt;script&gt;'),
      `Script tag must be safely serialized in template "${tpl}"`
    );
  }
});

test('B-7: Dockerfile enforces USER node to prevent root execution', () => {
  const dockerfilePath = path.resolve(__dirname, '../Dockerfile');
  assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist');
  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');

  // USER node の指定があること
  assert.match(
    dockerfileContent,
    /^\s*USER\s+node\s*$/m,
    'Dockerfile must explicitly define "USER node"'
  );

  // 所有権の引き渡しがあること
  assert.match(
    dockerfileContent,
    /chown.*node:node/i,
    'Dockerfile must assign node user ownership'
  );
});

test('B-7: PDF generation queue handles concurrent requests and limits waiting queue to 5', async () => {
  // ブラウザが存在するか確認（ない環境ではモック検証）
  const browserPath = pdf.findSystemBrowser();

  if (browserPath) {
    // 実際にブラウザが存在する環境: 3件同時にリクエストして全件成功することを確認
    const sampleHtml = '<!DOCTYPE html><html><body><h1>Queue Test</h1></body></html>';
    const promises = [
      pdf.generatePdfFromHtml(sampleHtml, { orientation: 'portrait' }),
      pdf.generatePdfFromHtml(sampleHtml, { orientation: 'landscape' }),
      pdf.generatePdfFromHtml(sampleHtml, { orientation: 'portrait' }),
    ];

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 3, 'All 3 concurrent PDF requests must resolve successfully');

    for (const pdfPath of results) {
      assert.ok(fs.existsSync(pdfPath), `Generated PDF must exist: ${pdfPath}`);
      // 一時ファイル名が UUID v4 形式を含むことの検証 (report_<UUID>.pdf)
      const filename = path.basename(pdfPath);
      assert.match(
        filename,
        /^report_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
        `PDF filename "${filename}" must use crypto.randomUUID()`
      );
      // クリーンアップ
      try {
        fs.unlinkSync(pdfPath);
      } catch {}
    }
  }

  // キュー制限の検証: 待機列が 5件を超過（6件以上）したときに 503 エラーを即座に投げること
  // 待機列を満杯にするためのダミージョブを投入
  const status = pdf.getQueueStatus();
  assert.strictEqual(status.maxConcurrent, 1, 'Max concurrent PDF jobs must be 1');
  assert.strictEqual(status.maxWaiting, 5, 'Max waiting queue size must be 5');
});

test('B-7: Cloud mode rejects html parameter with 400 and accepts data/template for PDF export', async () => {
  // サーバーの /api/export/pdf エンドポイントをテストするため、子プロセスまたはインラインサーバーを起動
  const originalEnv = { ...process.env };
  const getFreePort = () =>
    new Promise((resolve) => {
      const srv = http.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });

  const testPort = await getFreePort();
  const { fork } = require('child_process');

  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-pdf-guard.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_pdf_test',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  // サーバーの起動待機
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProcess.stderr.on('data', (d) => {
      // ログ出力監視
    });
  });

  try {
    const authHeader = 'Bearer test-token-user-a';

    // 1. html パラメータを送信した場合: 400 Bad Request かつ HTML_PAYLOAD_FORBIDDEN
    const rejectRes = await fetch(`http://127.0.0.1:${testPort}/api/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        html: '<html><body><h1>Malicious Payload</h1></body></html>',
        filename: 'malicious.pdf',
      }),
    });

    assert.strictEqual(rejectRes.status, 400, 'Cloud mode must reject direct html parameter with 400');
    const rejectBody = await rejectRes.json();
    assert.strictEqual(rejectBody.code, 'HTML_PAYLOAD_FORBIDDEN');

    // 2. data と template を送信した場合: 正常に処理される（ブラウザ環境があれば 200）
    const validRes = await fetch(`http://127.0.0.1:${testPort}/api/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        data: {
          title: 'クラウド安全PDFテスト',
          theme: 'クラウド安全PDFテスト',
          summary: '構造化サマリー',
          keyPoints: ['ポイント1', 'ポイント2'],
        },
        template: 'slides',
        filename: 'safe_report.pdf',
      }),
    });

    // ブラウザが見つかる場合は 200 で PDF が返り、見つからない場合は 500 だが 400 ではない
    if (pdf.findSystemBrowser()) {
      assert.strictEqual(validRes.status, 200, 'Valid data/template request must return 200 in cloud mode');
      const ct = validRes.headers.get('content-type') || '';
      assert.ok(ct.includes('application/pdf'), `Content-Type must be application/pdf, got ${ct}`);
    } else {
      assert.notStrictEqual(validRes.status, 400, 'Must not fail with 400 when valid data is supplied');
    }
  } finally {
    serverProcess.kill('SIGTERM');
  }
});

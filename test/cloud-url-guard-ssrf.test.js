'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { assertPublicUrl, isPublicUrl } = require('../server/url-guard');
const search = require('../server/search');
const { safeFetch } = require('../server/security');

test('B-6: assertPublicUrl blocks SSRF target URLs, schemes, credentials, and non-standard ports', async () => {
  // 1. 完了条件指定の禁止URL
  const forbiddenUrls = [
    'http://127.0.0.1:3939/api/info',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'file:///etc/passwd',
    'gopher://127.0.0.1:6379/_flushall',
    'ftp://example.com/file.txt',
    'javascript:alert(1)',
    'http://admin:secret@example.com/',
    'http://example.com:8080/test',
    'http://example.com:3000/api',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://100.64.0.1/',
  ];

  for (const u of forbiddenUrls) {
    await assert.rejects(
      async () => {
        await assertPublicUrl(u);
      },
      /禁止|不許可|無効|アクセスを拒否|制限された/,
      `URL "${u}" must be rejected by assertPublicUrl`
    );
    assert.strictEqual(await isPublicUrl(u), false, `isPublicUrl must return false for "${u}"`);
  }
});

test('B-6: safeFetch / fetchPage blocks open redirect leading to private or metadata address', async () => {
  // リダイレクト攻撃モックサーバー
  // 1ホップ目（許可）から内部IP（169.254.169.254 / 127.0.0.1）へのリダイレクトをテスト
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/redirect-internal') {
      res.writeHead(302, {
        Location: 'http://127.0.0.1:3939/api/info',
      });
      return res.end();
    }
    if (req.url === '/redirect-metadata') {
      res.writeHead(302, {
        Location: 'http://169.254.169.254/latest/meta-data/',
      });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>Safe</title></head><body>OK</body></html>');
  });

  const port = await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port));
  });

  try {
    // 1. 通常呼び出し: 最初が 127.0.0.1 なので第1ホップで即時遮断されること
    await assert.rejects(
      async () => {
        await search.fetchPage(`http://127.0.0.1:${port}/redirect-internal`);
      },
      /禁止|不許可|制限された/
    );

    // 2. テスト環境で第1ホップを通過させた場合でも、リダイレクト先の 127.0.0.1 で確実に遮断されること
    await assert.rejects(
      async () => {
        await search.fetchPage(`http://127.0.0.1:${port}/redirect-internal`, {
          _dangerouslyBypassFirstHopForTest: true,
        });
      },
      /禁止|不許可|制限された/
    );

    // 3. テスト環境で第1ホップを通過させた場合でも、リダイレクト先の 169.254.169.254 で確実に遮断されること
    await assert.rejects(
      async () => {
        await search.fetchPage(`http://127.0.0.1:${port}/redirect-metadata`, {
          _dangerouslyBypassFirstHopForTest: true,
        });
      },
      /禁止|不許可|制限された/
    );
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

test('B-6: safeFetch aborts stream reading when response exceeds 2MB', async () => {
  // 3MB のレスポンスを返すモックサーバー
  let streamClosed = false;
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // 64KB ごとに chunk を送信し合計約 3MB
    const chunk = Buffer.alloc(64 * 1024, 'A');
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= 50) { // 64KB * 50 = 3.2MB
        clearInterval(timer);
        res.end();
        return;
      }
      try {
        const canWrite = res.write(chunk);
        sent++;
        if (!canWrite) {
          // backpressure
        }
      } catch {
        streamClosed = true;
        clearInterval(timer);
      }
    }, 5);

    res.on('close', () => {
      streamClosed = true;
      clearInterval(timer);
    });
  });

  const port = await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port));
  });

  try {
    // 2MB 上限で安全に打ち切られることを検証
    const { text } = await safeFetch(`http://127.0.0.1:${port}/stream`, {
      _dangerouslyBypassFirstHopForTest: true,
      maxBytes: 2_000_000,
    });

    // 読み込まれたテキストのバイト数が 2MB (2,000,000) 以下であること
    const receivedBytes = Buffer.byteLength(text, 'utf-8');
    assert.ok(receivedBytes <= 2_000_000, `Received bytes (${receivedBytes}) must not exceed 2,000,000`);
    assert.ok(receivedBytes >= 1_900_000, `Received bytes (${receivedBytes}) should reach near 2MB cutoff`);
  } finally {
    await new Promise((r) => mockServer.close(r));
  }
});

test('B-6: Reference URLs pointing to internal endpoints are safely rejected and skipped', async () => {
  // 禁止対象URLのリスト
  const maliciousHttpUrls = [
    'http://127.0.0.1:3939/api/info',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
  ];
  const fileUrl = 'file:///etc/passwd';

  // 1. fetchPage 直接呼び出しですべて拒絶されること
  for (const bad of [...maliciousHttpUrls, fileUrl]) {
    await assert.rejects(
      async () => {
        await search.fetchPage(bad);
      },
      /禁止|不許可|制限された/
    );
  }

  // 2. パイプラインでの安全なスキップ（try-catch と警告ログ記録）の検証
  const logs = [];
  const fakeJob = {
    log: (kind, message, detail) => {
      logs.push({ kind, message, detail });
    },
  };

  const candidateUrls = [...maliciousHttpUrls, fileUrl];
  const processedSources = [];

  for (const u of candidateUrls) {
    // パイプラインの正規表現フィルタ (^https?://)
    if (!/^https?:\/\//i.test(u.trim())) {
      fakeJob.log('warn', `URLフォーマットスキップ: ${u}`);
      continue;
    }
    try {
      const page = await search.fetchPage(u);
      processedSources.push({ url: u, text: page.text });
    } catch (e) {
      fakeJob.log('warn', `URL取得スキップ (${u}): ${e.message}`);
    }
  }

  // 不正なURLは1件も取得成功してはならない
  assert.strictEqual(processedSources.length, 0, 'No malicious URLs should be processed');

  // HTTPの禁止URL 4件は「URL取得スキップ」、fileUrl は「URLフォーマットスキップ」として記録されること
  const skipLogs = logs.filter((l) => l.message && l.message.includes('URL取得スキップ'));
  assert.strictEqual(skipLogs.length, 4, 'All 4 malicious HTTP URLs must be skipped with warning log');
  const formatSkipLogs = logs.filter((l) => l.message && l.message.includes('URLフォーマットスキップ'));
  assert.strictEqual(formatSkipLogs.length, 1, 'File URL must be skipped by scheme filter');
});

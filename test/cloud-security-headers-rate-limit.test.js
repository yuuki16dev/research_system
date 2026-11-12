'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const getFreePort = () =>
  new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });

test('B-8: Security headers and Content-Security-Policy are enforced by helmet', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-sec-headers.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b8',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/info`);
    assert.strictEqual(res.status, 200);

    // 1. Content-Security-Policy ヘッダーの存在
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'Response must have Content-Security-Policy header');
    assert.ok(csp.includes("default-src 'self'"), 'CSP must include default-src self');
    assert.ok(csp.includes("script-src 'self'"), 'CSP must include script-src self');
    assert.ok(csp.includes("https://fonts.googleapis.com"), 'CSP must allow Google Fonts in style-src');
    assert.ok(csp.includes("https://fonts.gstatic.com"), 'CSP must allow Google Fonts in font-src');

    // 2. Helmet の標準セキュリティヘッダー
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('x-frame-options') || csp.includes("frame-ancestors 'none'"), 'Frame protection must be active');
  } finally {
    serverProcess.kill('SIGTERM');
  }
});

test('B-8: Rate limiting blocks 11th consecutive login attempt with 429', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-ratelimit.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b8',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    // ログイン試行を 11 回連続で送信
    let lastStatus = 0;
    let rateLimited = false;

    for (let i = 1; i <= 11; i++) {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'wrong@example.com', password: 'wrongpassword' }),
      });

      lastStatus = res.status;
      if (res.status === 429) {
        rateLimited = true;
        const body = await res.json();
        assert.ok(body.error.includes('上限に達しました') || body.code === 'TOO_MANY_REQUESTS');
        break;
      }
    }

    assert.strictEqual(rateLimited, true, '11th consecutive login attempt must be rate-limited with 429');
    assert.strictEqual(lastStatus, 429);
  } finally {
    serverProcess.kill('SIGTERM');
  }
});

test('B-8: JSON body size limit (1MB default vs 10MB for attachment routes)', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-jsonlimit.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b8',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    const authHeader = 'Bearer test-token-user-a';

    // 1. 通常ルート (/api/research/deep-dive) に 1.5MB の巨大ボディを送信 -> 413 Payload Too Large
    const bigString1_5MB = 'A'.repeat(1.5 * 1024 * 1024);
    const res1 = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({ theme: bigString1_5MB, question: 'test' }),
    });

    assert.strictEqual(res1.status, 413, 'Normal API route must reject bodies larger than 1MB with 413');

    // 2. ファイル添付許可ルート (/api/presentation/generate) に 1.5MB のボディを送信 -> 413 にならず受理されること
    const res2 = await fetch(`http://127.0.0.1:${testPort}/api/presentation/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        document: '企画書テキスト',
        audience: '経営陣',
        files: [{ name: 'data.txt', content: 'A'.repeat(1.2 * 1024 * 1024) }],
      }),
    });

    // 413 ではないことを検証（正常処理またはビジネスバリデーション）
    assert.notStrictEqual(res2.status, 413, 'Attachment-capable route must allow bodies up to 10MB');
  } finally {
    serverProcess.kill('SIGTERM');
  }
});

test('B-8: /api/research/deep-dive validates field length and array count limits', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-validation.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b8',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    const authHeader = 'Bearer test-token-user-a';

    // 1. theme > 500文字 -> 400
    const resTheme = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ theme: 'A'.repeat(501), question: 'test' }),
    });
    assert.strictEqual(resTheme.status, 400);
    assert.ok((await resTheme.json()).error.includes('theme'));

    // 2. question > 500文字 -> 400
    const resQuestion = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ theme: 'valid', question: 'A'.repeat(501) }),
    });
    assert.strictEqual(resQuestion.status, 400);
    assert.ok((await resQuestion.json()).error.includes('question'));

    // 3. quote > 1,000文字 -> 400
    const resQuote = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ theme: 'valid', question: 'valid', quote: 'A'.repeat(1001) }),
    });
    assert.strictEqual(resQuote.status, 400);
    assert.ok((await resQuote.json()).error.includes('quote'));

    // 4. reportContext > 8,000文字 -> 400
    const resCtx = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ theme: 'valid', question: 'valid', reportContext: 'A'.repeat(8001) }),
    });
    assert.strictEqual(resCtx.status, 400);
    assert.ok((await resCtx.json()).error.includes('reportContext'));

    // 5. chatHistory > 10件 -> 400
    const resHistCount = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        theme: 'valid',
        question: 'valid',
        chatHistory: new Array(11).fill({ question: 'q', answer: 'a' }),
      }),
    });
    assert.strictEqual(resHistCount.status, 400);
    assert.ok((await resHistCount.json()).error.includes('chatHistory'));

    // 6. chatHistory 項目 > 2,000文字 -> 400
    const resHistItem = await fetch(`http://127.0.0.1:${testPort}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        theme: 'valid',
        question: 'valid',
        chatHistory: [{ question: 'q', answer: 'A'.repeat(2001) }],
      }),
    });
    assert.strictEqual(resHistItem.status, 400);
    assert.ok((await resHistItem.json()).error.includes('chatHistory[0]'));
  } finally {
    serverProcess.kill('SIGTERM');
  }
});

test('B-8: Minimum password length is enforced to 8 characters', async () => {
  const testPort = await getFreePort();
  const serverProcess = fork(path.resolve(__dirname, '../server/index.js'), [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      SUPABASE_URL: 'https://test-password.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake_key_for_b8',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out')), 10000);
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('起動しました') || d.toString().includes(String(testPort))) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  try {
    // 1. 7文字のパスワード -> 400
    const resShort = await fetch(`http://127.0.0.1:${testPort}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newuser@example.com', password: 'short12' }),
    });
    assert.strictEqual(resShort.status, 400);
    const bodyShort = await resShort.json();
    assert.ok(bodyShort.error.includes('8文字以上'));

    // 2. 8文字のパスワード -> 200 または成功
    const resValid = await fetch(`http://127.0.0.1:${testPort}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `validuser-${Date.now()}@test.local`, password: 'valid123' }),
    });
    assert.strictEqual(resValid.status, 200);
  } finally {
    serverProcess.kill('SIGTERM');
  }
});


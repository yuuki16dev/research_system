'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const gemini = require('../server/gemini');
const search = require('../server/search');
const settings = require('../server/settings');
const env = require('../server/env');

test('C-1: Cloud mode uses only the first Gemini API key and disables key rotation', async () => {
  // クラウド環境をシミュレート (SUPABASE_URL 設定)
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  const originalEnvKey = process.env.GEMINI_API_KEY;

  process.env.SUPABASE_URL = 'https://fake-cloud.supabase.co';
  process.env.GEMINI_API_KEY = 'primary-key-123, secondary-key-456';

  const usedKeys = [];

  globalThis.fetch = async (url, opts) => {
    const key = (opts && opts.headers && opts.headers['x-goog-api-key']) || '';
    usedKeys.push(key);

    // 1回目・2回目ともに 429 を返してリトライを誘発
    if (usedKeys.length < 2) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Resource exhausted (quota limit)' } }),
      };
    }

    // 3回目で成功
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ result: 'ok' }) }] } }],
      }),
    };
  };

  try {
    // 1. settings.load() が先頭キーのみをロードすること
    const s = settings.load();
    assert.strictEqual(s.geminiApiKey, 'primary-key-123', 'settings.load() must only keep the first key');
    const parsed = settings.getGeminiApiKeys(s);
    assert.strictEqual(parsed.length, 1, 'Only 1 key should be parsed in cloud mode');
    assert.strictEqual(parsed[0], 'primary-key-123');

    // 2. gemini.generate を複数キー文字列で実行
    const res = await gemini.generate({
      apiKey: 'primary-key-123, secondary-key-456',
      model: 'gemini-3.8-flash',
      prompt: 'Hello',
      json: true,
      maxRetries: 3,
    });

    assert.ok(res);
    assert.ok(usedKeys.length >= 2, 'Should have retried');
    // すべてのリクエストで primary-key-123 だけが使われ、secondary-key-456 は決して使われないこと
    assert.ok(usedKeys.every((k) => k === 'primary-key-123'), `All requests must use primary key only, got: ${JSON.stringify(usedKeys)}`);
    assert.ok(!usedKeys.includes('secondary-key-456'), 'Secondary key must NEVER be used in cloud mode');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    else delete process.env.SUPABASE_URL;
    if (originalEnvKey) process.env.GEMINI_API_KEY = originalEnvKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('C-1: Cloud mode enforces Tavily search and blocks DuckDuckGo fallback on failure', async () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://fake-cloud.supabase.co';

  let tavilyCalled = 0;
  let ddgCalled = 0;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url || '');
    if (urlStr.includes('api.tavily.com')) {
      tavilyCalled++;
      // Tavily が失敗（500エラー）する状況を再現
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Tavily internal server error' }),
      };
    }
    if (urlStr.includes('duckduckgo.com')) {
      ddgCalled++;
      return {
        ok: true,
        status: 200,
        text: async () => '<html>Mock DDG Results</html>',
      };
    }
    return { ok: true, status: 200, text: async () => '' };
  };

  try {
    // 1. search.run で provider に duckduckgo を指定しても、クラウド環境では tavily が強制される
    await assert.rejects(
      async () => {
        await search.run({
          provider: 'duckduckgo',
          apiKey: 'fake-tavily-key',
          query: 'test query',
          maxResults: 3,
        });
      },
      /Tavily/i,
      'Should fail with Tavily error without falling back to DuckDuckGo'
    );

    assert.ok(tavilyCalled > 0, 'Tavily must have been called');
    assert.strictEqual(ddgCalled, 0, 'DuckDuckGo must NEVER be called in cloud mode even if Tavily fails');

    // 2. ddgSearch を直接呼んだ場合もクラウド環境では明示的にエラー遮断される
    await assert.rejects(
      async () => {
        await search.ddgSearch({ query: 'direct ddg query' });
      },
      /DuckDuckGo 検索は許可されていません/i,
      'Direct ddgSearch call must be rejected in cloud mode'
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    else delete process.env.SUPABASE_URL;
  }
});

test('C-1: Server startup crashes if SUPABASE_URL is set but TAVILY_API_KEY is missing', async () => {
  const ROOT = path.join(__dirname, '..');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: '3997',
      SUPABASE_URL: 'https://test-c1.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key-valid',
      TAVILY_API_KEY: '', // Tavily キー未設定
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  assert.strictEqual(exitCode, 1, 'Server should exit with code 1 when TAVILY_API_KEY is missing');
  assert.ok(stderr.includes('TAVILY_API_KEY が必須です'), `stderr should mention missing TAVILY_API_KEY, got: ${stderr}`);
});

test('C-1: Local mode retains multi-key rotation and DuckDuckGo fallback support', async () => {
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalFetch = globalThis.fetch;

  delete process.env.SUPABASE_URL;

  const usedKeys = [];
  globalThis.fetch = async (url, opts) => {
    const key = (opts && opts.headers && opts.headers['x-goog-api-key']) || '';
    usedKeys.push(key);

    if (usedKeys.length === 1) {
      // 1本目のキーは 429 で失敗
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Quota exceeded' } }),
      };
    }
    // 2本目のキーで成功
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ result: 'ok from second key' }) }] } }],
      }),
    };
  };

  try {
    const res = await gemini.generate({
      apiKey: 'key-one, key-two',
      model: 'gemini-3.8-flash',
      prompt: 'Hello',
      json: true,
      maxRetries: 3,
    });

    assert.ok(res);
    assert.strictEqual(usedKeys[0], 'key-one');
    assert.strictEqual(usedKeys[1], 'key-two', 'Local mode must rotate to secondary key on 429');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    else delete process.env.SUPABASE_URL;
  }
});

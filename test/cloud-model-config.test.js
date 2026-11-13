'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modelConfig = require('../server/model-config');
const gemini = require('../server/gemini');
const usageEvents = require('../server/usage-events');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { startDbCheckMockServer } = require('./helpers/mock-supabase-db');

test('C-2: model-config provides models, fallbacks, pricing, and rate', () => {
  assert.equal(modelConfig.DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
  assert.ok(Array.isArray(modelConfig.DEFAULT_FALLBACK_MODELS));
  assert.ok(modelConfig.DEFAULT_FALLBACK_MODELS.length >= 3);
  assert.ok(Array.isArray(modelConfig.OBSOLETE_GEMINI_MODELS));
  assert.ok(modelConfig.OBSOLETE_GEMINI_MODELS.includes('gemini-1.5-flash'));

  // 単価設定と為替レート
  assert.equal(modelConfig.USD_JPY_RATE, 150);
  const pricingFlash = modelConfig.getModelPricing('gemini-3.8-flash');
  assert.equal(typeof pricingFlash.inputPerMillion, 'number');
  assert.equal(typeof pricingFlash.outputPerMillion, 'number');
  assert.ok(pricingFlash.inputPerMillion > 0);
  assert.ok(pricingFlash.outputPerMillion > 0);
});

test('C-2: GEMINI_MODEL env var overrides default model', () => {
  const orig = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_MODEL = 'gemini-custom-model';
    assert.equal(modelConfig.getDefaultModel(), 'gemini-custom-model');
    assert.equal(modelConfig.normalizeModel(''), 'gemini-custom-model');
  } finally {
    if (orig !== undefined) process.env.GEMINI_MODEL = orig;
    else delete process.env.GEMINI_MODEL;
  }
});

test('C-2: GEMINI_FALLBACK_MODELS env var overrides fallback candidates', () => {
  const orig = process.env.GEMINI_FALLBACK_MODELS;
  try {
    process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.7-flash, gemini-3.5-flash';
    const fallbacks = modelConfig.getFallbackModels('gemini-3.7-flash');
    assert.deepEqual(fallbacks, ['gemini-3.5-flash']);
  } finally {
    if (orig !== undefined) process.env.GEMINI_FALLBACK_MODELS = orig;
    else delete process.env.GEMINI_FALLBACK_MODELS;
  }
});

test('C-2: Obsolete Gemini models are sanitized to active default model', () => {
  for (const obsolete of modelConfig.OBSOLETE_GEMINI_MODELS) {
    const sanitized = modelConfig.normalizeModel(obsolete);
    assert.equal(sanitized, modelConfig.getDefaultModel(), `Obsolete model ${obsolete} should normalize to default`);
  }
});

test('C-2: Cloud mode caps max retries at 3 on Gemini API errors', async () => {
  const origCloud = process.env.SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  try {
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    globalThis.fetch = async () => {
      attempts++;
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'Service Unavailable' } }),
      };
    };

    await assert.rejects(
      async () => {
        await gemini.generate({
          apiKey: 'fake-test-key',
          model: 'gemini-3.8-flash',
          prompt: 'test prompt',
          maxRetries: 6, // 6回指定してもクラウドモードでは3回で打ち切り
        });
      },
      /Google Gemini APIが一時的に混雑|Gemini API エラー/
    );

    assert.equal(attempts, 3, 'In cloud mode, maxRetries should be capped at 3');
  } finally {
    if (origCloud !== undefined) process.env.SUPABASE_URL = origCloud;
    else delete process.env.SUPABASE_URL;
    globalThis.fetch = originalFetch;
  }
});

test('R-6: MODEL_PRICING_JSON, TAVILY_USD_PER_CREDIT, and USD_JPY_RATE override est_cost_jpy and invalid values warn + fallback', () => {
  const origPricing = process.env.MODEL_PRICING_JSON;
  const origTavily = process.env.TAVILY_USD_PER_CREDIT;
  const origRate = process.env.USD_JPY_RATE;
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    delete process.env.MODEL_PRICING_JSON;
    delete process.env.TAVILY_USD_PER_CREDIT;
    delete process.env.USD_JPY_RATE;
    modelConfig._clearWarningsForTest();

    assert.equal(modelConfig.getTavilyUsdPerCredit(), 0.008);
    assert.equal(modelConfig.getUsdJpyRate(), 150);
    assert.equal(modelConfig.isUsingDefaultModelPricing(), true);

    const baseCost = usageEvents.calculateEstimatedCostJpy({
      model: 'gemini-3.8-flash',
      promptTokens: 1_000_000,
      outputTokens: 1_000_000,
      tavilyCredits: 10,
    });
    // (0.075 + 0.30 + 10 * 0.008) * 150 = 0.455 * 150 = 68.25
    assert.equal(baseCost, 68.25);

    // MODEL_PRICING_JSON / TAVILY_USD_PER_CREDIT / USD_JPY_RATE で上書き
    process.env.MODEL_PRICING_JSON = JSON.stringify({
      'gemini-3.8-flash': { inputPerMillion: 0.75, outputPerMillion: 3.0 },
    });
    process.env.TAVILY_USD_PER_CREDIT = '0.01';
    process.env.USD_JPY_RATE = '160';
    assert.equal(modelConfig.isUsingDefaultModelPricing(), false);

    const overriddenCost = usageEvents.calculateEstimatedCostJpy({
      model: 'gemini-3.8-flash',
      promptTokens: 1_000_000,
      outputTokens: 1_000_000,
      tavilyCredits: 10,
    });
    // (0.75 + 3.0 + 10 * 0.01) * 160 = 3.85 * 160 = 616
    assert.equal(overriddenCost, 616);

    // 不正値時は警告を出しつつ既定値へフォールバック
    modelConfig._clearWarningsForTest();
    process.env.MODEL_PRICING_JSON = '{invalid-json';
    process.env.TAVILY_USD_PER_CREDIT = '-5';
    process.env.USD_JPY_RATE = 'not-a-number';

    assert.equal(modelConfig.isUsingDefaultModelPricing(), true);
    const fallbackCost = usageEvents.calculateEstimatedCostJpy({
      model: 'gemini-3.8-flash',
      promptTokens: 1_000_000,
      outputTokens: 1_000_000,
      tavilyCredits: 10,
    });
    assert.equal(fallbackCost, 68.25);
    assert.ok(warnings.some((w) => w.includes('MODEL_PRICING_JSON')));
    assert.ok(warnings.some((w) => w.includes('TAVILY_USD_PER_CREDIT')));
    assert.ok(warnings.some((w) => w.includes('USD_JPY_RATE')));
  } finally {
    console.warn = origWarn;
    if (origPricing !== undefined) process.env.MODEL_PRICING_JSON = origPricing;
    else delete process.env.MODEL_PRICING_JSON;
    if (origTavily !== undefined) process.env.TAVILY_USD_PER_CREDIT = origTavily;
    else delete process.env.TAVILY_USD_PER_CREDIT;
    if (origRate !== undefined) process.env.USD_JPY_RATE = origRate;
    else delete process.env.USD_JPY_RATE;
    modelConfig._clearWarningsForTest();
  }
});

test('R-6: Cloud mode disables model fallback by default when GEMINI_FALLBACK_MODELS is unset', async () => {
  const origCloud = process.env.SUPABASE_URL;
  const origFallback = process.env.GEMINI_FALLBACK_MODELS;
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];

  try {
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    delete process.env.GEMINI_FALLBACK_MODELS;

    assert.deepEqual(modelConfig.getFallbackModels('gemini-3.8-flash'), []);

    globalThis.fetch = async (url) => {
      requestedUrls.push(String(url));
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: { message: 'Service Unavailable' } }),
      };
    };

    await assert.rejects(
      () =>
        gemini.generate({
          apiKey: 'fake-test-key',
          model: 'gemini-3.8-flash',
          prompt: 'test prompt',
          maxRetries: 2,
        }),
      /Google Gemini APIが一時的に混雑|Gemini API エラー/
    );

    assert.equal(requestedUrls.length, 2);
    assert.ok(
      requestedUrls.every((u) => u.includes('/models/gemini-3.8-flash:generateContent')),
      `Cloud mode must not switch models when GEMINI_FALLBACK_MODELS is unset: ${JSON.stringify(requestedUrls)}`
    );

    // GEMINI_FALLBACK_MODELS を設定したときのみ切り替え候補が返る
    process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.7-flash, gemini-3.5-flash';
    assert.deepEqual(modelConfig.getFallbackModels('gemini-3.8-flash'), ['gemini-3.7-flash', 'gemini-3.5-flash']);
  } finally {
    if (origCloud !== undefined) process.env.SUPABASE_URL = origCloud;
    else delete process.env.SUPABASE_URL;
    if (origFallback !== undefined) process.env.GEMINI_FALLBACK_MODELS = origFallback;
    else delete process.env.GEMINI_FALLBACK_MODELS;
    globalThis.fetch = originalFetch;
  }
});

test('R-6 E2E: Cloud startup logs warning when MODEL_PRICING_JSON is unset and omits it when configured', async () => {
  async function bootAndReadLogs(extraEnv) {
    const mockDb = await startDbCheckMockServer();
    const port = await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
      s.on('error', reject);
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-r6-boot-'));
    const env = { ...process.env };
    delete env.MODEL_PRICING_JSON;
    Object.assign(env, {
      PORT: String(port),
      NODE_ENV: 'production',
      SUPABASE_URL: mockDb.url,
      SUPABASE_ANON_KEY: 'dummy-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy-service',
      TAVILY_API_KEY: 'dummy-tavily',
      RESEARCH_DATA_DIR: tmpDir,
      ...extraEnv,
    });

    let logs = '';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (c) => { logs += c.toString(); });
    child.stderr.on('data', (c) => { logs += c.toString(); });

    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          if (res.ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 150));
      return logs;
    } finally {
      try { child.kill('SIGTERM'); } catch {}
      await mockDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const defaultLogs = await bootAndReadLogs({});
  assert.ok(
    defaultLogs.includes('警告: モデル単価が仮の値です。AI Studio の請求画面で確認して設定してください'),
    `Expected pricing warning in startup logs, got:\n${defaultLogs}`
  );

  const customLogs = await bootAndReadLogs({
    MODEL_PRICING_JSON: JSON.stringify({ 'gemini-3.8-flash': { inputPerMillion: 0.5, outputPerMillion: 2.0 } }),
  });
  assert.ok(
    !customLogs.includes('警告: モデル単価が仮の値です。AI Studio の請求画面で確認して設定してください'),
    'Must not log provisional pricing warning when MODEL_PRICING_JSON is validly set'
  );
});


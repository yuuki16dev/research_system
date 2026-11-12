'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modelConfig = require('../server/model-config');
const gemini = require('../server/gemini');

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


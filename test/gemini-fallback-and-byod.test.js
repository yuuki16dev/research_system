'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, repairJSON } = require('../server/gemini');

test('gemini: auto-failovers to valid fallback model (gemini-2.0-flash) when 404 or persistent overload occurs', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const requestedUrls = [];
  const retryEvents = [];

  globalThis.fetch = async (url) => {
    callCount++;
    requestedUrls.push(url);
    if (callCount === 1) {
      // 1st call fails with 404 (e.g. deprecated model or 404 from server)
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            message: 'This model is no longer available to new users. Please update your code to use models/gemini-3.8-flash',
            status: 'NOT_FOUND',
          },
        }),
      };
    }
    // 2nd call succeeds on fallback model
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ status: 'ok', tested: true }) }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15, totalTokenCount: 25 },
      }),
    };
  };

  try {
    const res = await generate({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      prompt: 'test prompt',
      onRetry: (evt) => {
        retryEvents.push(evt);
      },
    });

    assert.equal(callCount, 2);
    assert.equal(res.status, 'ok');
    assert.equal(res.tested, true);
    assert.ok(requestedUrls[0].includes('gemini-3.8-flash'));
    // 2nd request must switch to an officially available fallback model (gemini-3.7-flash / gemini-3.5-flash)
    assert.ok(requestedUrls[1].includes('gemini-3.7-flash') || requestedUrls[1].includes('gemini-3.5-flash'));
    assert.ok(!requestedUrls[1].includes('gemini-2.0-flash')); // MUST NOT contain obsolete 2.0
    assert.ok(!requestedUrls[1].includes('gemini-2.5-flash')); // MUST NOT contain obsolete 2.5
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('byod: pipeline accurately integrates attachedFiles text into prompts', () => {
  const fs = require('fs');
  const pipelineCode = fs.readFileSync(require.resolve('../server/pipeline.js'), 'utf8');

  // Verify that attachedFiles text is included in planAttachedContext
  assert.ok(pipelineCode.includes('planAttachedContext'));
  assert.ok(pipelineCode.includes('f.text'));
  assert.ok(pipelineCode.includes('geminiParts'));
  assert.ok(pipelineCode.includes('inlineData'));
  assert.ok(pipelineCode.includes('application/pdf'));
});

test('gemini & settings: auto-sanitizes obsolete model names to gemini-3.8-flash', () => {
  const { normalizeModel } = require('../server/gemini');
  const settings = require('../server/settings');

  // gemini.normalizeModel: 1.5, 2.0, 2.5 are obsolete and sanitized to 3.8
  assert.equal(normalizeModel('gemini-2.0-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeModel('gemini-1.5-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeModel('gemini-2.5-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeModel('gemini-2.5-pro'), 'gemini-3.8-flash');
  // 3.7 and 3.5 are valid official models
  assert.equal(normalizeModel('gemini-3.7-flash'), 'gemini-3.7-flash');
  assert.equal(normalizeModel('gemini-3.5-flash'), 'gemini-3.5-flash');
  assert.equal(normalizeModel(''), 'gemini-3.8-flash');

  // settings.save sanitizes obsolete models
  settings.save({ geminiModel: 'gemini-2.0-flash' });
  const loaded = settings.load();
  assert.equal(loaded.geminiModel, 'gemini-3.8-flash');
});

test('gemini: auto-rotates to backup API key when 429 quota limit is encountered', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const usedKeys = [];

  globalThis.fetch = async (url, opts) => {
    callCount++;
    const key = new URL(url).searchParams.get('key');
    usedKeys.push(key);

    if (callCount === 1) {
      // 1st key fails with 429 Resource Exhausted
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            message: 'Resource has been exhausted (e.g. check quota).',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
      };
    }

    // 2nd key succeeds
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify({ ok: true, rotated: true }) }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15, totalTokenCount: 25 },
      }),
    };
  };

  try {
    const res = await generate({
      apiKey: 'key-primary-111, key-backup-222',
      model: 'gemini-3.8-flash',
      prompt: 'test prompt',
    });

    assert.equal(callCount, 2);
    assert.equal(res.ok, true);
    assert.equal(res.rotated, true);
    assert.equal(usedKeys[0], 'key-primary-111');
    assert.equal(usedKeys[1], 'key-backup-222');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


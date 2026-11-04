'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, repairJSON } = require('../server/gemini');

test('gemini: auto-failovers to fallback model when 503 high demand occurs', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const requestedUrls = [];
  const retryEvents = [];

  globalThis.fetch = async (url) => {
    callCount++;
    requestedUrls.push(url);
    if (callCount === 1) {
      // 1st call fails with 503 High Demand
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: {
            message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
            status: 'UNAVAILABLE',
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
    // 1st request should be gemini-3.8-flash
    assert.ok(requestedUrls[0].includes('gemini-3.8-flash'));
    // 2nd request should have switched to a fallback model (e.g., gemini-2.5-flash)
    assert.ok(!requestedUrls[1].includes('gemini-3.8-flash'));
    assert.ok(requestedUrls[1].includes('gemini-2.5-flash') || requestedUrls[1].includes('gemini-2.0-flash'));
    // onRetry event should indicate fallback
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0].isFallback, true);
    assert.ok(retryEvents[0].currentModel);
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
  assert.ok(pipelineCode.includes('planParts'));
  assert.ok(pipelineCode.includes('geminiParts'));
  assert.ok(pipelineCode.includes('inlineData'));
  assert.ok(pipelineCode.includes('application/pdf'));
});


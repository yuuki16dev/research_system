'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const presentation = require('../server/presentation');
const gemini = require('../server/gemini');
const settings = require('../server/settings');

test('A-7 (M1): presentation.generateSlides loads settings correctly and produces slides', async () => {
  const originalFetch = globalThis.fetch;

  const mockSlideResult = {
    title: 'テストプレゼンテーション',
    theme: 'AI企画書',
    periodLabel: '2026年',
    summary: 'サマリーテスト',
    confidenceScore: 90,
    insights: [],
    table: { columns: ['A'], rows: [['1']] },
    sections: [],
    roadmap: [],
    risks: [],
    sources: [],
  };

  let requestedUrl = '';
  let requestedHeaders = {};

  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedHeaders = options && options.headers ? options.headers : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockSlideResult) }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      }),
    };
  };

  try {
    // settings.load() で geminiApiKey が存在しない場合でも apiKey パラメータで呼び出し可能
    const res = await presentation.generateSlides({
      document: '新規事業の提案書',
      audience: 'executive',
      goal: '予算承認',
      apiKey: 'test-gemini-key',
    });

    assert.ok(res, 'generateSlides must return a valid slide object');
    assert.equal(res.title, 'テストプレゼンテーション');
    assert.equal(res.theme, 'AI企画書');

    // M2: URL に key= が含まれず、ヘッダーに x-goog-api-key が含まれること
    assert.ok(!requestedUrl.includes('key='), `Gemini URL must not contain key=, got: ${requestedUrl}`);
    assert.equal(requestedHeaders['x-goog-api-key'], 'test-gemini-key', 'Header x-goog-api-key must match apiKey');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('A-7 (M2): gemini.generate does not include key= in request URL and sends x-goog-api-key header', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedHeaders = {};

  globalThis.fetch = async (url, options) => {
    interceptedUrl = String(url);
    interceptedHeaders = options && options.headers ? options.headers : {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello from mock Gemini' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 },
      }),
    };
  };

  try {
    const text = await gemini.generate({
      apiKey: 'secret-gemini-token-12345',
      prompt: 'Hello world',
      json: false,
    });

    assert.equal(text, 'Hello from mock Gemini');
    assert.ok(!interceptedUrl.includes('key='), `URL must not contain key=, was: ${interceptedUrl}`);
    assert.ok(!interceptedUrl.includes('secret-gemini-token'), 'URL must not contain API key plain text');
    assert.equal(interceptedHeaders['x-goog-api-key'], 'secret-gemini-token-12345', 'Must send key in x-goog-api-key header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../server/settings');

test('settings.publicView masks sensitive API keys without leaking plain text', () => {
  const dummyG = 'test_sample_gemini_key_1234567890';
  const dummyT = 'test_sample_tavily_key_1234567890';

  const dummySettings = {
    geminiApiKey: dummyG,
    tavilyApiKey: dummyT,
    geminiModel: 'gemini-3.8-flash',
    searchProvider: 'auto',
    mode: 'auto',
    publisher: 'Test Publisher',
  };

  const view = settings.publicView(dummySettings);

  assert.equal(view.geminiApiKey.set, true);
  assert.equal(view.tavilyApiKey.set, true);
  // Plain text key must NOT be leaked
  assert.equal(view.geminiApiKey.masked.includes(dummyG), false);
  assert.equal(view.tavilyApiKey.masked.includes(dummyT), false);
  assert.ok(view.geminiApiKey.masked.includes('••••••'));
  assert.equal(view.publisher, 'Test Publisher');
});

test('settings.effectiveMode falls back to mock if Gemini key is empty', () => {
  assert.equal(settings.effectiveMode({ geminiApiKey: '', mode: 'auto' }), 'mock');
  assert.equal(settings.effectiveMode({ geminiApiKey: 'valid-test-key', mode: 'auto' }), 'live');
  assert.equal(settings.effectiveMode({ geminiApiKey: 'valid-test-key', mode: 'mock' }), 'mock');
});

test('settings.effectiveSearch falls back to duckduckgo when tavily key is absent', () => {
  assert.equal(settings.effectiveSearch({ searchProvider: 'auto', tavilyApiKey: '' }), 'duckduckgo');
  assert.equal(settings.effectiveSearch({ searchProvider: 'auto', tavilyApiKey: 'sample-t-key' }), 'tavily');
  assert.equal(settings.effectiveSearch({ searchProvider: 'duckduckgo', tavilyApiKey: 'sample-t-key' }), 'duckduckgo');
});

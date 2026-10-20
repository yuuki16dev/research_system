'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../server/settings');

test('settings.publicView masks sensitive API keys', () => {
  const dummySettings = {
    geminiApiKey: 'AIzaSyA1234567890abcdefghijk',
    tavilyApiKey: 'tvly-abcdef1234567890',
    geminiModel: 'gemini-3.8-flash',
    searchProvider: 'auto',
    mode: 'auto',
    publisher: 'Test Publisher',
  };

  const view = settings.publicView(dummySettings);

  assert.equal(view.geminiApiKey.set, true);
  assert.equal(view.tavilyApiKey.set, true);
  // Plain text key must NOT be leaked
  assert.equal(view.geminiApiKey.masked.includes('AIzaSyA1234567890abcdefghijk'), false);
  assert.match(view.geminiApiKey.masked, /^AIza••••••hijk$/);
  assert.equal(view.publisher, 'Test Publisher');
});

test('settings.effectiveMode falls back to mock if Gemini key is empty', () => {
  assert.equal(settings.effectiveMode({ geminiApiKey: '', mode: 'auto' }), 'mock');
  assert.equal(settings.effectiveMode({ geminiApiKey: 'valid-key', mode: 'auto' }), 'live');
  assert.equal(settings.effectiveMode({ geminiApiKey: 'valid-key', mode: 'mock' }), 'mock');
});

test('settings.effectiveSearch falls back to duckduckgo when tavily key is absent', () => {
  assert.equal(settings.effectiveSearch({ searchProvider: 'auto', tavilyApiKey: '' }), 'duckduckgo');
  assert.equal(settings.effectiveSearch({ searchProvider: 'auto', tavilyApiKey: 'tvly-key' }), 'tavily');
  assert.equal(settings.effectiveSearch({ searchProvider: 'duckduckgo', tavilyApiKey: 'tvly-key' }), 'duckduckgo');
});

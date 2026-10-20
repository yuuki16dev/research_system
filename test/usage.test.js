'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getFullUsageSummary, getNextQuotaReset } = require('../server/usage');

test('usage.getNextQuotaReset returns valid target time and countdown', () => {
  const resetInfo = getNextQuotaReset();
  assert.ok(resetInfo.targetISO);
  assert.ok(typeof resetInfo.hoursLeft === 'number');
  assert.ok(typeof resetInfo.minutesLeft === 'number');
  assert.ok(resetInfo.hoursLeft >= 0 && resetInfo.hoursLeft <= 24);
  assert.ok(resetInfo.remainingText.includes('あと約'));
});

test('usage.getFullUsageSummary handles missing or partial API keys without throwing', async () => {
  // Test case 1: Completely empty keys
  const emptySettings = { geminiApiKey: '', tavilyApiKey: '' };
  const resEmpty = await getFullUsageSummary(emptySettings);

  assert.equal(resEmpty.gemini.configured, false);
  assert.equal(resEmpty.tavily.configured, false);
  assert.ok(resEmpty.gemini.quotas);
  assert.ok(typeof resEmpty.duckduckgo.totalSearches === 'number');

  // Test case 2: Only Gemini key present
  const geminiOnly = { geminiApiKey: 'AIzaFakeKey', tavilyApiKey: '' };
  const resGemini = await getFullUsageSummary(geminiOnly);

  assert.equal(resGemini.gemini.configured, true);
  assert.equal(resGemini.tavily.configured, false);

  // Test case 3: Searches counts exist
  assert.ok(typeof resGemini.duckduckgo.totalSearches === 'number');
  assert.ok(typeof resGemini.tavily.localTotalSearches === 'number');
});

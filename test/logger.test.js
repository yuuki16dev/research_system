'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maskSecrets } = require('../server/logger');

test('logger.maskSecrets masks Gemini and Tavily API keys properly', () => {
  const plainGemini = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
  const plainTavily = 'tvly-abcdef1234567890abcdef';
  const rawLog = `Connecting with gemini: ${plainGemini} and tavily: ${plainTavily}`;

  const masked = maskSecrets(rawLog);

  assert.equal(masked.includes(plainGemini), false);
  assert.equal(masked.includes(plainTavily), false);
  assert.match(masked, /AIza••••••••••••/);
  assert.match(masked, /tvly-••••••••••••/);
});

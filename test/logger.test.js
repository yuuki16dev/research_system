'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maskSecrets } = require('../server/logger');

test('logger.maskSecrets masks sensitive keys dynamically without static keys in code', () => {
  // コード内に実際のキーや静的APIキー文字列を残さず、動的合成文字列でフィルタ動作を検証
  const dummyG = ['A', 'I', 'z', 'a'].join('') + '0123456789'.repeat(3) + 'abcde';
  const dummyT = ['t', 'v', 'l', 'y', '-'].join('') + 'sampledummytokenforsecuritytest12345';

  const rawLog = `Connecting to service with g-key: ${dummyG} and t-key: ${dummyT}`;
  const masked = maskSecrets(rawLog);

  assert.equal(masked.includes(dummyG), false, 'Original Gemini key must not remain');
  assert.equal(masked.includes(dummyT), false, 'Original Tavily key must not remain');
  assert.ok(masked.includes('••••••••••••'), 'Mask placeholder must be inserted');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const logger = require('../server/logger');
const { maskSecrets } = logger;
const settings = require('../server/settings');

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

test('D-6: logger.maskSecrets masks Groq, Supabase sb_*/JWT, and Bearer tokens dynamically', () => {
  const groqKey = ['g', 's', 'k', '_'].join('') + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
  const sbSecret = ['s', 'b', '_', 's', 'e', 'c', 'r', 'e', 't', '_'].join('') + 'mockOpaqueKeyValue123456';
  const sbPub = ['s', 'b', '_', 'p', 'u', 'b', 'l', 'i', 's', 'h', 'a', 'b', 'l', 'e', '_'].join('') + 'mockPublicKey7890';
  const jwt = [
    ['e', 'y', 'J'].join('') + 'hbGciOiJIUzI1NiJ9',
    'eyJyb2xlIjoic2VydmljZV9yb2xlIn0',
    'signaturePartAbcdef12345',
  ].join('.');
  const opaqueBearer = 'tok_' + 'OpaqueSessionToken987654321';

  const rawLog = [
    `groq=${groqKey}`,
    `secret=${sbSecret}`,
    `pub=${sbPub}`,
    `jwt=${jwt}`,
    `Authorization: Bearer ${jwt}`,
    `Authorization: Bearer ${opaqueBearer}`,
  ].join(' | ');

  const masked = maskSecrets(rawLog);

  assert.equal(masked.includes(groqKey), false, 'Groq key must be masked');
  assert.equal(masked.includes(sbSecret), false, 'Supabase sb_secret_ key must be masked');
  assert.equal(masked.includes(sbPub), false, 'Supabase sb_publishable_ key must be masked');
  assert.equal(masked.includes(jwt), false, 'JWT token must be masked');
  assert.equal(masked.includes(opaqueBearer), false, 'Bearer token must be masked');
  assert.ok(masked.includes('Bearer ••••••••••••'), 'Bearer prefix should remain with masked body');
});

test('D-6: logger.LOGS_DIR and ERROR_LOG align with settings.DATA_DIR', () => {
  assert.equal(logger.LOGS_DIR, path.join(settings.DATA_DIR, 'logs'));
  assert.equal(logger.ERROR_LOG, path.join(settings.DATA_DIR, 'logs', 'error.log'));
});

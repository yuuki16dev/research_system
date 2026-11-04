'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const settings = require('../server/settings');

test('plan C: settings supports geminiAccountTier (auto, free, tier1)', () => {
  const defaults = settings.load();
  assert.ok('geminiAccountTier' in defaults, 'settings must have geminiAccountTier property');
  assert.equal(defaults.geminiAccountTier, 'auto', 'default geminiAccountTier must be auto');
});

test('plan C: public/index.html includes gemini-tier selector and free-tier guidance', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="gemini-tier"'), 'index.html must have #gemini-tier select');
  assert.ok(html.includes('value="free"'), 'index.html must have free tier option');
  assert.ok(html.includes('value="tier1"'), 'index.html must have tier1 option');
  assert.ok(html.includes('完全無料枠'), 'index.html must display free tier label');
});

test('plan C: pipeline.js contains buildLocalSearchPlan and buildLiveFallbackReport', () => {
  const pipelineJs = fs.readFileSync(path.join(ROOT, 'server', 'pipeline.js'), 'utf8');
  assert.ok(pipelineJs.includes('function buildLocalSearchPlan('), 'pipeline.js must export/define buildLocalSearchPlan');
  assert.ok(pipelineJs.includes('function buildLiveFallbackReport('), 'pipeline.js must export/define buildLiveFallbackReport');
  assert.ok(pipelineJs.includes('isFreeTier'), 'pipeline.js must recognize isFreeTier flag');
});

test('plan C: gemini.js includes free-tier jitter and exponential backoff', () => {
  const geminiJs = fs.readFileSync(path.join(ROOT, 'server', 'gemini.js'), 'utf8');
  assert.ok(geminiJs.includes('isFreeTier'), 'gemini.js must accept isFreeTier parameter');
  assert.ok(geminiJs.includes('Math.random()'), 'gemini.js must apply jitter for backoff');
});


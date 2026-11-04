'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const settings = require('../server/settings');
const { GROQ_DEFAULT_MODEL, GROQ_MODELS } = require('../server/groq');

test('groq fallback: groq.js exports valid default model and supported models', () => {
  assert.equal(GROQ_DEFAULT_MODEL, 'llama-3.3-70b-versatile');
  assert.ok(Array.isArray(GROQ_MODELS));
  assert.ok(GROQ_MODELS.includes('llama-3.3-70b-versatile'));
  assert.ok(GROQ_MODELS.includes('llama-3.1-8b-instant'));
});

test('groq fallback: settings supports groqApiKey and groqModel', () => {
  const s = settings.load();
  assert.ok('groqApiKey' in s, 'settings must have groqApiKey property');
  assert.ok('groqModel' in s, 'settings must have groqModel property');
  assert.equal(s.groqModel, 'llama-3.3-70b-versatile');

  const pv = settings.publicView(s);
  assert.ok('groqApiKey' in pv, 'publicView must include groqApiKey');
  assert.equal(typeof pv.groqApiKey.set, 'boolean');
});

test('groq fallback: public/index.html includes Groq UI inputs and guide step', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="groq-key"'), 'index.html must include #groq-key input');
  assert.ok(html.includes('id="groq-model"'), 'index.html must include #groq-model select');
  assert.ok(html.includes('id="groq-status"'), 'index.html must include #groq-status chip');
  assert.ok(html.includes('llama-3.3-70b-versatile'), 'index.html must have llama-3.3-70b-versatile option');
  assert.ok(html.includes('console.groq.com'), 'index.html must link to console.groq.com');
});

test('groq fallback: readme includes Groq setup guidance', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'はじめにお読みください.txt'), 'utf8');
  assert.ok(readme.includes('Groq API'), 'readme must contain Groq API section');
  assert.ok(readme.includes('console.groq.com/keys'), 'readme must include Groq keys URL');
  assert.ok(readme.includes('Llama 3.3 70B'), 'readme must describe Llama 3.3 70B fallback');
});

test('groq fallback: pipeline.js imports generateGroq and integrates backup relay', () => {
  const pipelineJs = fs.readFileSync(path.join(ROOT, 'server', 'pipeline.js'), 'utf8');
  assert.ok(pipelineJs.includes('generateGroq'), 'pipeline.js must import generateGroq');
  assert.ok(pipelineJs.includes('s.groqApiKey'), 'pipeline.js must check s.groqApiKey for fallback');
});


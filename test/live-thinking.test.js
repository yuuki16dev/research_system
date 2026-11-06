'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

test('live thinking: DOM elements exist in public/index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="live-thinking-card"'), 'live-thinking-card must exist');
  assert.ok(html.includes('id="lt-phase-label"'), 'lt-phase-label must exist');
  assert.ok(html.includes('id="lt-current-thought"'), 'lt-current-thought must exist');
  assert.ok(html.includes('id="lt-thought-detail"'), 'lt-thought-detail must exist');
  assert.ok(html.includes('class="lt-pulse-dot"'), 'lt-pulse-dot must exist');
});

test('live thinking: CSS styles exist in public/css/styles.css', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');
  assert.ok(css.includes('.live-thinking-card'), '.live-thinking-card must exist in styles.css');
  assert.ok(css.includes('.lt-pulse-dot'), '.lt-pulse-dot must exist in styles.css');
  assert.ok(css.includes('.k-thinking'), '.k-thinking log style must exist in styles.css');
  assert.ok(css.includes('@keyframes ltPulse'), '@keyframes ltPulse must exist');
});

test('live thinking: research.js handles thinking log events', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'research.js'), 'utf8');
  assert.ok(js.includes("evt.kind === 'thinking'"), 'research.js must handle thinking kind');
  assert.ok(js.includes('lt-current-thought'), 'research.js must update lt-current-thought');
  assert.ok(js.includes('lt-thought-detail'), 'research.js must update lt-thought-detail');
});

test('live thinking: pipeline.js emits thinking logs during research', () => {
  const pipeline = fs.readFileSync(path.join(ROOT, 'server', 'pipeline.js'), 'utf8');
  assert.ok(pipeline.includes("'thinking'"), "pipeline.js must emit logs with 'thinking' kind");
});


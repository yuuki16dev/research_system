'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const cssPath = path.join(ROOT, 'public', 'css', 'styles.css');
const jsPath = path.join(ROOT, 'public', 'js', 'modules', 'evidence-inspector.js');
const renderPath = path.join(ROOT, 'public', 'js', 'render.js');

test('evidence inspector: DOM elements exist in public/index.html', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('id="drawer-evidence"'), 'Must include #drawer-evidence drawer');
  assert.ok(html.includes('id="evi-badge-id"'), 'Must include #evi-badge-id');
  assert.ok(html.includes('id="evi-score-val"'), 'Must include #evi-score-val');
  assert.ok(html.includes('id="evi-source-title"'), 'Must include #evi-source-title');
  assert.ok(html.includes('id="evi-snippet-text"'), 'Must include #evi-snippet-text for fact checking');
  assert.ok(html.includes('id="evi-open-url"'), 'Must include #evi-open-url external link button');
});

test('evidence inspector: CSS styles exist in public/css/styles.css', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.ok(css.includes('.drawer-evidence-panel'), 'Must define .drawer-evidence-panel');
  assert.ok(css.includes('.evi-score-card'), 'Must define .evi-score-card');
  assert.ok(css.includes('.evi-snippet'), 'Must define .evi-snippet blockquote');
  assert.ok(css.includes('.cite'), 'Must define .cite interactive citation link');
});

test('evidence inspector: module exports all required API functions', () => {
  const js = fs.readFileSync(jsPath, 'utf8');

  assert.ok(js.includes('export function setEvidenceSources'), 'Must export setEvidenceSources');
  assert.ok(js.includes('export function openEvidenceInspector'), 'Must export openEvidenceInspector');
  assert.ok(js.includes('export function closeEvidenceInspector'), 'Must export closeEvidenceInspector');
  assert.ok(js.includes('export function initEvidenceInspector'), 'Must export initEvidenceInspector');
});

test('evidence inspector: render.js linkifyCitations converts [1] and [S1] into smart citation anchors', () => {
  const render = fs.readFileSync(renderPath, 'utf8');

  assert.ok(render.includes('setEvidenceSources'), 'render.js must import and call setEvidenceSources');
  assert.ok(render.includes('data-cite='), 'linkifyCitations must embed data-cite attribute for click delegation');
});


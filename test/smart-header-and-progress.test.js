const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('v1.19.2: smart-header.js exists and exports initSmartHeader', () => {
  const filePath = path.join(__dirname, '../public/js/modules/smart-header.js');
  assert.ok(fs.existsSync(filePath), 'smart-header.js must exist');
  const code = fs.readFileSync(filePath, 'utf-8');
  assert.ok(code.includes('export function initSmartHeader'), 'Must export initSmartHeader');
  assert.ok(code.includes('is-sticky-slim'), 'Must handle is-sticky-slim class');
  assert.ok(code.includes('is-scrolled-hidden'), 'Must handle is-scrolled-hidden class');
});

test('v1.19.2: app.js imports and calls initSmartHeader', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf-8');
  assert.ok(code.includes("import { initSmartHeader } from './modules/smart-header.js'"), 'Must import initSmartHeader');
  assert.ok(code.includes('initSmartHeader()'), 'Must call initSmartHeader');
});

test('v1.19.2: styles.css contains smart header & slim bar rules', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf-8');
  assert.ok(css.includes('.topbar.is-scrolled-hidden'), 'Must contain .topbar.is-scrolled-hidden');
  assert.ok(css.includes('.export-bar.is-sticky-slim'), 'Must contain .export-bar.is-sticky-slim');
  assert.ok(css.includes('body.topbar-hidden .export-bar'), 'Must adjust export-bar when topbar hidden');
});

test('v1.19.2: index.html contains collapse header toggle button', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
  assert.ok(html.includes('id="btn-toggle-bar-compact"'), 'Must contain btn-toggle-bar-compact');
});

test('v1.19.2: research.js properly handles progress completion & hides cancel button', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/modules/research.js'), 'utf-8');
  assert.ok(code.includes("btnCancel.style.display = 'none'"), 'Must hide cancel button in finishSuccess');
  assert.ok(code.includes("progressTitle.textContent = 'リサーチ完了！'"), 'Must update progressTitle to done in finishSuccess');
  assert.ok(code.includes("progressFill.style.width = '100%'"), 'Must set progressFill to 100% in finishSuccess');
});


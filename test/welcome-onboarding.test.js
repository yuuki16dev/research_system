'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const welcomeModule = require('../public/js/modules/welcome.js');

test('welcome: DOM and UI consistency in index.html', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  // トップバーのツアーボタン
  assert.ok(indexHtml.includes('id="btn-tour"'), 'index.html must contain #btn-tour');

  // ウェルカムモーダル
  assert.ok(indexHtml.includes('id="modal-welcome"'), 'index.html must contain #modal-welcome');
  assert.ok(indexHtml.includes('id="welcome-modal-title"'), 'index.html must contain #welcome-modal-title');
  assert.ok(indexHtml.includes('class="welcome-steps-grid"'), 'index.html must contain .welcome-steps-grid');
  assert.ok(indexHtml.includes('btn-welcome-sample'), 'index.html must contain btn-welcome-sample');
  assert.ok(indexHtml.includes('id="chk-welcome-dont-show"'), 'index.html must contain #chk-welcome-dont-show');
  assert.ok(indexHtml.includes('id="btn-welcome-start"'), 'index.html must contain #btn-welcome-start');
});

test('welcome: module syntax integrity and exports', () => {
  const welcomeJsPath = path.join(ROOT, 'public', 'js', 'modules', 'welcome.js');
  assert.ok(fs.existsSync(welcomeJsPath), 'welcome.js must exist');

  // node --check で構文チェック
  assert.doesNotThrow(() => {
    execSync(`node --check "${welcomeJsPath}"`, { stdio: 'pipe' });
  }, 'welcome.js must pass node --check without syntax error');
});

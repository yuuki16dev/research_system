'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('deep-dive drawer close buttons integrity in public/index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  // ヘッダーの閉じるボタン
  assert.ok(html.includes('id="btn-close-deepdive"'), 'Header close button #btn-close-deepdive must exist');
  assert.ok(html.includes('btn-dd-close'), 'Header close button class btn-dd-close must exist');

  // フッターの閉じるボタン
  assert.ok(html.includes('id="btn-close-deepdive-bottom"'), 'Footer close button #btn-close-deepdive-bottom must exist');
  assert.ok(html.includes('btn-dd-close-foot'), 'Footer close button class btn-dd-close-foot must exist');
  assert.ok(html.includes('dd-footer-actions'), 'Footer actions container dd-footer-actions must exist');
});

test('deep-dive drawer close buttons styles in public/css/styles.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

  // タイトル長による押し出し・見切れ防止設定
  assert.ok(css.includes('.drawer-head-actions'), '.drawer-head-actions must exist');
  assert.ok(css.includes('flex-shrink: 0'), 'Header actions must prevent flex shrinking / overflow truncation');

  // 閉じるボタンスタイル定義
  assert.ok(css.includes('.btn-dd-close'), '.btn-dd-close class must be styled');
  assert.ok(css.includes('.btn-dd-close-foot'), '.btn-dd-close-foot class must be styled');
  assert.ok(css.includes('.dd-footer-actions'), '.dd-footer-actions class must be styled');
});

test('deep-dive module binds close buttons and keyboard Escape in public/js/modules/deep-dive.js', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/js/modules/deep-dive.js'), 'utf8');

  assert.ok(js.includes('#btn-close-deepdive'), 'deep-dive.js must bind #btn-close-deepdive');
  assert.ok(js.includes('#btn-close-deepdive-bottom'), 'deep-dive.js must bind #btn-close-deepdive-bottom');
  assert.ok(js.includes('closeDeepDive()'), 'deep-dive.js must call closeDeepDive()');
  assert.ok(js.includes("e.key === 'Escape'"), 'deep-dive.js must support Escape key');
  assert.ok(js.includes('hydrateIcons(drawerEl)'), 'deep-dive.js must hydrate icons when drawer opens');
});


// ==========================================================================
// Dual URL Compare Mode Tests (v2.15.0)
// - URL vs URL 直接対決テーマの構文認識
// - DOM 要素整合性 (#dual-url-badge)
// ==========================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dual-compare: detects "URL vs URL" and extracts targets correctly', () => {
  const pattern = /^(https?:\/\/[^\s]+)\s+(?:vs|VS|と)\s+(https?:\/\/[^\s]+)$/i;

  const m1 = 'https://slack.com vs https://teams.microsoft.com'.match(pattern);
  assert.ok(m1);
  assert.equal(m1[1], 'https://slack.com');
  assert.equal(m1[2], 'https://teams.microsoft.com');

  const m2 = 'https://notion.so VS https://obsidian.md'.match(pattern);
  assert.ok(m2);
  assert.equal(m2[1], 'https://notion.so');
  assert.equal(m2[2], 'https://obsidian.md');

  const m3 = 'http://service-a.com と https://service-b.com'.match(pattern);
  assert.ok(m3);
  assert.equal(m3[1], 'http://service-a.com');
  assert.equal(m3[2], 'https://service-b.com');

  const mNon = '生成AI 業務活用'.match(pattern);
  assert.equal(mNon, null);
});

test('dual-compare UI consistency: index.html includes dual-url-badge', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(html.includes('id="dual-url-badge"'), 'dual-url-badge must exist in index.html');
  assert.ok(html.includes('URL vs URL 直接対決モード'), 'dual-url-badge text must exist');
});

test('dual-compare style consistency: styles.css contains dual-url-badge classes', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
  assert.ok(css.includes('.dual-url-badge'), '.dual-url-badge class must exist in styles.css');
});

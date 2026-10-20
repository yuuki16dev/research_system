'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unwrapDdgUrl, stripTags, decodeEntities } = require('../server/search');

test('search.decodeEntities converts HTML entities correctly', () => {
  assert.equal(decodeEntities('&lt;div&gt;&amp;&#39;&quot;&lt;/div&gt;'), "<div>&'\"</div>");
  assert.equal(decodeEntities('Hello &nbsp; World'), 'Hello   World');
});

test('search.stripTags removes HTML tags and decodes entities', () => {
  const html = '<p>This is <strong>important</strong> &amp; useful.</p>';
  assert.equal(stripTags(html), 'This is important & useful.');
});

test('search.unwrapDdgUrl extracts target URL from DuckDuckGo redirect link', () => {
  // Direct URL
  assert.equal(unwrapDdgUrl('https://example.com/article'), 'https://example.com/article');

  // DDG redirect wrapper URL with uddg query param
  const ddgUrl = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.ycombinator.com%2Fitem%3Fid%3D123&rut=...';
  assert.equal(unwrapDdgUrl(ddgUrl), 'https://news.ycombinator.com/item?id=123');

  // Protocol-relative URL
  const protoRelative = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com';
  assert.equal(unwrapDdgUrl(protoRelative), 'https://github.com');
});

test('AbortSignal.any polyfill handles multiple signals or aborts', () => {
  assert.equal(typeof AbortSignal.any, 'function');

  const c1 = new AbortController();
  const c2 = new AbortController();
  const combined = AbortSignal.any([c1.signal, c2.signal]);

  assert.equal(combined.aborted, false);
  c1.abort('custom reason');
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, 'custom reason');
});

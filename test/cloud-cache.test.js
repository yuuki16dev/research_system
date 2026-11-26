'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const cache = require('../server/cache');
const search = require('../server/search');
const usage = require('../server/usage');

test('R-10 unit: MemoryLruCache defaults to 24h TTL / 50MB cap and evicts oldest LRU entries when byte limit exceeded', () => {
  assert.strictEqual(cache.DEFAULT_TTL_MS, 24 * 60 * 60 * 1000);
  assert.strictEqual(cache.DEFAULT_MAX_BYTES, 50 * 1024 * 1024);

  let fakeNow = 1000;
  const c = new cache.MemoryLruCache({
    ttlMs: 1000,
    maxBytes: 250,
    maxEntries: 10,
    now: () => fakeNow,
  });

  // k1 (~64B), k2 (~64B), k3 (~64B) を順に保存
  assert.strictEqual(c.set('k1', { p: 'a'.repeat(50) }), true);
  assert.strictEqual(c.set('k2', { p: 'b'.repeat(50) }), true);
  assert.strictEqual(c.set('k3', { p: 'c'.repeat(50) }), true);

  // k1 を参照して最近使用に更新 -> 最古は k2 になる
  assert.ok(c.get('k1'));

  // k4 (~100B) を入れると 250B を超えるため最古の k2 が削除されること
  assert.strictEqual(c.set('k4', { p: 'd'.repeat(90) }), true);
  assert.ok(c.totalBytes <= 250, `totalBytes (${c.totalBytes}) must not exceed 250`);
  assert.strictEqual(c.get('k2'), undefined, 'Oldest LRU entry k2 must be evicted');
  assert.ok(c.get('k1'), 'Recently read k1 must remain');
  assert.ok(c.get('k4'), 'Newly added k4 must remain');

  // 単一エントリが上限を超える場合は保存せず他を壊さない
  assert.strictEqual(c.set('huge', { p: 'x'.repeat(500) }), false);
  assert.ok(c.get('k4'));

  // 有効期限（TTL）経過後はキャッシュミスになり自動削除される
  fakeNow += 1500;
  assert.strictEqual(c.get('k1'), undefined, 'Expired entry must return undefined');
  assert.strictEqual(c.stats().entries, 0);
});

test('R-10 integration: duplicate Tavily search hits cache, makes 0 Tavily calls, and does not count Tavily credits', async () => {
  cache.sharedCache.clear();
  const originalFetch = globalThis.fetch;
  let tavilyCalls = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes('api.tavily.com')) {
      tavilyCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              title: 'Cached Result',
              url: 'https://example.com/article-1',
              content: 'Summary snippet',
              published_date: '2026-11-14',
            },
          ],
        }),
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const beforeUsage = usage.loadUsage();
    const beforeCount = Number(beforeUsage.searches?.tavilyTotal || 0);

    // 1回目: Tavily へ 1 回アクセス・1 クレジット加算
    const first = await search.run({
      provider: 'tavily',
      apiKey: 'dummy-tavily-key',
      query: 'AIエージェント 市場規模',
      maxResults: 5,
      deep: false,
      timeRange: 'month',
    });
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].domain, 'example.com');
    assert.strictEqual(tavilyCalls, 1);

    const midUsage = usage.loadUsage();
    assert.strictEqual(Number(midUsage.searches?.tavilyTotal || 0), beforeCount + 1);

    // 2回目（同一クエリ・同一条件）: キャッシュから返却し、Tavily 呼び出し回数・クレジット加算ともに 0
    const second = await search.run({
      provider: 'tavily',
      apiKey: 'dummy-tavily-key',
      query: 'AIエージェント 市場規模',
      maxResults: 5,
      deep: false,
      timeRange: 'month',
    });
    assert.strictEqual(second.length, 1);
    assert.strictEqual(second[0].title, 'Cached Result');
    assert.strictEqual(tavilyCalls, 1, 'Second identical Tavily query must make 0 additional API calls');

    const afterUsage = usage.loadUsage();
    assert.strictEqual(
      Number(afterUsage.searches?.tavilyTotal || 0),
      beforeCount + 1,
      'Cache hit must NOT increment Tavily credit counter'
    );

    // 検索条件が異なれば別キーとして Tavily へ新規問い合わせ
    await search.run({
      provider: 'tavily',
      apiKey: 'dummy-tavily-key',
      query: 'AIエージェント 市場規模',
      maxResults: 5,
      deep: true,
      timeRange: 'month',
    });
    assert.strictEqual(tavilyCalls, 2, 'Different search params must trigger new Tavily call');
  } finally {
    globalThis.fetch = originalFetch;
    cache.sharedCache.clear();
  }
});

test('R-10 integration: fetchPage caches extracted body by URL across calls with varying maxChars', async () => {
  cache.sharedCache.clear();
  let pageRequests = 0;
  let robotsRequests = 0;

  const mockServer = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      robotsRequests += 1;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('User-agent: *\nAllow: /\n');
      return;
    }
    pageRequests += 1;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>Sample Page</title></head><body><main><p>' + '本文テキスト'.repeat(30) + '</p></main></body></html>');
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const { port } = mockServer.address();
  const targetUrl = `http://127.0.0.1:${port}/page-cache-test`;

  try {
    const p1 = await search.fetchPage(targetUrl, {
      maxChars: 20,
      _dangerouslyBypassFirstHopForTest: true,
    });
    assert.strictEqual(p1.title, 'Sample Page');
    assert.strictEqual(p1.text.length, 20);
    assert.strictEqual(pageRequests, 1);
    assert.strictEqual(robotsRequests, 1);

    // 2回目はキャッシュから返り HTTP リクエストは増えず、maxChars に応じて正しく切り出される
    const p2 = await search.fetchPage(targetUrl, {
      maxChars: 50,
      _dangerouslyBypassFirstHopForTest: true,
    });
    assert.strictEqual(p2.title, 'Sample Page');
    assert.strictEqual(p2.text.length, 50);
    assert.strictEqual(pageRequests, 1, 'Second fetchPage on same URL must use cache');
    assert.strictEqual(robotsRequests, 1, 'Second fetchPage on same host must reuse robots.txt cache');
  } finally {
    await new Promise((resolve) => {
      mockServer.closeAllConnections?.();
      mockServer.close(resolve);
    });
    cache.sharedCache.clear();
  }
});

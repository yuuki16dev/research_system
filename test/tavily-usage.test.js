'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchLiveTavilyUsage,
  getFullUsageSummary,
  resetTavilyCacheForTest,
} = require('../server/usage');

test.beforeEach(() => {
  resetTavilyCacheForTest();
});

test('tavily-usage: returns unconfigured when apiKey is empty or undefined', async () => {
  const res1 = await fetchLiveTavilyUsage('');
  assert.equal(res1.configured, false);
  assert.equal(res1.ok, false);
  assert.equal(res1.message, 'APIキー未設定');

  const res2 = await fetchLiveTavilyUsage(null);
  assert.equal(res2.configured, false);
  assert.equal(res2.ok, false);
});

test('tavily-usage: successfully parses standard 200 OK Tavily API response and masks key', async () => {
  let callCount = 0;
  const mockFetch = async (url, opts) => {
    callCount++;
    assert.ok(url.includes('/usage'));
    assert.equal(opts.headers.Authorization, 'Bearer tvly-test-secret-1234');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        key: {
          usage: 150,
          limit: 1000,
          search_usage: 120,
          extract_usage: 20,
          crawl_usage: 10,
        },
        account: {
          current_plan: 'Researcher',
          plan_usage: 150,
          plan_limit: 1000,
        },
      }),
    };
  };

  const res = await fetchLiveTavilyUsage('  tvly-test-secret-1234  ', { fetchFn: mockFetch });
  assert.equal(callCount, 1);
  assert.equal(res.configured, true);
  assert.equal(res.ok, true);
  assert.equal(res.plan, 'Researcher');
  assert.equal(res.planUsage, 150);
  assert.equal(res.planLimit, 1000);
  assert.equal(res.remaining, 850);
  assert.equal(res.percent, 15);
  assert.equal(res.details.search, 120);
  assert.equal(res.details.extract, 20);
  assert.equal(res.details.crawl, 10);
  assert.strictEqual(res.maskedKey, '••••••••');
});

test('tavily-usage: caches response within TTL and supports forceRefresh', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        key: { usage: 50, limit: 1000 },
        account: { plan_usage: 50, plan_limit: 1000 },
      }),
    };
  };

  const key = 'tvly-cache-test-key-5678';
  // 1st call -> fetches from API
  const res1 = await fetchLiveTavilyUsage(key, { fetchFn: mockFetch });
  assert.equal(callCount, 1);
  assert.equal(res1.ok, true);
  assert.equal(res1.planUsage, 50);

  // 2nd call -> returns from cache (callCount remains 1)
  const res2 = await fetchLiveTavilyUsage(key, { fetchFn: mockFetch });
  assert.equal(callCount, 1);
  assert.equal(res2.fromCache, true);
  assert.equal(res2.planUsage, 50);

  // 3rd call with forceRefresh -> triggers new fetch
  const res3 = await fetchLiveTavilyUsage(key, { forceRefresh: true, fetchFn: mockFetch });
  assert.equal(callCount, 2);
  assert.equal(res3.planUsage, 50);
});

test('tavily-usage: gracefully falls back to last successful cache when 429 rate limit occurs', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          key: { usage: 300, limit: 1000, search_usage: 300 },
          account: { plan_usage: 300, plan_limit: 1000 },
        }),
      };
    }
    // 2nd call triggers 429
    return {
      ok: false,
      status: 429,
      json: async () => ({ detail: { error: 'Rate limit exceeded: 10 requests per 10 minutes.' } }),
    };
  };

  const key = 'tvly-rate-limit-test';
  // 1st successful call
  const res1 = await fetchLiveTavilyUsage(key, { fetchFn: mockFetch });
  assert.equal(res1.ok, true);
  assert.equal(res1.planUsage, 300);

  // 2nd call with forceRefresh returns 429, but should fall back to last cache gracefully
  const res2 = await fetchLiveTavilyUsage(key, { forceRefresh: true, fetchFn: mockFetch });
  assert.equal(res2.ok, true);
  assert.equal(res2.isRateLimited, true);
  assert.equal(res2.fromCache, true);
  assert.equal(res2.planUsage, 300);
  assert.ok(res2.rateLimitNotice.includes('レート制限'));
});

test('tavily-usage: properly handles 401 Unauthorized with clear error reason', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: { error: 'Unauthorized: missing or invalid API key.' } }),
  });

  const res = await fetchLiveTavilyUsage('tvly-invalid-key-9999', { fetchFn: mockFetch });
  assert.equal(res.configured, true);
  assert.equal(res.ok, false);
  assert.ok(res.error.includes('401'));
  assert.ok(res.error.includes('無効または認証に失敗'));
});

test('tavily-usage: getFullUsageSummary integrates live Tavily status and local searches', async () => {
  const mockSettings = {
    geminiApiKey: '',
    tavilyApiKey: '',
  };
  const summary = await getFullUsageSummary(mockSettings);
  assert.equal(summary.tavily.configured, false);
  assert.equal(summary.tavily.ok, false);
  assert.equal(typeof summary.tavily.localTotalSearches, 'number');
});


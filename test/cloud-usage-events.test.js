'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const usageEvents = require('../server/usage-events');
const { runResearch } = require('../server/pipeline');
const deepdive = require('../server/deepdive');
const presentation = require('../server/presentation');

test('C-3: calculateTavilyCredits calculates basic and deep search credits', () => {
  assert.equal(usageEvents.calculateTavilyCredits(1, false), 1);
  assert.equal(usageEvents.calculateTavilyCredits(3, false), 3);
  assert.equal(usageEvents.calculateTavilyCredits(1, true), 2);
  assert.equal(usageEvents.calculateTavilyCredits(4, true), 8);
  assert.equal(usageEvents.calculateTavilyCredits(0, false), 0);
});

test('C-3: calculateEstimatedCostJpy calculates reasonable cost using model pricing and rate', () => {
  const cost = usageEvents.calculateEstimatedCostJpy({
    model: 'gemini-3.8-flash',
    promptTokens: 10000,
    outputTokens: 2000,
    tavilyCredits: 2,
  });
  assert.equal(typeof cost, 'number');
  assert.ok(cost > 0, 'Cost should be greater than 0');
});

test('C-3: Running research records usage event with correct schema and adds 1 record', async () => {
  usageEvents.clearLocalUsageEvents();

  const mockJob = {
    id: 'test-job-c3-1',
    userId: 'user-c3-test',
    params: {
      theme: 'C-3 テスト調査',
      scope: 'web',
      depth: 'quick',
      purpose: 'general',
      forceMock: true,
    },
    emit: () => {},
    progress: () => {},
    log: () => {},
    controller: new AbortController(),
  };

  const settings = {
    mode: 'mock',
    geminiModel: 'gemini-3.8-flash',
  };

  const beforeEvents = usageEvents.getLocalUsageEvents('user-c3-test');
  assert.equal(beforeEvents.length, 0);

  const result = await runResearch(mockJob, settings);
  assert.ok(result);

  const afterEvents = usageEvents.getLocalUsageEvents('user-c3-test');
  assert.equal(afterEvents.length, 1, 'Research execution should add exactly 1 usage_event record');

  const ev = afterEvents[0];
  assert.equal(ev.user_id, 'user-c3-test');
  assert.equal(ev.kind, 'research_quick');
  assert.equal(ev.job_id, 'test-job-c3-1');
  assert.equal(ev.status, 'done');
  assert.equal(typeof ev.est_cost_jpy, 'number');
  assert.ok(ev.created_at);
});

test('C-3: Aggregating by user_id calculates total estimated cost across multiple events', async () => {
  usageEvents.clearLocalUsageEvents();

  // ユーザーAのイベント2件
  await usageEvents.recordUsageEvent({
    userId: 'user-a',
    kind: 'research_quick',
    promptTokens: 5000,
    outputTokens: 1000,
    tavilyCredits: 1,
  });
  await usageEvents.recordUsageEvent({
    userId: 'user-a',
    kind: 'deepdive',
    promptTokens: 3000,
    outputTokens: 500,
    tavilyCredits: 1,
  });

  // ユーザーBのイベント1件
  await usageEvents.recordUsageEvent({
    userId: 'user-b',
    kind: 'research_deep',
    promptTokens: 20000,
    outputTokens: 4000,
    tavilyCredits: 4,
  });

  const allEvents = usageEvents.getLocalUsageEvents();
  assert.equal(allEvents.length, 3);

  // select user_id, sum(est_cost_jpy) from usage_events group by user_id のシミュレーション
  const costByUser = {};
  for (const ev of allEvents) {
    costByUser[ev.user_id] = (costByUser[ev.user_id] || 0) + ev.est_cost_jpy;
  }

  assert.ok(costByUser['user-a'] > 0);
  assert.ok(costByUser['user-b'] > 0);
  assert.ok(costByUser['user-b'] > costByUser['user-a'], 'Deep research should cost more than quick research');
});

test('C-3: Cloud mode sends usage event to Supabase rest API and survives network failures gracefully', async () => {
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  let postedRecord = null;

  try {
    process.env.SUPABASE_URL = 'https://mock-supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key';

    // 1. 正常系: Supabase への POST が成功
    globalThis.fetch = async (url, opts) => {
      if (url.includes('/rest/v1/usage_events')) {
        postedRecord = JSON.parse(opts.body);
        return {
          ok: true,
          status: 201,
          json: async () => [postedRecord],
        };
      }
      return originalFetch(url, opts);
    };

    const ev = await usageEvents.recordUsageEvent({
      userId: 'user-cloud-123',
      kind: 'research_deep',
      jobId: 'job-cloud-456',
      model: 'gemini-3.8-flash',
      promptTokens: 15000,
      outputTokens: 3000,
      geminiCalls: 2,
      tavilyCredits: 4,
      status: 'done',
    });

    assert.ok(ev);
    assert.equal(postedRecord.user_id, 'user-cloud-123');
    assert.equal(postedRecord.kind, 'research_deep');
    assert.equal(postedRecord.gemini_calls, 2);
    assert.equal(postedRecord.tavily_credits, 4);

    // 2. 異常系: Supabase が 500 エラーを返しても例外を投げずに正常終了する（フェイルセーフ）
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const fallbackEv = await usageEvents.recordUsageEvent({
      userId: 'user-cloud-fail',
      kind: 'deepdive',
      status: 'done',
    });
    assert.ok(fallbackEv, 'Should return event record even if cloud insert fails');
  } finally {
    if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl;
    else delete process.env.SUPABASE_URL;
    if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalThis.fetch = originalFetch;
  }
});


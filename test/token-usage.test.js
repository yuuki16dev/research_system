'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadUsage, recordGemini, recordGroq, getFullUsageSummary } = require('../server/usage');
const { normalizeResult } = require('../server/util');

test('usage.recordGroq accurately records prompt, candidate and total tokens', () => {
  const initial = loadUsage();
  const initialTotal = (initial.groq && initial.groq.totalTokens) || 0;

  recordGroq({
    model: 'llama-3.3-70b-versatile',
    promptTokens: 120,
    candidatesTokens: 350,
    totalTokens: 470,
  });

  const updated = loadUsage();
  assert.ok(updated.groq);
  assert.equal(updated.groq.totalTokens, initialTotal + 470);
  assert.ok(updated.groq.totalPromptTokens >= 120);
  assert.ok(updated.groq.totalCandidatesTokens >= 350);
  assert.ok(Array.isArray(updated.groq.history));
  assert.ok(updated.groq.history.length > 0);
  assert.equal(updated.groq.history[0].model, 'llama-3.3-70b-versatile');
  assert.equal(updated.groq.history[0].totalTokens, 470);
});

test('usage.getFullUsageSummary includes groq statistics and official urls', async () => {
  const summary = await getFullUsageSummary({
    geminiApiKey: 'test-key',
    groqApiKey: 'gsk_test12345',
    groqModel: 'llama-3.3-70b-versatile',
  });

  assert.ok(summary.groq);
  assert.equal(summary.groq.configured, true);
  assert.equal(summary.groq.model, 'llama-3.3-70b-versatile');
  assert.ok(typeof summary.groq.totalTokens === 'number');
  assert.ok(summary.groq.quotas);
  assert.ok(summary.groq.officialUrls.dashboard);
  assert.ok(summary.groq.officialUrls.apiKey);
});

test('util.normalizeResult preserves and sanitizes tokenUsage object', () => {
  const rawWithUsage = {
    title: 'テストレポート',
    summary: 'サマリー',
    tokenUsage: {
      promptTokens: 1500,
      candidatesTokens: 800,
      totalTokens: 2300,
      calls: 2,
      provider: 'gemini',
      model: 'gemini-3.8-flash',
    },
  };

  const res = normalizeResult(rawWithUsage, { id: 'test-1', theme: 'テスト' });
  assert.ok(res.tokenUsage);
  assert.equal(res.tokenUsage.promptTokens, 1500);
  assert.equal(res.tokenUsage.candidatesTokens, 800);
  assert.equal(res.tokenUsage.totalTokens, 2300);
  assert.equal(res.tokenUsage.calls, 2);
  assert.equal(res.tokenUsage.provider, 'gemini');
  assert.equal(res.tokenUsage.model, 'gemini-3.8-flash');

  const rawWithoutUsage = {
    title: '未集計レポート',
    summary: 'サマリー',
  };
  const resEmpty = normalizeResult(rawWithoutUsage, { id: 'test-2', theme: 'テスト' });
  assert.equal(resEmpty.tokenUsage, null);
});

test('UI and exporters include token usage displays', () => {
  const renderJs = fs.readFileSync(path.join(__dirname, '../public/js/render.js'), 'utf8');
  assert.ok(renderJs.includes('tag-token-usage'), 'render.js should render token usage tag');
  assert.ok(renderJs.includes('消費トークン:'), 'render.js should have label 消費トークン:');

  const usageModalJs = fs.readFileSync(path.join(__dirname, '../public/js/modules/usage-modal.js'), 'utf8');
  assert.ok(usageModalJs.includes('Groq API トークン内訳'), 'usage-modal.js should include Groq token breakdown');
  assert.ok(usageModalJs.includes('直近のGroqリクエスト履歴'), 'usage-modal.js should include Groq history');

  const exportersJs = fs.readFileSync(path.join(__dirname, '../public/js/exporters.js'), 'utf8');
  assert.ok(exportersJs.includes('消費トークン:'), 'exporters.js should export token usage in markdown and text');
});

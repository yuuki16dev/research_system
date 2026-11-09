'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const history = require('../server/history');

test('share-report: server routes /api/share/:id and /share/:id', async () => {
  // テスト用の一時レポートを作成
  const dummyReport = {
    id: '12345678-1234-1234-1234-123456789abc',
    theme: 'シェア機能テスト調査',
    title: '【検証レポート】共有リンク機能の動作確認',
    summary: '本レポートは共有リンク発行機能のテスト用データです。',
    keyPoints: ['ポイント1', 'ポイント2'],
    sources: [{ title: 'テスト出典', url: 'https://example.com' }],
    createdAt: new Date().toISOString(),
    mode: 'live',
  };

  history.save(dummyReport);

  // 1. 保存されたレポートが /api/share/:id 相当で取得できること
  const fetched = history.get(dummyReport.id);
  assert.ok(fetched, 'dummy report must be retrieved');
  assert.strictEqual(fetched.id, dummyReport.id);
  assert.strictEqual(fetched.theme, dummyReport.theme);

  // 2. 存在しないIDは null が返ること
  const notFound = history.get('00000000-0000-0000-0000-000000000000');
  assert.strictEqual(notFound, null);

  // クリーンアップ
  history.remove(dummyReport.id);
});

test('share-report: DOM and UI consistency in index.html and share.html', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('id="btn-share-report"'), 'index.html must contain #btn-share-report');
  assert.ok(indexHtml.includes('id="modal-share"'), 'index.html must contain #modal-share');
  assert.ok(indexHtml.includes('id="share-url-input"'), 'index.html must contain #share-url-input');
  assert.ok(indexHtml.includes('id="btn-copy-share-url"'), 'index.html must contain #btn-copy-share-url');

  const shareHtml = fs.readFileSync(path.join(ROOT, 'public', 'share.html'), 'utf8');
  assert.ok(shareHtml.includes('id="share-export-group"'), 'share.html must contain #share-export-group');
  assert.ok(shareHtml.includes('id="share-loading"'), 'share.html must contain #share-loading');
  assert.ok(shareHtml.includes('id="share-not-found"'), 'share.html must contain #share-not-found');
  assert.ok(shareHtml.includes('id="report"'), 'share.html must contain #report');
  assert.ok(shareHtml.includes('src="/js/share.js"'), 'share.html must load /js/share.js');
});

test('share-report: ES module syntax integrity for share.js', () => {
  const shareJsPath = path.join(ROOT, 'public', 'js', 'share.js');
  assert.ok(fs.existsSync(shareJsPath), 'share.js must exist');

  // node --check で構文エラーがないことを検証
  assert.doesNotThrow(() => {
    execSync(`node --check "${shareJsPath}"`, { stdio: 'pipe' });
  }, 'share.js must pass node --check without syntax error');
});


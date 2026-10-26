'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const presentation = require('../server/presentation');

test('presentation: resolveAudienceProfile correctly resolves known and custom audiences', () => {
  const pEng = presentation.resolveAudienceProfile('開発チーム・エンジニア');
  assert.strictEqual(pEng.type, 'engineer');
  assert.ok(pEng.focus.includes('技術'));

  const pExec = presentation.resolveAudienceProfile('経営陣・役員');
  assert.strictEqual(pExec.type, 'exec');
  assert.ok(pExec.focus.includes('投資対効果') || pExec.focus.includes('ビジネスインパクト'));

  const pBiz = presentation.resolveAudienceProfile('営業部門');
  assert.strictEqual(pBiz.type, 'business');

  const pClient = presentation.resolveAudienceProfile('外部ステークホルダー');
  assert.strictEqual(pClient.type, 'client');

  const pCustom = presentation.resolveAudienceProfile('社内ハッカソン審査員');
  assert.strictEqual(pCustom.type, 'custom');
  assert.ok(pCustom.name.includes('社内ハッカソン審査員'));
});

test('presentation: generatePrompt builds structured slide prompt with token placeholders and requirements', () => {
  const prompt = presentation.generatePrompt({
    document: '新機能：PDF出力エンジンの改善案',
    audience: '開発チーム・エンジニア',
    goal: '技術選定と実装スケジュールの合意',
  });

  assert.ok(prompt.includes('開発チーム・エンジニア・技術リード'), 'prompt must mention resolved audience name');
  assert.ok(prompt.includes('技術選定と実装スケジュールの合意'), 'prompt must mention goal');
  assert.ok(prompt.includes('新機能：PDF出力エンジンの改善案'), 'prompt must contain document text');
  assert.ok(prompt.includes('トークスクリプト'), 'prompt must instruct talk script generation');
  assert.ok(prompt.includes('キーメッセージ'), 'prompt must require key message per slide');
});

test('presentation: generatePrompt includes attached files information', () => {
  const prompt = presentation.generatePrompt({
    document: '',
    audience: '経営陣・役員',
    goal: '予算承認',
    files: [{ name: '2027年事業計画.pdf', mimeType: 'application/pdf' }],
  });

  assert.ok(prompt.includes('添付ファイル: 2027年事業計画.pdf'), 'prompt must mention attached file');
  assert.ok(prompt.includes('経営陣・役員'), 'prompt must mention audience');
});

test('presentation: UI elements and DOM consistency in public/index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  assert.ok(html.includes('id="btn-open-presentation-maker"'), 'must have topbar slide maker button');
  assert.ok(html.includes('id="modal-presentation"'), 'must have modal-presentation container');
  assert.ok(html.includes('id="pres-document-input"'), 'must have document input textarea');
  assert.ok(html.includes('id="pres-audience-chips"'), 'must have audience chips row');
  assert.ok(html.includes('id="btn-pres-generate-prompt"'), 'must have prompt generate button');
  assert.ok(html.includes('id="btn-pres-generate-slides"'), 'must have slide generate button');
  assert.ok(html.includes('id="pres-file-dropzone"'), 'must have file dropzone');
  assert.ok(html.includes('id="btn-pres-browse-file"'), 'must have file browse button');
  assert.ok(html.includes('id="pres-file-input"'), 'must have file input element');
  assert.ok(html.includes('id="pres-attached-files"'), 'must have attached files list container');
});

test('presentation: ES module syntax integrity for presentation-modal.js', () => {
  const modPath = path.join(ROOT, 'public', 'js', 'modules', 'presentation-modal.js');
  assert.ok(fs.existsSync(modPath), 'presentation-modal.js must exist');

  const res = spawnSync(process.execPath, ['--check', modPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `presentation-modal.js syntax error: ${res.stderr}`);
});


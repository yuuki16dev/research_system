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

test('presentation: slide inline edit and PowerPoint export DOM consistency in public/index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  assert.ok(html.includes('id="btn-slide-toggle-edit"'), 'must have btn-slide-toggle-edit button');
  assert.ok(html.includes('id="btn-export-pptx"'), 'must have btn-export-pptx button');
  assert.ok(html.includes('/vendor/pptxgen.bundle.js'), 'must have pptxgen.bundle.js script tag');
});

test('presentation: pptx-export.js module syntax integrity and vendor bundle existence', () => {
  const modPath = path.join(ROOT, 'public', 'js', 'modules', 'pptx-export.js');
  assert.ok(fs.existsSync(modPath), 'pptx-export.js must exist');

  const res = spawnSync(process.execPath, ['--check', modPath], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, `pptx-export.js syntax error: ${res.stderr}`);

  const vendorPath = path.join(ROOT, 'public', 'vendor', 'pptxgen.bundle.js');
  assert.ok(fs.existsSync(vendorPath), 'public/vendor/pptxgen.bundle.js must exist');
  const stats = fs.statSync(vendorPath);
  assert.ok(stats.size > 100000, 'pptxgen.bundle.js must be a valid bundle (>100KB)');
});

test('presentation: pptx-export.js contains auto-scaling helpers and shrinkText options', () => {
  const modPath = path.join(ROOT, 'public', 'js', 'modules', 'pptx-export.js');
  const code = fs.readFileSync(modPath, 'utf8');

  assert.ok(code.includes('function calcFontSize'), 'pptx-export.js must define calcFontSize helper');
  assert.ok(code.includes('shrinkText: true'), 'pptx-export.js must enable shrinkText for text bounds safety');
  assert.ok(code.includes('colWidths'), 'pptx-export.js must dynamically calculate colWidths based on table columns');
  assert.ok(code.includes('calloutY'), 'pptx-export.js must dynamically position bottom callout based on table height');
});

test('presentation: export-handlers.js and styles.css have export spinner and progress feedback', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');
  assert.ok(css.includes('.rs-spinner-sm'), 'styles.css must define .rs-spinner-sm');
  assert.ok(css.includes('@keyframes rs-spin'), 'styles.css must define @keyframes rs-spin');

  const handlers = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'export-handlers.js'), 'utf8');
  assert.ok(handlers.includes('rs-spinner-sm'), 'export-handlers.js must use rs-spinner-sm');
  assert.ok(handlers.includes('PDF生成中'), 'export-handlers.js must show PDF rendering notice');
  assert.ok(handlers.includes('PPTX作成中'), 'export-handlers.js must show PPTX creating notice');
  assert.ok(handlers.includes('ダウンロード完了'), 'export-handlers.js must show completion feedback');

  const exporters = fs.readFileSync(path.join(ROOT, 'public', 'js', 'exporters.js'), 'utf8');
  assert.ok(exporters.includes('フォント完全描画のため約3〜5秒要します'), 'exporters.js must mention font rendering time');
});




'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../server/search');
const util = require('../server/util');
const excel = require('../server/excel');

test('research enhancement: extractText extracts tables, lists, and main article accurately', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>生成AI導入コストとリスク分析白書</title></head>
      <body>
        <nav><a href="/">ホーム</a></nav>
        <div class="sidebar">広告バナー</div>
        <main>
          <h1>生成AIの導入における初期費用と課題</h1>
          <p>生成AIの導入にあたり、多くの企業が直面する課題は初期費用と法的リスクです。</p>
          <table>
            <tr><th>モデル名</th><th>月額費用</th><th>最大トークン</th></tr>
            <tr><td>Gemini 3.8 Flash</td><td>無料枠あり</td><td>1,000,000</td></tr>
          </table>
          <ul>
            <li>セキュリティポリシーの策定</li>
            <li>社内ガイドラインの周知</li>
          </ul>
        </main>
        <footer>© 2026 Example Corp</footer>
      </body>
    </html>
  `;

  const { title, text } = search.extractText(html);
  assert.strictEqual(title, '生成AI導入コストとリスク分析白書');
  assert.ok(text.includes('Gemini 3.8 Flash'), 'Should extract table cell content');
  assert.ok(text.includes('セキュリティポリシーの策定'), 'Should extract list item content');
  assert.ok(!text.includes('広告バナー'), 'Should filter sidebar content');
});

test('research enhancement: PURPOSE_LABELS defines risk and cost styles', () => {
  assert.ok(util.PURPOSE_LABELS.risk, 'PURPOSE_LABELS.risk must be defined');
  assert.ok(util.PURPOSE_LABELS.cost, 'PURPOSE_LABELS.cost must be defined');
  assert.ok(util.PURPOSE_LABELS.risk.includes('リスク'), 'PURPOSE_LABELS.risk should mention risk');
  assert.ok(util.PURPOSE_LABELS.cost.includes('コスト'), 'PURPOSE_LABELS.cost should mention cost');
});

test('research enhancement: Excel engine reflects purposeLabel in subtitle', () => {
  const sampleData = {
    title: 'クラウド移行の費用対効果分析',
    theme: 'クラウド移行',
    purpose: 'cost',
    purposeLabel: 'コスト・ROI・相見積もり',
    createdAt: new Date().toISOString(),
    metrics: [{ label: '削減率', value: '35%', note: '前年比' }],
    sources: [{ title: '公式料金表', url: 'https://aws.amazon.com/pricing' }],
  };

  const formatted = excel.transformDataToExcelFormat(sampleData);
  assert.ok(formatted.meta.subtitle.includes('コスト・ROI・相見積もり'), 'Subtitle should contain purposeLabel');
  assert.strictEqual(formatted.meta.theme, 'クラウド移行');
});

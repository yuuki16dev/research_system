// ==========================================================================
// Phase 1 Features Tests (v2.14.0)
// - 音声サマリー原稿生成
// - 社内共有（Slack/Teams, 上長報告メール）フォーマット
// - テーマ推敲・プロ調査切り口サジェスト
// - DOM 要素整合性
// ==========================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mockReport = {
  theme: '生成AI 業務活用',
  title: '企業における生成AI業務活用の最新動向とROI分析',
  summary: '生成AIの業務適用はPoC段階から本格的な実務展開へと移行しており、カスタマーサポートやドキュメント要約で30%以上の工数削減が確認されています。',
  keyPoints: [
    'カスタマーサポート対応工数が前年比32%削減',
    '社内ナレッジ検索の自動化により検索時間が半減',
    'セキュリティとガバナンスポリシーの策定が最重要課題',
  ],
  metrics: [
    { label: '工数削減効果', value: '32%', note: 'CS部門' },
    { label: '年間ROI', value: '185%', note: '導入初年度' },
  ],
  insights: [
    { priority: '高', title: '全社展開', body: '段階的な社内ガイドライン整備と現場リーダーの育成を推奨します。' },
  ],
  deepThinking: {
    analystNote: {
      coreHypothesis: '単なるツール導入にとどまらず、業務フローの再設計を同時に推進することが成功の鍵である。',
    },
  },
  sources: [
    { title: 'AI活用レポート2026', url: 'https://example.com/report', domain: 'example.com', score: 95 },
  ],
};

test('query-polisher: generateQuerySuggestions produces multi-angle search chips', async () => {
  const { generateQuerySuggestions } = await import('../public/js/modules/query-polisher.js');

  const emptyShort = generateQuerySuggestions('a');
  assert.equal(emptyShort.length, 0);

  const suggestions = generateQuerySuggestions('生成AI');
  assert.equal(suggestions.length, 4);

  const labels = suggestions.map((s) => s.label);
  assert.ok(labels.some((l) => l.includes('競合')));
  assert.ok(labels.some((l) => l.includes('最新アーキテクチャ')));
  assert.ok(labels.some((l) => l.includes('リスク')));
  assert.ok(labels.some((l) => l.includes('ROI')));

  suggestions.forEach((s) => {
    assert.ok(s.query.startsWith('生成AI'));
    assert.ok(s.purpose);
  });
});

test('share-formats: buildSlackFormat produces formatted chat summary', async () => {
  const { buildSlackFormat } = await import('../public/js/modules/share-formats.js');

  const text = buildSlackFormat(mockReport);
  assert.ok(text.includes('企業における生成AI業務活用の最新動向とROI分析'));
  assert.ok(text.includes('エグゼクティブ要約'));
  assert.ok(text.includes('主要ポイント'));
  assert.ok(text.includes('重要指標'));
  assert.ok(text.includes('工数削減効果'));
  assert.ok(text.includes('32%'));
  assert.ok(text.includes('推奨アクション'));
});

test('share-formats: buildEmailFormat produces business email draft', async () => {
  const { buildEmailFormat } = await import('../public/js/modules/share-formats.js');

  const email = buildEmailFormat(mockReport);
  assert.ok(email.includes('件名: 【調査報告】'));
  assert.ok(email.includes('関係者各位'));
  assert.ok(email.includes('■ 1. 調査結論・エグゼクティブサマリー'));
  assert.ok(email.includes('■ 2. 主要ファクト・判明した重要ポイント'));
  assert.ok(email.includes('■ 3. 重要数値・比較指標'));
  assert.ok(email.includes('■ 4. 今後の推奨方針・ネクストアクション'));
});

test('speech: getAudioSummaryScript extracts clean executive speech script', async () => {
  const { getAudioSummaryScript } = await import('../public/js/modules/speech.js');

  const script = getAudioSummaryScript(mockReport);
  assert.ok(script.includes('企業における生成AI業務活用の最新動向とROI分析についてのリサーチ結果サマリーをお伝えします'));
  assert.ok(script.includes('結論として'));
  assert.ok(script.includes('重要なポイントは3点あります'));
  assert.ok(script.includes('1点目'));
  assert.ok(script.includes('今後の推奨方針として'));
  assert.ok(script.includes('以上、リサーチスタジオによる1分間要約でした'));
  // マークダウン記号が除去されていること
  assert.equal(script.includes('*'), false);
  assert.equal(script.includes('#'), false);
  assert.equal(script.includes('`'), false);
});

test('phase1 UI consistency: public/index.html includes required DOM elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  // テーマ推敲サジェスト
  assert.ok(html.includes('id="theme-polisher-wrap"'), 'theme-polisher-wrap exists');
  assert.ok(html.includes('id="theme-polisher-chips"'), 'theme-polisher-chips exists');

  // 音声サマリー
  assert.ok(html.includes('id="btn-audio-summary"'), 'btn-audio-summary exists');
  assert.ok(html.includes('id="audio-player-bar"'), 'audio-player-bar exists');
  assert.ok(html.includes('id="btn-audio-toggle"'), 'btn-audio-toggle exists');
  assert.ok(html.includes('id="btn-audio-stop"'), 'btn-audio-stop exists');

  // 社内共有エクスポートハブカード
  assert.ok(html.includes('id="eh-card-slack"'), 'eh-card-slack exists');
  assert.ok(html.includes('id="btn-eh-slack"'), 'btn-eh-slack exists');
  assert.ok(html.includes('id="eh-card-email"'), 'eh-card-email exists');
  assert.ok(html.includes('id="btn-eh-email"'), 'btn-eh-email exists');
});

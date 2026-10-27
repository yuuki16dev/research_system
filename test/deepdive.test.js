const test = require('node:test');
const assert = require('node:assert');
const { cleanSearchQuery } = require('../server/deepdive');

test('deepdive: cleanSearchQuery strips colloquial particles and conversational endings', () => {
  const q1 = cleanSearchQuery('具体的な課題と解決策について教えてください', '次世代電池技術');
  assert.ok(!q1.includes('について教えてください'), 'Colloquial ending stripped');
  assert.ok(q1.includes('課題') && q1.includes('解決策'), 'Preserved essential keywords');

  const q2 = cleanSearchQuery('市場規模と成長率はどうなっていますか？', '国内SaaS市場');
  assert.ok(!q2.includes('どうなっていますか'), 'Conversational question ending stripped');
  assert.ok(q2.includes('市場規模') && q2.includes('成長率'), 'Preserved core search terms');
});

test('deepdive: cleanSearchQuery resolves demonstrative pronouns with previous turn or theme', () => {
  const history = [
    { question: '全固体電池の安全性は？', answer: '全固体電池は電解液に固体を使用するため発火リスクが低いです。' }
  ];
  const q = cleanSearchQuery('それの導入コストはどのくらいですか？', 'EVバッテリー', '', history);
  assert.ok(q.includes('全固体電池') || q.includes('EVバッテリー'), 'Resolved pronoun with history or theme');
  assert.ok(!q.includes('どのくらいですか'), 'Conversational query cleaned');
});

test('deepdive: cleanSearchQuery leverages quote context when provided', () => {
  const quote = '2026年までに市場規模は3倍の1兆円に達すると予測されている。';
  const q = cleanSearchQuery('どの分野が最大の要因ですか？', 'フィンテック', quote);
  assert.ok(q.includes('フィンテック') || q.includes('2026年'), 'Quote or theme included in query');
  assert.ok(!q.includes('ですか'), 'Colloquial ending removed');
});

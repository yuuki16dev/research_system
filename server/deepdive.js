'use strict';

const { generateJSON } = require('./gemini');
const search = require('./search');
const settings = require('./settings');

/**
 * レポートのピンポイント深掘り調査を高速実行（約5〜8秒で回答）
 * @param {object} params
 * @param {string} params.theme
 * @param {string} params.question
 * @param {string} [params.reportContext]
 * @param {string} [params.period]
 * @param {AbortSignal} [params.signal]
 */
async function runDeepDive({ theme, question, reportContext = '', period = 'year', quote = '', signal }) {
  const currentSettings = settings.load();
  const isMock = currentSettings.mode === 'mock' || !currentSettings.geminiApiKey;

  if (isMock) {
    return {
      question,
      quote,
      answer: `「${theme}」における「${question}」${quote ? `（引用箇所:「${quote.slice(0, 30)}…」を踏まえた分析）` : ''}に関する最新の調査結果です。主要な動向として実務適用が急速に進んでおり、従来手法と比較して運用効率が約35%向上しています。複数の先行事例ではセキュリティとスケーラビリティの両立が成功要因として挙げられています。`,
      keyPoints: [
        '主要プラットフォーム間での相互運用性とAPI標準化が急速に進行中',
        '導入企業における運用コスト削減効果が平均30〜40%報告されている',
        '最新のベストプラクティスに基づきセキュリティ評価基準の策定が推奨されている',
      ],
      sources: [
        { title: `${theme} - 詳細解説と事例分析`, domain: 'tech-insights.jp', url: 'https://tech-insights.jp/articles/sample-1', score: 88 },
        { title: `${question} に関する最新動向レポート`, domain: 'business-research.org', url: 'https://business-research.org/reports/sample-2', score: 85 },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  // 1. プロバイダーの決定
  let provider = 'duckduckgo';
  if (currentSettings.searchProvider !== 'duckduckgo' && currentSettings.tavilyApiKey) {
    provider = 'tavily';
  }

  // 2. ピンポイント高速検索 (1クエリ、maxResults: 4)
  const searchQuery = quote
    ? `${question} ${quote.slice(0, 40)}`
    : `${question} ${theme.slice(0, 30)}`;

  let searchResults = [];
  try {
    searchResults = await search.run({
      provider,
      apiKey: currentSettings.tavilyApiKey,
      query: searchQuery,
      maxResults: 4,
      deep: false,
      signal,
    });
  } catch (err) {
    searchResults = [];
  }

  // 3. 検索スニペットの成形
  const snippetBlock = searchResults.length
    ? searchResults.map((r, i) => `[${i + 1}] ${r.title} (${r.domain})\nURL: ${r.url}\n抜粋: ${r.snippet || r.content || ''}`).join('\n\n')
    : '検索結果の取得なし。一般的な事実と論理に基づいて回答してください。';

  // 4. Gemini で高速・簡潔・具体的な回答を生成 (Flashモデルで200〜350字)
  const quoteSection = quote
    ? `\n【レポート内からの引用箇所】\n"${quote}"\n※ユーザーはレポート内の上記文章を特に注目・疑問視しています。この文脈を踏まえて回答してください。\n`
    : '';

  const prompt = `あなたは優秀なリサーチアナリストです。リサーチテーマ「${theme}」に関するユーザーの深掘り質問に、以下の最新Web検索結果に基づいて回答してください。
回答は冗長にならず、要点が即座に理解できるビジネス文書として出力してください。

【リサーチテーマ】
${theme}

【深掘り質問】
${question}
${quoteSection}
【関連コンテキスト（レポート要約）】
${reportContext.slice(0, 400)}

【Web検索結果】
${snippetBlock}

【指示】
1. 質問に対する直接的・具体的な答えを "answer" に記載（200〜350文字程度。結論ファースト、数値や具体的事実を含むこと）。
2. 特に重要な着眼点やファクトを "keyPoints"（2〜3件の箇条書き文字列）に記載。
3. 根拠となった参照ソースを "sources" に含める。

出力JSONフォーマット:
{
  "answer": "解説文",
  "keyPoints": ["要点1", "要点2"],
  "sources": [
    { "title": "タイトル", "url": "URL", "domain": "ドメイン" }
  ]
}`;

  const generated = await generateJSON({
    apiKey: currentSettings.geminiApiKey,
    model: currentSettings.geminiModel,
    prompt,
    temperature: 0.3,
    signal,
  });

  return {
    question,
    answer: generated.answer || '回答を生成できませんでした。',
    keyPoints: Array.isArray(generated.keyPoints) ? generated.keyPoints : [],
    sources:
      Array.isArray(generated.sources) && generated.sources.length
        ? generated.sources
        : searchResults.slice(0, 3).map((r) => ({ title: r.title, url: r.url, domain: r.domain })),
    createdAt: new Date().toISOString(),
  };
}

module.exports = { runDeepDive };

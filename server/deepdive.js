'use strict';

const { generateJSON } = require('./gemini');
const search = require('./search');
const settings = require('./settings');

const CONVERSATIONAL_PATTERNS = /(について教えてください|について教えて|教えてください|教えて|とは|どうなっていますか|どうなっていますでしょうか|どうでしょうか|どうですか|どうすればいいですか|どうすれば|でしょうか|ありますか|ですか|ますか)/g;

/**
 * 検索クエリの最適化（口語助詞や質問表現を除去し、文脈を補完した高精度クエリを生成）
 */
function cleanSearchQuery(question, theme, quote, chatHistory) {
  if (quote && quote.trim()) {
    const cleanQuote = quote.replace(/[\r\n\t]/g, ' ').slice(0, 35).trim();
    const cleanQ = question.replace(/[？\?。、！!「」『』]/g, ' ')
      .replace(CONVERSATIONAL_PATTERNS, ' ')
      .trim();
    return `${cleanQuote} ${cleanQ}`.replace(/\s+/g, ' ').slice(0, 60);
  }

  // 指示代名詞（それ、前述、あれ、どちら）が含まれる場合、直前の質問・回答から名詞を補完
  let contextSubject = '';
  const hasPronoun = /(それ|これ|あれ|前述|どちら|どっち|上記の|同方式)/.test(question);
  if (hasPronoun && Array.isArray(chatHistory) && chatHistory.length) {
    const lastTurn = chatHistory[chatHistory.length - 1];
    if (lastTurn && lastTurn.question) {
      contextSubject = lastTurn.question.replace(/[？\?。、！!]/g, ' ').slice(0, 25).trim();
    }
  }

  const cleanQ = question.replace(/[？\?。、！!「」『』]/g, ' ')
    .replace(CONVERSATIONAL_PATTERNS, ' ')
    .trim();

  const themeKeywords = (theme || '').replace(/[【】「」『』]/g, ' ').slice(0, 25).trim();

  const queryParts = [contextSubject, themeKeywords, cleanQ].filter(Boolean);
  return queryParts.join(' ').replace(/\s+/g, ' ').slice(0, 70);
}

/**
 * レポートのピンポイント深掘り調査を高精度実行
 * @param {object} params
 * @param {string} params.theme
 * @param {string} params.question
 * @param {string} [params.reportContext]
 * @param {string} [params.period]
 * @param {string} [params.quote]
 * @param {Array<{question: string, answer: string}>} [params.chatHistory]
 * @param {AbortSignal} [params.signal]
 */
async function runDeepDive({ theme, question, reportContext = '', period = 'year', quote = '', chatHistory = [], signal }) {
  const currentSettings = settings.load();
  const isMock = currentSettings.mode === 'mock' || !currentSettings.geminiApiKey;

  if (isMock) {
    const hasHistory = Array.isArray(chatHistory) && chatHistory.length > 0;
    const historyNote = hasHistory ? `（これまでの対話文脈を踏まえて回答）` : '';
    return {
      question,
      quote,
      answer: `「${theme}」における「${question}」${quote ? `（引用箇所:「${quote.slice(0, 30)}…」を踏まえた分析）` : ''}${historyNote}に関する詳細な調査結果です。結論として、実務適用とセキュリティガバナンスの両立が最重要課題であり、先行事例では初期PoCでの効果検証を経て段階的に全社展開することでROIが最大化されています。`,
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

  // 2. ピンポイント最適化検索 (1クエリ、maxResults: 4)
  const searchQuery = cleanSearchQuery(question, theme, quote, chatHistory);

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
    : '検索結果の取得なし。レポート内の構造化コンテキストおよび一般的な事実・論理に基づいて回答してください。';

  // 4. 会話履歴ブロックの構築
  const historyBlock = Array.isArray(chatHistory) && chatHistory.length
    ? `\n【これまでの対話の流れ（直近の文脈）】\n` +
      chatHistory.slice(-4).map((h, idx) => `Q${idx + 1}: ${h.question}\nA${idx + 1}: ${h.answer}`).join('\n\n') +
      `\n※上記の対話の流れを踏まえ、「それ」「前述の」などの指示代名詞がある場合は適切に文脈を解決して回答してください。\n`
    : '';

  // 5. 引用セクション
  const quoteSection = quote
    ? `\n【レポート内からの引用箇所】\n"${quote}"\n※ユーザーはレポート内の上記文章を特に注目・疑問視しています。この文脈を最優先で踏まえて回答してください。\n`
    : '';

  const safeContext = typeof reportContext === 'string'
    ? reportContext
    : (reportContext ? JSON.stringify(reportContext) : '');

  const prompt = `あなたは経営陣やプロジェクト推進リーダーに伴走する、極めて優秀なリサーチアナリストです。
リサーチテーマ「${theme}」について、ユーザーからの深掘り質問に対し、レポート内容および最新Web検索結果を統合して的確に回答してください。

【厳格な回答ルール】
1. **会話の的を絶対に外さないこと**: ユーザーが知りたい「核心」に結論ファーストで直接答えてください。質問と関係のない一般論や前置きは排除してください。
2. **対話文脈の継承**: これまでの対話の流れがある場合は、前の質問や回答を踏まえた自然なキャッチボールを行ってください。
3. **レポート記載内容との整合性**: レポート内の指標・比較表・推奨事項に関する質問である場合は、レポート内の記述を最優先の根拠として回答してください。
4. **具体性と簡潔性**: 200〜350文字程度で、具体的な数値・固有名詞・理由を含めて回答してください。

【リサーチテーマ】
${theme}
${historyBlock}
【今回の深掘り質問】
${question}
${quoteSection}
【レポートの構造化コンテキスト（前提情報）】
${safeContext.slice(0, 1600)}

【参考Web検索結果】
${snippetBlock}

【指示】
1. 質問に対する直接的・具体的な答えを "answer" に記載（200〜350文字程度。結論ファースト）。
2. 特に重要な着眼点やファクトを "keyPoints"（2〜3件の箇条書き文字列）に記載。
3. 根拠となった参照ソースを "sources" に含める。

出力JSONフォーマット:
{
  "answer": "結論と解説文",
  "keyPoints": ["要点1", "要点2"],
  "sources": [
    { "title": "タイトル", "url": "URL", "domain": "ドメイン" }
  ]
}`;

  const generated = await generateJSON({
    apiKey: currentSettings.geminiApiKey,
    model: currentSettings.geminiModel,
    prompt,
    temperature: 0.25,
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

module.exports = { runDeepDive, cleanSearchQuery };

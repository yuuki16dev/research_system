'use strict';

const { repairJSON } = require('./gemini');

const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

/**
 * Groq Cloud REST API クライアント（依存なし / Node 18+ の組み込み fetch を使用）
 * OpenAI互換のチャット補完エンドポイントを呼び出し、爆速LPU推論を実行
 */
async function generateGroq({
  apiKey,
  model = GROQ_DEFAULT_MODEL,
  prompt,
  systemPrompt = 'あなたは高度なリサーチレポート作成AIです。構文的に正しい完全なJSONオブジェクトのみを出力してください。',
  signal,
  temperature = 0.3,
  json = true,
  timeoutMs = 60000,
}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Groq APIキーが設定されていません');

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const targetModel = GROQ_MODELS.includes(model) ? model : GROQ_DEFAULT_MODEL;

  const body = {
    model: targetModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: 8192,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: combinedSignal,
  });

  if (!res.ok) {
    let msg = '';
    try {
      const j = await res.json();
      msg = j && j.error && j.error.message;
    } catch {
      /* ignore */
    }
    const err = new Error(`Groq API エラー (${res.status})${msg ? ': ' + msg : ''}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('Groqからの応答が空でした');

  if (json) {
    return repairJSON(content);
  }
  return content;
}

module.exports = {
  generateGroq,
  GROQ_DEFAULT_MODEL,
  GROQ_MODELS,
};


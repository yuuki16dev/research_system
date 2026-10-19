'use strict';

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('キャンセルされました'));
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('キャンセルされました'));
      }, { once: true });
    }
  });
}

function isRetryableError(err, status) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = String((err && err.message) || '').toLowerCase();
  const code = String((err && err.code) || (err && err.cause && err.cause.code) || '').toUpperCase();
  if (
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    msg.includes('fetch failed') ||
    msg.includes('connect timeout') ||
    msg.includes('timeout') ||
    msg.includes('network')
  ) {
    return true;
  }
  return false;
}

function humanizeError(err) {
  const code = String((err && err.code) || (err && err.cause && err.cause.code) || '').toUpperCase();
  const msg = String((err && err.message) || '');
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || msg.includes('Connect Timeout Error') || msg.includes('fetch failed')) {
    return 'Google Gemini APIへの接続がタイムアウトしました。通信環境が不安定か、回線の一時的な遅延の可能性があります。再度お試しください。';
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Gemini APIの利用制限（レートリミット: 429）に達しました。1分ほど待ってから再実行してください。';
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('403')) {
    return 'Gemini APIキーが無効または認証に失敗しました。ヘッダーの「API設定」でキーを確認してください。';
  }
  return msg;
}

/**
 * Google Gemini REST API クライアント（依存なし / Node 18+ の fetch を使用）
 * 堅牢なJSON修復エンジン（欠落カンマ・未エスケープ改行・末尾カンマ・途切れを自動補正）
 */

function repairJSON(text) {
  let s = String(text || '').trim();

  // マークダウンコードフェンスの除去
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  // 最外周のオブジェクトまたは配列の範囲を切り出し
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  let start = -1;
  let isArray = false;
  if (firstBrace >= 0 && firstBracket >= 0) {
    if (firstBrace < firstBracket) {
      start = firstBrace;
    } else {
      start = firstBracket;
      isArray = true;
    }
  } else if (firstBrace >= 0) {
    start = firstBrace;
  } else if (firstBracket >= 0) {
    start = firstBracket;
    isArray = true;
  }

  if (start >= 0) {
    const lastChar = isArray ? ']' : '}';
    const end = s.lastIndexOf(lastChar);
    if (end > start) {
      s = s.slice(start, end + 1);
    } else {
      s = s.slice(start);
    }
  }

  // 1. 最初はそのまま標準JSON.parseを試みる
  try {
    return JSON.parse(s);
  } catch (_) {
    // 修復ステップへ
  }

  // 2. 文字列内の未エスケープ制御文字（生改行・生タブ）をエスケープに正規化
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === '\\') {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === '\n') {
        out += '\\n';
        continue;
      }
      if (c === '\r') {
        continue;
      }
      if (c === '\t') {
        out += '\\t';
        continue;
      }
    }
    out += c;
  }
  s = out;

  try {
    return JSON.parse(s);
  } catch (_) {}

  // 3. コメント行の除去
  s = s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // 4. プロパティ間・配列要素間の欠落カンマを自動挿入
  s = s.replace(/("|\d+|true|false|null|\]|\})\s*\n\s*(")/g, '$1,\n$2');
  s = s.replace(/(\]|\})\s*\n\s*([{\[])/g, '$1,\n$2');

  // 5. 末尾カンマ（trailing commas）を除去
  s = s.replace(/,\s*([\}\]])/g, '$1');

  try {
    return JSON.parse(s);
  } catch (_) {}

  // 6. 出力途中切れ（途中でトークン制限等により閉じていない括弧）の自動補完
  let balance = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (c === '{') balance.push('}');
      else if (c === '[') balance.push(']');
      else if (c === '}' || c === ']') {
        if (balance.length && balance[balance.length - 1] === c) balance.pop();
      }
    }
  }

  let closed = s;
  if (inStr) closed += '"';
  closed = closed.replace(/,\s*$/, '');
  while (balance.length) {
    closed += balance.pop();
  }

  try {
    return JSON.parse(closed);
  } catch (_) {}

  // 7. 最終フォールバック: 正規表現による個別フィールドのサルベージ
  return fallbackExtract(s);
}

function extractBalancedBlock(text, key, openChar, closeChar) {
  const re = new RegExp(`"${key}"\\s*:\\s*\\${openChar}`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  const startIdx = m.index + m[0].length - 1;

  let inStr = false;
  let esc = false;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (!inStr) {
      if (c === openChar) depth++;
      else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  return text.slice(startIdx);
}

function fallbackExtract(text) {
  const result = {
    title: '',
    subtitle: '',
    summary: '',
    keyPoints: [],
    metrics: [],
    table: { caption: '', columns: [], rows: [] },
    sections: [],
    insights: [],
    sourceAssessments: [],
  };

  const strMatch = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'i');
    const m = re.exec(text);
    if (!m) return '';
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  };

  result.title = strMatch('title');
  result.subtitle = strMatch('subtitle');
  result.summary = strMatch('summary');

  // keyPoints: balanced array or loose strings
  const kpBlock = extractBalancedBlock(text, 'keyPoints', '[', ']');
  if (kpBlock) {
    try {
      const parsed = JSON.parse(kpBlock);
      if (Array.isArray(parsed)) result.keyPoints = parsed.map(String).filter(Boolean);
    } catch (_) {
      const items = [...kpBlock.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
      result.keyPoints = items
        .map((m) => {
          try {
            return JSON.parse(`"${m[1]}"`);
          } catch {
            return m[1];
          }
        })
        .filter(Boolean);
    }
  }

  // metrics: balanced array
  const metBlock = extractBalancedBlock(text, 'metrics', '[', ']');
  if (metBlock) {
    try {
      const parsed = JSON.parse(metBlock);
      if (Array.isArray(parsed)) {
        result.metrics = parsed
          .map((m) => ({
            label: String((m && m.label) || ''),
            value: String((m && m.value) || ''),
            note: String((m && m.note) || ''),
          }))
          .filter((m) => m.label || m.value);
      }
    } catch (_) {
      const mItems = [...metBlock.matchAll(/\{([^{}]*)\}/g)];
      result.metrics = mItems
        .map((m) => {
          const b = m[1];
          const l = /"label"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          const v = /"value"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          const n = /"note"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          return { label: l ? l[1] : '', value: v ? v[1] : '', note: n ? n[1] : '' };
        })
        .filter((x) => x.label || x.value);
    }
  }

  // table: balanced object
  const tblBlock = extractBalancedBlock(text, 'table', '{', '}');
  if (tblBlock) {
    try {
      const parsed = JSON.parse(tblBlock);
      if (parsed && typeof parsed === 'object') {
        result.table = {
          caption: String(parsed.caption || ''),
          columns: Array.isArray(parsed.columns) ? parsed.columns.map(String) : [],
          rows: Array.isArray(parsed.rows) ? parsed.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) : [],
        };
      }
    } catch (_) {
      const cap = /"caption"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(tblBlock);
      const cols = /"columns"\s*:\s*\[([\s\S]*?)\]/i.exec(tblBlock);
      const columns = cols ? [...cols[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]) : [];
      const rows = [];
      const rowsMatch = /"rows"\s*:\s*\[([\s\S]*?)\]/i.exec(tblBlock);
      if (rowsMatch) {
        const rowArrays = [...rowsMatch[1].matchAll(/\[([\s\S]*?)\]/g)];
        for (const ra of rowArrays) {
          const cells = [...ra[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]);
          if (cells.length) rows.push(cells);
        }
      }
      result.table = { caption: cap ? cap[1] : '', columns, rows };
    }
  }

  // sections: balanced array with inner objects and bullets
  const secBlock = extractBalancedBlock(text, 'sections', '[', ']');
  if (secBlock) {
    try {
      const parsed = JSON.parse(secBlock);
      if (Array.isArray(parsed)) {
        result.sections = parsed
          .map((s) => ({
            heading: String((s && s.heading) || ''),
            body: String((s && s.body) || ''),
            bullets: Array.isArray(s && s.bullets) ? s.bullets.map(String).filter(Boolean) : [],
          }))
          .filter((s) => s.heading || s.body);
      }
    } catch (_) {
      let inS = false;
      let e = false;
      let d = 0;
      let oStart = -1;
      const sObjs = [];
      for (let i = 0; i < secBlock.length; i++) {
        const c = secBlock[i];
        if (e) {
          e = false;
          continue;
        }
        if (c === '\\') {
          e = true;
          continue;
        }
        if (c === '"') {
          inS = !inS;
          continue;
        }
        if (!inS) {
          if (c === '{') {
            if (d === 0) oStart = i;
            d++;
          } else if (c === '}') {
            d--;
            if (d === 0 && oStart >= 0) {
              sObjs.push(secBlock.slice(oStart, i + 1));
              oStart = -1;
            }
          }
        }
      }
      result.sections = sObjs
        .map((b) => {
          const h = /"heading"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          const bd = /"body"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          const blts = /"bullets"\s*:\s*\[([\s\S]*?)\]/i.exec(b);
          const bullets = blts ? [...blts[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]) : [];
          return {
            heading: h ? h[1] : '',
            body: bd ? bd[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '',
            bullets,
          };
        })
        .filter((s) => s.heading || s.body);
    }
  }

  // insights: balanced array
  const insBlock = extractBalancedBlock(text, 'insights', '[', ']');
  if (insBlock) {
    try {
      const parsed = JSON.parse(insBlock);
      if (Array.isArray(parsed)) {
        result.insights = parsed
          .map((x) => ({
            title: String((x && x.title) || ''),
            body: String((x && x.body) || ''),
            priority: ['高', '中', '低'].includes(x && x.priority) ? x.priority : '中',
          }))
          .filter((x) => x.title || x.body);
      }
    } catch (_) {
      const iItems = [...insBlock.matchAll(/\{([\s\S]*?)\}/g)];
      result.insights = iItems
        .map((m) => {
          const b = m[1];
          const t = /"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          const bd = /"body"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(b);
          const p = /"priority"\s*:\s*"([^"]+)"/i.exec(b);
          return {
            title: t ? t[1] : '',
            body: bd ? bd[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '',
            priority: p ? p[1] : '中',
          };
        })
        .filter((x) => x.title);
    }
  }

  // sourceAssessments: balanced array
  const saBlock = extractBalancedBlock(text, 'sourceAssessments', '[', ']');
  if (saBlock) {
    try {
      const parsed = JSON.parse(saBlock);
      if (Array.isArray(parsed)) {
        result.sourceAssessments = parsed.map((a) => ({
          index: parseInt(a && a.index, 10) || 1,
          score: parseInt(a && a.score, 10) || 70,
          note: String((a && a.note) || ''),
        }));
      }
    } catch (_) {
      const aItems = [...saBlock.matchAll(/\{([\s\S]*?)\}/g)];
      result.sourceAssessments = aItems.map((m) => {
        const b = m[1];
        const idx = /"index"\s*:\s*(\d+)/i.exec(b);
        const sc = /"score"\s*:\s*(\d+)/i.exec(b);
        const nt = /"note"\s*:\s*"([^"]+)"/i.exec(b);
        return { index: idx ? parseInt(idx[1], 10) : 1, score: sc ? parseInt(sc[1], 10) : 70, note: nt ? nt[1] : '' };
      });
    }
  }

  // summaryが空の場合の救済
  if (!result.summary) {
    const anySummary = /"summary"\s*:\s*"([^"]+)/i.exec(text);
    if (anySummary) result.summary = anySummary[1];
  }

  return result;
}

async function generate({
  apiKey,
  model,
  prompt,
  signal,
  temperature = 0.4,
  json = true,
  maxRetries = 3,
  timeoutMs = 180000,
  onRetry = null,
}) {
  if (!apiKey) throw new Error('Gemini APIキーが設定されていません');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 8192,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal && signal.aborted) throw new Error('キャンセルされました');

    try {
      // 1回あたりのタイムアウト（デフォルト180秒 = 3分）
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
        const status = res.status;
        const err = new Error(`Gemini API エラー (${status})${msg ? ': ' + msg.slice(0, 200) : ''}`);
        err.status = status;

        if (attempt < maxRetries && isRetryableError(err, status)) {
          lastError = err;
          const waitMs = attempt === 1 ? 1500 : 3500;
          if (typeof onRetry === 'function') {
            try {
              onRetry({ attempt, maxRetries, waitMs, error: err });
            } catch (_) {}
          }
          await delay(waitMs, signal);
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const meta = data.usageMetadata;
      if (meta) {
        try {
          const { recordGemini } = require('./usage');
          recordGemini({
            model,
            promptTokens: meta.promptTokenCount || 0,
            candidatesTokens: meta.candidatesTokenCount || 0,
            totalTokens: meta.totalTokenCount || 0,
          });
        } catch {
          /* ignore */
        }
      }

      const cand = data.candidates && data.candidates[0];
      const text =
        cand && cand.content && Array.isArray(cand.content.parts)
          ? cand.content.parts.map((p) => p.text || '').join('')
          : '';
      if (!text) {
        const reason =
          (cand && cand.finishReason) ||
          (data.promptFeedback && data.promptFeedback.blockReason) ||
          'unknown';
        throw new Error(`Gemini から空の応答が返されました（理由: ${reason}）`);
      }

      if (!json) return text;
      try {
        return repairJSON(text);
      } catch (err) {
        err.rawText = text;
        throw err;
      }
    } catch (err) {
      if (signal && signal.aborted) throw new Error('キャンセルされました');
      lastError = err;

      if (attempt < maxRetries && isRetryableError(err, err.status)) {
        const waitMs = attempt === 1 ? 1500 : 3500;
        if (typeof onRetry === 'function') {
          try {
            onRetry({ attempt, maxRetries, waitMs, error: err });
          } catch (_) {}
        }
        await delay(waitMs, signal);
        continue;
      }

      const friendlyMsg = humanizeError(err);
      const wrappedErr = new Error(friendlyMsg);
      wrappedErr.cause = err;
      throw wrappedErr;
    }
  }

  const finalMsg = humanizeError(lastError);
  const finalErr = new Error(finalMsg);
  finalErr.cause = lastError;
  throw finalErr;
}

function generateJSON(opts) {
  return generate({ ...opts, json: true });
}

module.exports = { generate, generateJSON, repairJSON, fallbackExtract };

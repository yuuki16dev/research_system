'use strict';

const env = require('./env');
const cache = require('./cache');
const { domainOf, combineSignals } = require('./util');
const { safeFetch } = require('./security');
const { assertPublicUrl } = require('./url-guard');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/* ---------------------------------------------------------------- helpers */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripTags(s = '') {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function withTimeout(signal, ms) {
  return combineSignals([signal, AbortSignal.timeout(ms)]);
}

/* ---------------------------------------------------------------- Tavily */

async function tavilySearch({ apiKey, query, maxResults = 5, includeDomains, deep, timeRange, startDate, endDate, signal }) {
  const cacheKey = cache.buildTavilyCacheKey({ query, maxResults, includeDomains, deep, timeRange, startDate, endDate });
  const cached = cache.sharedCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const body = {
    query,
    max_results: maxResults,
    search_depth: deep ? 'advanced' : 'basic',
    include_raw_content: !!deep,
  };
  if (timeRange) body.time_range = timeRange;
  if (startDate) body.start_date = startDate;
  if (endDate) body.end_date = endDate;
  if (includeDomains && includeDomains.length) body.include_domains = includeDomains;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: withTimeout(signal, 30000),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.detail && (j.detail.error || j.detail)) || j.error || '';
    } catch {
      /* ignore */
    }
    throw new Error(`Tavily API エラー (${res.status})${detail ? ': ' + String(detail).slice(0, 160) : ''}`);
  }
  const data = await res.json();
  try {
    const { recordSearch } = require('./usage');
    recordSearch({ provider: 'tavily', count: 1 });
  } catch {
    /* ignore */
  }
  const results = (data.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    snippet: r.content || '',
    rawContent: typeof r.raw_content === 'string' ? r.raw_content : '',
    publishedDate: r.published_date || '',
  }));
  cache.sharedCache.set(cacheKey, results);
  return results;
}

/* ------------------------------------------------------------ DuckDuckGo */

function unwrapDdgUrl(href) {
  let h = decodeEntities(href);
  if (h.startsWith('//')) h = 'https:' + h;
  try {
    const u = new URL(h, 'https://duckduckgo.com');
    const target = u.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : u.href;
  } catch {
    return '';
  }
}

async function ddgSearch({ query, maxResults = 5, df, signal }) {
  // C-1: クラウド環境では DuckDuckGo の経路を通さない
  if (env.IS_CLOUD) {
    throw new Error('クラウド環境では DuckDuckGo 検索は許可されていません（Tavily をご利用ください）');
  }

  const params = new URLSearchParams({ q: query, kl: 'jp-jp' });
  if (df) params.append('df', df);

  // 1. まずブロックされにくい GET リクエストを試行
  let html = '';
  try {
    const getUrl = `https://html.duckduckgo.com/html/?${params.toString()}`;
    const res = await fetch(getUrl, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: withTimeout(signal, 15000),
    });
    if (res.ok) {
      html = await res.text();
    }
  } catch (err) {
    if (signal && signal.aborted) throw err;
  }

  // 2. GET で結果が取れない・ブロックされた場合は POST を試行
  if (!html || /anomaly|captcha|challenge/i.test(html)) {
    try {
      const res = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
        },
        body: params,
        signal: withTimeout(signal, 15000),
      });
      if (res.ok) {
        html = await res.text();
      }
    } catch (err) {
      if (signal && signal.aborted) throw err;
    }
  }

  // 3. パース処理 (属性順 href / class 非依存)
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(anchorRe)].filter((m) => /class=["'][^"']*result__a\b/i.test(m[1]));
  const results = [];
  for (let i = 0; i < matches.length && results.length < maxResults; i++) {
    const m = matches[i];
    const hrefMatch = /href=["']([^"']+)["']/i.exec(m[1]);
    if (!hrefMatch) continue;
    const url = unwrapDdgUrl(hrefMatch[1]);
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const segEnd = i + 1 < matches.length ? matches[i + 1].index : m.index + 4000;
    const seg = html.slice(m.index, segEnd);
    const sn = seg.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    results.push({ title: stripTags(m[2]) || url, url, snippet: sn ? stripTags(sn[1]) : '', rawContent: '' });
  }

  if (!results.length && /anomaly|captcha|challenge/i.test(html)) {
    throw new Error('DuckDuckGo が一時的にアクセスを制限しています（Tavily APIキーの設定を推奨）');
  }

  try {
    const { recordSearch } = require('./usage');
    recordSearch({ provider: 'duckduckgo', count: 1 });
  } catch {
    /* ignore */
  }
  return results;
}

/* ---------------------------------------------------------------- facade */

/**
 * @param {object} o
 * @param {'tavily'|'duckduckgo'} o.provider
 * @param {string} [o.site]        特定サイトに限定
 * @param {string[]} [o.sns]       SNSドメインに限定
 * @param {string} [o.timeRange]   'year'|'month'|'week'|'day'
 * @param {string} [o.startDate]   'YYYY-MM-DD'
 * @param {string} [o.endDate]     'YYYY-MM-DD'
 * @param {string} [o.df]          DuckDuckGo用日付フィルタ ('y'|'m'|'w'|'d'|'YYYY-MM-DD..YYYY-MM-DD')
 */
async function run({ provider, apiKey, query, site, sns, maxResults, deep, timeRange, startDate, endDate, df, signal }) {
  // C-1: クラウド環境では検索は Tavily だけを使う
  const effectiveProvider = env.IS_CLOUD ? 'tavily' : provider;
  let results;
  if (effectiveProvider === 'tavily') {
    const includeDomains = site ? [site] : sns || undefined;
    results = await tavilySearch({ apiKey, query, maxResults, includeDomains, deep, timeRange, startDate, endDate, signal });
  } else {
    let q = query;
    if (site) q = `site:${site} ${query}`;
    else if (sns) q = `${query} (${sns.slice(0, 3).map((d) => `site:${d}`).join(' OR ')})`;
    results = await ddgSearch({ query: q, maxResults, df, signal });
  }
  return results.map((r) => ({ ...r, domain: domainOf(r.url) }));
}

/* ------------------------------------------------------------ page fetch */

function extractText(html) {
  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(header|footer|nav|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(div|section)[^>]*(cookie|modal|banner|advertisement|share|social|sidebar)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // 主要な本文コンテナ（article / main / entry-content / post-content）を優先抽出
  const main = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (main && main[2].length > 800) {
    body = main[2];
  }

  // 表やリストの構造を保持して整形
  body = body
    .replace(/<\/(th|td)>/gi, ' | ')
    .replace(/<\/(tr)>/gi, '\n')
    .replace(/<\/(li)>/gi, '\n・')
    .replace(/<\/(p|div|h[1-6]|br|section)>/gi, '\n');

  const text = stripTags(body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')).trim();
  return { title: titleM ? stripTags(titleM[1]) : '', text };
}

async function fetchPage(url, { signal, maxChars = 6000, timeoutMs = 7000, ...rest } = {}) {
  // B-6: 取得前に assertPublicUrl で厳格にSSRF判定 (テスト時バイパス指定時を除く)
  if (!(process.env.NODE_ENV === 'test' && rest._dangerouslyBypassFirstHopForTest)) {
    await assertPublicUrl(url);
  }
  const cacheKey = cache.buildPageCacheKey(url);
  const cached = cache.sharedCache.get(cacheKey);
  if (cached) {
    return { title: cached.title, text: cached.text.slice(0, maxChars) };
  }

  const { text: rawHtml } = await safeFetch(url, { signal, timeoutMs, maxBytes: 2_000_000, ...rest });
  const { title, text } = extractText(rawHtml);
  cache.sharedCache.set(cacheKey, { title, text });
  return { title, text: text.slice(0, maxChars) };
}

module.exports = {
  run,
  fetchPage,
  extractText,
  tavilySearch,
  ddgSearch,
  unwrapDdgUrl,
  stripTags,
  decodeEntities,
};

'use strict';

/**
 * robots.txt 取得・解析・24時間ホスト単位キャッシュモジュール (D-2)
 * - RFC 9309 準拠の User-agent / Allow / Disallow / ワイルドカード(*) / 末尾一致($) 判定
 * - robots.txt の取得自体も B-6 (safeFetch + assertPublicUrl) の検証を通過させる
 * - 解析結果はホスト（origin）ごとに24時間キャッシュする
 */

const { MemoryLruCache } = require('./cache');
const { safeFetch, CRAWLER_BOT_TOKENS } = require('./security');

const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const ROBOTS_MAX_BYTES = 512 * 1024; // RFC 9309 推奨上限 500KiB

const robotsCache = new MemoryLruCache({
  ttlMs: ROBOTS_CACHE_TTL_MS,
  maxBytes: 10 * 1024 * 1024,
  maxEntries: 2000,
});

/**
 * robots.txt のパスルールパターン（* と末尾 $ 対応）を正規表現へ変換する
 * @param {string} pattern
 * @returns {RegExp}
 */
function compileRobotsPattern(pattern) {
  let raw = String(pattern || '');
  const hasEndAnchor = raw.endsWith('$');
  if (hasEndAnchor) {
    raw = raw.slice(0, -1);
  }
  const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${hasEndAnchor ? '$' : ''}`);
}

/**
 * robots.txt 本文をグループ単位の構造体へパースする
 * @param {string} text
 * @returns {{ groups: Array<{ agents: string[], rules: Array<{ type: 'allow'|'disallow', pattern: string }> }> }}
 */
function parseRobotsTxt(text) {
  const groups = [];
  let currentGroup = null;
  let seenDirectiveInGroup = false;

  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const rawLine of lines) {
    const noComment = rawLine.replace(/#.*$/, '').trim();
    if (!noComment) continue;

    const colonIdx = noComment.indexOf(':');
    if (colonIdx <= 0) continue;

    const field = noComment.slice(0, colonIdx).trim().toLowerCase();
    const value = noComment.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      if (!value) continue;
      if (!currentGroup || seenDirectiveInGroup) {
        currentGroup = { agents: [], rules: [] };
        groups.push(currentGroup);
        seenDirectiveInGroup = false;
      }
      currentGroup.agents.push(value.toLowerCase());
    } else if ((field === 'disallow' || field === 'allow') && currentGroup) {
      seenDirectiveInGroup = true;
      // 空の Disallow は「すべて許可」を意味するためルールとして積まない
      if (field === 'disallow' && value === '') continue;
      if (!value) continue;
      currentGroup.rules.push({ type: field, pattern: value });
    }
  }

  return { groups };
}

/**
 * 対象 User-Agent トークン群に適用すべきルール一覧を選択する (RFC 9309 §2.2.1)
 * 具体的なボット名一致があればそれを優先し、なければ '*' にフォールバックする
 * @param {{ groups: Array<{ agents: string[], rules: Array<{ type: string, pattern: string }> }> }} parsed
 * @param {string[]} [botTokens=CRAWLER_BOT_TOKENS]
 * @returns {Array<{ type: 'allow'|'disallow', pattern: string }>}
 */
function selectRulesForBot(parsed, botTokens = CRAWLER_BOT_TOKENS) {
  const groups = (parsed && parsed.groups) || [];
  const lowerTokens = (botTokens || []).map((t) => String(t).toLowerCase()).filter(Boolean);

  const specificRules = [];
  const wildcardRules = [];

  for (const g of groups) {
    const agents = g.agents || [];
    const matchesSpecific = agents.some((agent) => {
      if (agent === '*') return false;
      return lowerTokens.some((tok) => tok === agent || tok.startsWith(agent) || agent.startsWith(tok));
    });
    if (matchesSpecific) {
      specificRules.push(...(g.rules || []));
    } else if (agents.includes('*')) {
      wildcardRules.push(...(g.rules || []));
    }
  }

  return specificRules.length > 0 ? specificRules : wildcardRules;
}

/**
 * パース済み robots.txt ルールに基づき、指定パス（クエリ含む）の取得可否を判定する
 * RFC 9309 §2.2.2: 最長一致ルールを採用し、同じ長さの場合は Allow を優先
 * @param {{ allowAll?: boolean, disallowAll?: boolean, groups?: Array }} parsed
 * @param {string} pathWithQuery
 * @param {string[]} [botTokens=CRAWLER_BOT_TOKENS]
 * @returns {boolean}
 */
function isPathAllowedByRules(parsed, pathWithQuery, botTokens = CRAWLER_BOT_TOKENS) {
  if (!parsed || parsed.allowAll) return true;
  if (parsed.disallowAll) return false;

  const target = String(pathWithQuery || '/').startsWith('/') ? String(pathWithQuery || '/') : `/${pathWithQuery}`;
  const rules = selectRulesForBot(parsed, botTokens);
  if (rules.length === 0) return true;

  let bestRule = null;
  let bestLen = -1;

  for (const rule of rules) {
    const re = compileRobotsPattern(rule.pattern);
    if (!re.test(target)) continue;
    const matchLen = rule.pattern.length;
    if (matchLen > bestLen || (matchLen === bestLen && rule.type === 'allow' && bestRule && bestRule.type !== 'allow')) {
      bestLen = matchLen;
      bestRule = rule;
    }
  }

  if (!bestRule) return true;
  return bestRule.type === 'allow';
}

function isSsrfRejectionError(err) {
  const msg = String((err && err.message) || err || '');
  return /禁止|不許可|無効|アクセスを拒否|制限された/.test(msg);
}

/**
 * 指定 URL のオリジンから robots.txt を取得・解析（24時間キャッシュ付き）
 * @param {string} rawUrl
 * @param {{ signal?: AbortSignal, timeoutMs?: number, _dangerouslyBypassFirstHopForTest?: boolean }} [options]
 * @returns {Promise<{ allowAll?: boolean, disallowAll?: boolean, groups?: Array }>}
 */
async function getRobotsPolicyForUrl(rawUrl, options = {}) {
  const parsedUrl = new URL(rawUrl);
  const originKey = `${parsedUrl.protocol}//${parsedUrl.host.toLowerCase()}`;
  const cached = robotsCache.get(originKey);
  if (cached) {
    return cached;
  }

  const robotsUrl = `${parsedUrl.origin}/robots.txt`;
  const timeoutMs = Math.min(Number(options.timeoutMs) || 4000, 5000);

  try {
    const { text } = await safeFetch(robotsUrl, {
      signal: options.signal,
      timeoutMs,
      maxBytes: ROBOTS_MAX_BYTES,
      headers: { Accept: 'text/plain,text/*;q=0.8,*/*;q=0.5' },
      _dangerouslyBypassFirstHopForTest: options._dangerouslyBypassFirstHopForTest,
    });
    const policy = parseRobotsTxt(text);
    robotsCache.set(originKey, policy, ROBOTS_CACHE_TTL_MS);
    return policy;
  } catch (err) {
    if (options.signal && options.signal.aborted) {
      throw err;
    }
    // B-6 の SSRF 検証拒否は絶対に握りつぶさず再送出する
    if (isSsrfRejectionError(err)) {
      throw err;
    }

    const msg = String((err && err.message) || '');
    const httpMatch = msg.match(/HTTP\s+(\d{3})/);
    const status = httpMatch ? Number(httpMatch[1]) : 0;

    // 4xx（404 Not Found 等）: RFC 9309 準拠で「制限なし」として24時間キャッシュ
    if (status >= 400 && status < 500) {
      const policy = { allowAll: true };
      robotsCache.set(originKey, policy, ROBOTS_CACHE_TTL_MS);
      return policy;
    }

    // 5xx（一時障害）: RFC 9309 準拠で一時的に取得見送り（長期キャッシュはしない）
    if (status >= 500 && status < 600) {
      return { disallowAll: true };
    }

    // 非対応 Content-Type 等は robots.txt 不在扱い
    if (msg.includes('非対応のコンテンツタイプ')) {
      const policy = { allowAll: true };
      robotsCache.set(originKey, policy, ROBOTS_CACHE_TTL_MS);
      return policy;
    }

    // タイムアウト・一時接続エラー等はそのまま取得見送り（抜粋フォールバックへ）
    return { disallowAll: true };
  }
}

/**
 * 指定 URL が対象サイトの robots.txt で許可されているか確認する
 * @param {string} rawUrl
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
async function isUrlAllowedByRobots(rawUrl, options = {}) {
  const parsedUrl = new URL(rawUrl);
  const policy = await getRobotsPolicyForUrl(rawUrl, options);
  const pathWithQuery = `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`;
  return isPathAllowedByRules(policy, pathWithQuery, options.botTokens);
}

/**
 * robots.txt により拒否されている場合に例外を送出する
 * @param {string} rawUrl
 * @param {object} [options]
 */
async function assertAllowedByRobots(rawUrl, options = {}) {
  const allowed = await isUrlAllowedByRobots(rawUrl, options);
  if (!allowed) {
    throw new Error(`robots.txt により取得が拒否されているためスキップしました: ${rawUrl}`);
  }
}

function clearRobotsCache() {
  robotsCache.clear();
}

module.exports = {
  ROBOTS_CACHE_TTL_MS,
  parseRobotsTxt,
  selectRulesForBot,
  isPathAllowedByRules,
  getRobotsPolicyForUrl,
  isUrlAllowedByRobots,
  assertAllowedByRobots,
  clearRobotsCache,
  robotsCache,
};

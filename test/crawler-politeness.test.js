'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const search = require('../server/search');
const cache = require('../server/cache');
const { getCrawlerUserAgent } = require('../server/security');
const blockedDomains = require('../server/blocked-domains');
const robots = require('../server/robots');

test('D-2 User-Agent: identifies Research Studio bot with contact URL and honors CRAWLER_CONTACT_URL', () => {
  const prev = process.env.CRAWLER_CONTACT_URL;
  try {
    delete process.env.CRAWLER_CONTACT_URL;
    const defaultUa = getCrawlerUserAgent();
    assert.ok(defaultUa.includes('ResearchStudio-Bot'), 'User-Agent must include service bot name');
    assert.ok(!defaultUa.includes('Mozilla/5.0'), 'User-Agent must not spoof a browser');
    assert.ok(defaultUa.includes('https://'), 'User-Agent must include contact URL');

    process.env.CRAWLER_CONTACT_URL = 'https://research.example.jp/bot-info';
    const customUa = getCrawlerUserAgent();
    assert.ok(
      customUa.includes('+https://research.example.jp/bot-info'),
      'User-Agent must reflect CRAWLER_CONTACT_URL env var'
    );

    const searchSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'search.js'), 'utf8');
    assert.ok(!searchSrc.includes('Mozilla/5.0'), 'server/search.js must not keep browser-spoofing User-Agent');
  } finally {
    if (prev === undefined) delete process.env.CRAWLER_CONTACT_URL;
    else process.env.CRAWLER_CONTACT_URL = prev;
  }
});

test('D-2 blocked-domains: defaults to empty and blocks exact and subdomain matches from env', () => {
  assert.deepEqual(blockedDomains.DEFAULT_BLOCKED_DOMAINS, []);
  assert.deepEqual(blockedDomains.getBlockedDomains(''), []);
  assert.equal(blockedDomains.isDomainBlocked('https://example.com/page', { envRaw: '' }), false);

  const envRaw = 'blocked.example.com, https://Restricted.Org/path, *.wildcard.net';
  assert.equal(blockedDomains.isDomainBlocked('https://blocked.example.com/a', { envRaw }), true);
  assert.equal(blockedDomains.isDomainBlocked('https://sub.blocked.example.com/a', { envRaw }), true);
  assert.equal(blockedDomains.isDomainBlocked('https://notblocked.example.com/a', { envRaw }), false);
  assert.equal(blockedDomains.isDomainBlocked('https://restricted.org/news', { envRaw }), true);
  assert.equal(blockedDomains.isDomainBlocked('https://api.wildcard.net/v1', { envRaw }), true);
});

test('D-2 robots parser: enforces RFC 9309 specificity, Allow vs Disallow precedence, wildcards, and $ anchor', () => {
  const txt = [
    '# Sample robots.txt',
    'User-agent: *',
    'Disallow: /private/',
    'Allow: /private/public-page',
    'Disallow: /*.pdf$',
    '',
    'User-agent: ResearchStudio-Bot',
    'Disallow: /bot-only-blocked/',
    'Allow: /private/',
  ].join('\n');

  const parsed = robots.parseRobotsTxt(txt);
  // 具体的な ResearchStudio-Bot グループが * より優先される
  assert.equal(robots.isPathAllowedByRules(parsed, '/bot-only-blocked/item'), false);
  assert.equal(robots.isPathAllowedByRules(parsed, '/private/secret'), true);

  // * のみの robots.txt の場合
  const wildcardOnly = robots.parseRobotsTxt([
    'User-agent: *',
    'Disallow: /private/',
    'Allow: /private/public-page',
    'Disallow: /*.pdf$',
  ].join('\n'));

  assert.equal(robots.isPathAllowedByRules(wildcardOnly, '/private/secret'), false);
  assert.equal(robots.isPathAllowedByRules(wildcardOnly, '/private/public-page'), true);
  assert.equal(robots.isPathAllowedByRules(wildcardOnly, '/docs/report.pdf'), false);
  assert.equal(robots.isPathAllowedByRules(wildcardOnly, '/docs/report.pdf?download=1'), true);
  assert.equal(robots.isPathAllowedByRules(wildcardOnly, '/articles/open'), true);
});

test('D-2 integration: fetchPage skips URLs disallowed by robots.txt, caches robots.txt per host, and sends bot UA', async () => {
  robots.clearRobotsCache();
  cache.sharedCache.clear();

  let robotsHits = 0;
  let secretHits = 0;
  let seenUa = '';

  const server = http.createServer((req, res) => {
    seenUa = req.headers['user-agent'] || '';
    if (req.url === '/robots.txt') {
      robotsHits += 1;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('User-agent: *\nDisallow: /secret/\nAllow: /public/\n');
    }
    if (req.url.startsWith('/secret/')) {
      secretHits += 1;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Secret</title></head><body>TOP SECRET</body></html>');
    }
    if (req.url === '/public/article') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Open Article</title></head><body><main><p>Public content ok</p></main></body></html>');
    }
    res.writeHead(404);
    res.end('Not Found');
  });

  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  const prevContact = process.env.CRAWLER_CONTACT_URL;
  process.env.CRAWLER_CONTACT_URL = 'https://contact.example.jp/crawler';

  try {
    // 1. robots.txt で拒否されている /secret/doc は本文取得がスキップされ、実体へリクエストされない
    await assert.rejects(
      () => search.fetchPage(`http://127.0.0.1:${port}/secret/doc`, { _dangerouslyBypassFirstHopForTest: true }),
      /robots\.txt/
    );
    assert.equal(robotsHits, 1, 'robots.txt should be fetched once');
    assert.equal(secretHits, 0, 'disallowed path must never be requested');

    // 2. 同一ホストの許可パス /public/article はキャッシュ済み robots.txt を再利用して取得成功
    const page = await search.fetchPage(`http://127.0.0.1:${port}/public/article`, {
      _dangerouslyBypassFirstHopForTest: true,
    });
    assert.equal(robotsHits, 1, 'robots.txt must be served from 24h host cache');
    assert.equal(page.title, 'Open Article');
    assert.ok(page.text.includes('Public content ok'));
    assert.ok(seenUa.includes('ResearchStudio-Bot'), 'fetchPage must send ResearchStudio-Bot User-Agent');
    assert.ok(seenUa.includes('+https://contact.example.jp/crawler'), 'fetchPage UA must include CRAWLER_CONTACT_URL');
  } finally {
    if (prevContact === undefined) delete process.env.CRAWLER_CONTACT_URL;
    else process.env.CRAWLER_CONTACT_URL = prevContact;
    robots.clearRobotsCache();
    cache.sharedCache.clear();
    await new Promise((r) => server.close(r));
  }
});

test('D-2 integration: robots.txt fetch enforces B-6 SSRF check (no bypass on non-test / redirect)', async () => {
  robots.clearRobotsCache();

  // 1. 直接 127.0.0.1 への robots.txt 取得は B-6 SSRF 検証で拒否される
  await assert.rejects(
    () => robots.assertAllowedByRobots('http://127.0.0.1:3939/some-page'),
    /禁止|不許可|制限された/
  );

  // 2. /robots.txt が内部メタデータ IP へリダイレクトした場合も B-6 で遮断される
  const redirectServer = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>OK</body></html>');
  });

  const port = await new Promise((resolve) => {
    redirectServer.listen(0, '127.0.0.1', () => resolve(redirectServer.address().port));
  });

  try {
    await assert.rejects(
      () => search.fetchPage(`http://127.0.0.1:${port}/page`, { _dangerouslyBypassFirstHopForTest: true }),
      /禁止|不許可|制限された/
    );
  } finally {
    robots.clearRobotsCache();
    await new Promise((r) => redirectServer.close(r));
  }
});

test('D-2 integration: blocked domain in BLOCKED_DOMAINS skips fetchPage before any network access', async () => {
  const prev = process.env.BLOCKED_DOMAINS;
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>should not be fetched</body></html>');
  });
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  try {
    process.env.BLOCKED_DOMAINS = '127.0.0.1';
    await assert.rejects(
      () => search.fetchPage(`http://127.0.0.1:${port}/article`, { _dangerouslyBypassFirstHopForTest: true }),
      /取得除外ドメイン/
    );
    assert.equal(hits, 0, 'blocked domain must not trigger robots.txt or page request');
  } finally {
    if (prev === undefined) delete process.env.BLOCKED_DOMAINS;
    else process.env.BLOCKED_DOMAINS = prev;
    await new Promise((r) => server.close(r));
  }
});

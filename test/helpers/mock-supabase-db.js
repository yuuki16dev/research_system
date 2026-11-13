'use strict';

const http = require('http');

const DUMMY_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * R-7 起動時 DB チェック用の最小モックハンドラ。
 * 既存モックサーバーのフォールバック（404 の直前）で呼び出すことで、
 * テーブル列確認 (?limit=0) や未定義 RPC (usage_cost_since / refund_credits 等) に 200/204 を返す。
 */
function handleDbCheckRequest(req, res, url) {
  const pathname = url.pathname;

  if (
    req.method === 'GET' &&
    url.searchParams.get('limit') === '0' &&
    [
      '/rest/v1/profiles',
      '/rest/v1/research_usage',
      '/rest/v1/user_reports',
      '/rest/v1/usage_events',
    ].includes(pathname)
  ) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
    return true;
  }

  if (req.method === 'POST' && pathname === '/rest/v1/rpc/consume_credits') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('true');
    return true;
  }

  if (req.method === 'POST' && pathname === '/rest/v1/rpc/refund_credits') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === 'POST' && pathname === '/rest/v1/rpc/usage_cost_since') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('0');
    return true;
  }

  return false;
}

/**
 * 既存テストで SUPABASE_URL をダミー URL にしてサーバーを起動していた箇所向けの軽量モック Supabase サーバー。
 * R-7 起動時チェック（テーブル4種・RPC3種）のみ 200/204 で応答する。
 */
async function startDbCheckMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    req.resume();
    if (handleDbCheckRequest(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not mocked' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      }),
  };
}

module.exports = {
  DUMMY_UUID,
  handleDbCheckRequest,
  startDbCheckMockServer,
};


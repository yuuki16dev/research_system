'use strict';

/**
 * Supabase DB 起動時状態検証モジュール (R-7)
 *
 * クラウド版起動時に service_role キーを用いて必須テーブル・列および
 * 必須 RPC 関数の存在と到達性を検証し、不足があればすべて列挙して停止させる。
 */

const http = require('http');
const https = require('https');
const env = require('./env');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRY_DELAYS_MS = [400, 800];
const DUMMY_UUID = '00000000-0000-0000-0000-000000000000';
const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA']);
const TRANSIENT_CONNECTION_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

const REQUIRED_TABLES = [
  {
    name: 'profiles',
    columns: ['id', 'plan', 'subscription_status'],
  },
  {
    name: 'research_usage',
    columns: ['user_id', 'year_month', 'used_count'],
  },
  {
    name: 'user_reports',
    columns: ['id', 'user_id', 'report_json', 'pinned', 'updated_at', 'share_token', 'share_enabled'],
  },
  {
    name: 'usage_events',
    columns: ['user_id', 'kind', 'job_id', 'est_cost_jpy', 'status', 'created_at'],
  },
];

const REQUIRED_RPCS = [
  {
    name: 'consume_credits',
    body: { p_user: DUMMY_UUID, p_ym: '1970-01', p_cost: 0, p_limit: 0 },
  },
  {
    name: 'refund_credits',
    body: { p_user: DUMMY_UUID, p_ym: '1970-01', p_cost: 0 },
  },
  {
    name: 'usage_cost_since',
    body: { p_since: '2099-01-01T00:00:00.000Z' },
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveRetryDelays(options = {}) {
  if (Array.isArray(options.retryDelaysMs)) {
    return options.retryDelaysMs.filter((n) => Number.isFinite(n) && n >= 0);
  }
  if (process.env.DB_CHECK_RETRY_DELAYS_MS !== undefined) {
    return String(process.env.DB_CHECK_RETRY_DELAYS_MS)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
  }
  return DEFAULT_RETRY_DELAYS_MS;
}

function isTransientFailure(result) {
  if (!result || result.ok) return false;
  if (result.kind === 'connection') {
    return !result.errorCode || TRANSIENT_CONNECTION_CODES.has(result.errorCode);
  }
  return TRANSIENT_HTTP_STATUSES.has(result.httpStatus);
}

async function checkWithRetry(runCheck, retryDelaysMs) {
  let result = await runCheck();
  for (let i = 0; i < retryDelaysMs.length && isTransientFailure(result); i++) {
    await sleep(retryDelaysMs[i]);
    result = await runCheck();
  }
  return result;
}

function requestJson(endpoint, { method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const transport = parsed.protocol === 'https:' ? https : http;
    const payload = body !== null ? JSON.stringify(body) : null;
    const reqHeaders = {
      ...headers,
      Connection: 'close',
    };
    if (payload !== null) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = transport.request(
      parsed,
      {
        method,
        headers: reqHeaders,
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (data.length < 512) data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, text: data });
        });
      }
    );

    req.on('timeout', () => {
      const err = new Error(`Timeout after ${timeoutMs}ms`);
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.on('error', (err) => {
      reject(err);
    });

    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

async function probeEndpoint({ endpoint, method, headers, body = null, kind, name, okStatuses, timeoutMs }) {
  try {
    const res = await requestJson(endpoint, { method, headers, body, timeoutMs });
    if (okStatuses.includes(res.status)) {
      return { ok: true, kind, name };
    }
    const detail = res.text ? res.text.slice(0, 160).replace(/\s+/g, ' ').trim() : '';
    return {
      ok: false,
      kind,
      name,
      httpStatus: res.status,
      reason: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'connection',
      name,
      errorCode: err && err.code ? String(err.code) : '',
      reason: `接続失敗: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

async function checkTable(baseUrl, headers, table, timeoutMs) {
  const select = table.columns.join(',');
  return probeEndpoint({
    endpoint: `${baseUrl}/rest/v1/${table.name}?select=${select}&limit=0`,
    method: 'GET',
    headers,
    kind: 'table',
    name: `${table.name}(${select})`,
    okStatuses: [200],
    timeoutMs,
  });
}

async function checkRpc(baseUrl, headers, rpc, timeoutMs) {
  // consume_credits / usage_cost_since は 200、returns void の refund_credits は PostgREST 上 204 または 200
  return probeEndpoint({
    endpoint: `${baseUrl}/rest/v1/rpc/${rpc.name}`,
    method: 'POST',
    headers,
    body: rpc.body,
    kind: 'rpc',
    name: rpc.name,
    okStatuses: [200, 204],
    timeoutMs,
  });
}

function buildConnectionFatalError(hostname, failure, allFailures = [failure]) {
  let msg;
  if (DNS_ERROR_CODES.has(failure.errorCode)) {
    msg =
      `Supabase サーバー (${hostname}) の名前解決（DNS）に失敗しました [${failure.reason}]。` +
      '考えられる原因: (1) Supabase Free プランで一定期間の無操作によりプロジェクトが一時停止（Paused）状態' +
      '（停止中は *.supabase.co が DNS 解決できなくなります）➔ Supabase ダッシュボードで「Resume project」を実行してください / ' +
      '(2) 環境変数 SUPABASE_URL の設定誤り・プロジェクト削除 ➔ Render/実行環境の SUPABASE_URL（https://<project-ref>.supabase.co）を確認してください';
  } else {
    msg =
      `Supabase サーバー (${hostname}) へ接続できません [${failure.reason}]。` +
      'Supabase プロジェクトが稼働中か、および SUPABASE_URL の設定を確認してください';
  }
  const err = new Error(msg);
  err.code = failure.errorCode || 'SUPABASE_UNREACHABLE';
  err.failures = allFailures;
  return err;
}

/**
 * クラウド版の起動時に Supabase 上の必須テーブル・列・RPC の存在を検証する。
 * DNS・接続不能時は重複エラーを出さず原因・復旧手順を示し、
 * スキーマ不足時はすべての失敗項目を列挙した Error を throw する。
 */
async function verifyDatabaseSchema(options = {}) {
  const force = Boolean(options.force);
  if (!force && !env.IS_CLOUD) {
    return { ok: true, skipped: true };
  }

  const baseUrl = env.normalizeSupabaseUrl(options.supabaseUrl || env.getSupabaseUrl());
  const serviceRoleKey = env.normalizeEnvValue(options.serviceRoleKey) || env.getSupabaseServiceRoleKey();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const retryDelaysMs = resolveRetryDelays(options);

  if (!baseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定のため DB 状態確認を実行できません');
  }

  const parsedUrl = parseHttpUrl(baseUrl);
  if (!parsedUrl) {
    throw new Error(
      `SUPABASE_URL の形式が不正です ("${baseUrl}")。https://<project-ref>.supabase.co の形式で指定してください`
    );
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  // 先頭テーブルで到達性を事前確認し、DNS/接続不能時に全7件の重複エラーログを防ぐ
  const firstTable = REQUIRED_TABLES[0];
  const firstResult = await checkWithRetry(
    () => checkTable(baseUrl, headers, firstTable, timeoutMs),
    retryDelaysMs
  );
  if (!firstResult.ok && firstResult.kind === 'connection') {
    throw buildConnectionFatalError(parsedUrl.hostname, firstResult);
  }

  const restResults = await Promise.all([
    ...REQUIRED_TABLES.slice(1).map((t) =>
      checkWithRetry(() => checkTable(baseUrl, headers, t, timeoutMs), retryDelaysMs)
    ),
    ...REQUIRED_RPCS.map((r) =>
      checkWithRetry(() => checkRpc(baseUrl, headers, r, timeoutMs), retryDelaysMs)
    ),
  ]);

  const failures = [firstResult, ...restResults].filter((r) => !r.ok);
  if (failures.length > 0) {
    if (failures.every((f) => f.kind === 'connection')) {
      throw buildConnectionFatalError(parsedUrl.hostname, failures[0], failures);
    }
    const summary = failures.map((f) => `${f.name} [${f.reason}]`).join('; ');
    const hasAuthFailure = failures.some((f) => f.httpStatus === 401 || f.httpStatus === 403);
    const authHint = hasAuthFailure
      ? '（認証エラー: SUPABASE_SERVICE_ROLE_KEY の設定値または権限を確認してください）'
      : '';
    const err = new Error(`Supabase DB の起動時検証に失敗しました。不足または接続エラー項目: ${summary}${authHint}`);
    err.failures = failures;
    throw err;
  }

  return {
    ok: true,
    checkedTables: REQUIRED_TABLES.map((t) => t.name),
    checkedRpcs: REQUIRED_RPCS.map((r) => r.name),
  };
}

module.exports = {
  REQUIRED_TABLES,
  REQUIRED_RPCS,
  verifyDatabaseSchema,
  buildConnectionFatalError,
};

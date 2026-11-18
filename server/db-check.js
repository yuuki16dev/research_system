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
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 5000;
const DEFAULT_KEEPALIVE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6時間
const DEFAULT_BACKGROUND_KEEPALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24時間
const KEEPALIVE_FAILURE_BACKOFF_MS = 60 * 1000; // 60秒
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
    migration: '20261106_init.sql',
  },
  {
    name: 'research_usage',
    columns: ['user_id', 'year_month', 'used_count'],
    migration: '20261106_init.sql',
  },
  {
    name: 'user_reports',
    columns: ['id', 'user_id', 'report_json', 'pinned', 'updated_at', 'share_token', 'share_enabled'],
    migration: '20261111_user_reports_schema.sql',
    baseMigration: '20261106_init.sql',
  },
  {
    name: 'usage_events',
    columns: ['user_id', 'kind', 'job_id', 'est_cost_jpy', 'status', 'created_at'],
    migration: '20261112_usage_events_schema.sql',
  },
];

const REQUIRED_RPCS = [
  {
    name: 'consume_credits',
    body: { p_user: DUMMY_UUID, p_ym: '1970-01', p_cost: 0, p_limit: 0 },
    migration: '20261113_credit_functions.sql',
  },
  {
    name: 'refund_credits',
    body: { p_user: DUMMY_UUID, p_ym: '1970-01', p_cost: 0 },
    migration: '20261113_credit_functions.sql',
  },
  {
    name: 'usage_cost_since',
    body: { p_since: '2099-01-01T00:00:00.000Z' },
    migration: '20261113_usage_cost_since.sql',
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

async function probeEndpoint({ endpoint, method, headers, body = null, kind, name, migration, baseMigration, okStatuses, timeoutMs }) {
  try {
    const res = await requestJson(endpoint, { method, headers, body, timeoutMs });
    if (okStatuses.includes(res.status)) {
      return { ok: true, kind, name };
    }
    const detail = res.text ? res.text.slice(0, 160).replace(/\s+/g, ' ').trim() : '';
    const resolvedMigrations = [];
    if (baseMigration && (res.text.includes('PGRST205') || res.text.includes('42P01'))) {
      resolvedMigrations.push(baseMigration);
    }
    if (migration) resolvedMigrations.push(migration);
    return {
      ok: false,
      kind,
      name,
      migrations: resolvedMigrations,
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
    migration: table.migration,
    baseMigration: table.baseMigration,
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
    migration: rpc.migration,
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

  const headers = env.buildSupabaseHeaders(serviceRoleKey, {
    'Content-Type': 'application/json',
  });

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
    const missingMigrations = Array.from(
      new Set(failures.flatMap((f) => (Array.isArray(f.migrations) ? f.migrations : [])))
    ).sort();
    const authHint = hasAuthFailure
      ? '（認証エラー: SUPABASE_SERVICE_ROLE_KEY の設定値または権限を確認してください）'
      : '';
    const migrationHint = !hasAuthFailure && missingMigrations.length > 0
      ? ` / 対処: supabase/migrations/ 内の未適用SQL (${missingMigrations.join(', ')}) または統合SQL (supabase/migrations/all_in_one.sql) を Supabase SQL Editor で実行してください`
      : '';
    const err = new Error(
      `Supabase DB の起動時検証に失敗しました。不足または接続エラー項目: ${summary}${authHint}${migrationHint}`
    );
    err.failures = failures;
    err.missingMigrations = missingMigrations;
    throw err;
  }

  keepAliveState.lastSuccessAt = Date.now();
  keepAliveState.lastAttemptAt = keepAliveState.lastSuccessAt;
  keepAliveState.lastOk = true;

  return {
    ok: true,
    checkedTables: REQUIRED_TABLES.map((t) => t.name),
    checkedRpcs: REQUIRED_RPCS.map((r) => r.name),
  };
}

const keepAliveState = {
  lastSuccessAt: 0,
  lastAttemptAt: 0,
  lastOk: null,
  inFlight: null,
};

function _resetKeepAliveStateForTest() {
  keepAliveState.lastSuccessAt = 0;
  keepAliveState.lastAttemptAt = 0;
  keepAliveState.lastOk = null;
  keepAliveState.inFlight = null;
}

/**
 * Supabase Free プランの無操作自動一時停止を防ぐため、最小限の DB クエリ（profiles limit=1）を
 * クールダウン制御付きで実行する。資格情報や詳細エラーは呼び出し元レスポンスへ露出させない。
 */
async function pingDatabaseKeepAlive(options = {}) {
  const force = Boolean(options.force);
  if (!force && !env.IS_CLOUD) {
    return { ok: true, status: 'skipped', checkedAt: null };
  }

  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  const now = nowFn();
  const cooldownMs =
    Number.isFinite(Number(options.cooldownMs)) && Number(options.cooldownMs) >= 0
      ? Number(options.cooldownMs)
      : DEFAULT_KEEPALIVE_COOLDOWN_MS;
  const backoffMs =
    Number.isFinite(Number(options.failureBackoffMs)) && Number(options.failureBackoffMs) >= 0
      ? Number(options.failureBackoffMs)
      : KEEPALIVE_FAILURE_BACKOFF_MS;

  if (!force && keepAliveState.lastSuccessAt > 0 && now - keepAliveState.lastSuccessAt < cooldownMs) {
    return {
      ok: true,
      status: 'cached',
      checkedAt: new Date(keepAliveState.lastSuccessAt).toISOString(),
    };
  }

  if (!force && keepAliveState.lastOk === false && keepAliveState.lastAttemptAt > 0 && now - keepAliveState.lastAttemptAt < backoffMs) {
    return {
      ok: false,
      status: 'backoff',
      checkedAt: null,
    };
  }

  const baseUrl = env.normalizeSupabaseUrl(options.supabaseUrl || env.getSupabaseUrl());
  const serviceRoleKey = env.normalizeEnvValue(options.serviceRoleKey) || env.getSupabaseServiceRoleKey();
  if (!baseUrl || !serviceRoleKey || !parseHttpUrl(baseUrl)) {
    return { ok: false, status: 'misconfigured', checkedAt: null };
  }

  if (keepAliveState.inFlight) {
    return keepAliveState.inFlight;
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_KEEPALIVE_TIMEOUT_MS;
  const endpoint = `${baseUrl}/rest/v1/profiles?select=id&limit=1`;
  const headers = env.buildSupabaseHeaders(serviceRoleKey);

  const task = (async () => {
    const attemptAt = nowFn();
    keepAliveState.lastAttemptAt = attemptAt;
    try {
      const res = await requestJson(endpoint, { method: 'GET', headers, timeoutMs });
      if (res.status === 200 || res.status === 204 || res.status === 206) {
        const successAt = nowFn();
        keepAliveState.lastSuccessAt = successAt;
        keepAliveState.lastOk = true;
        return {
          ok: true,
          status: 'ok',
          checkedAt: new Date(successAt).toISOString(),
        };
      }
      keepAliveState.lastOk = false;
      return {
        ok: false,
        status: 'unreachable',
        httpStatus: res.status,
        checkedAt: null,
      };
    } catch {
      keepAliveState.lastOk = false;
      return {
        ok: false,
        status: 'unreachable',
        checkedAt: null,
      };
    } finally {
      keepAliveState.inFlight = null;
    }
  })();

  keepAliveState.inFlight = task;
  return task;
}

/**
 * `/api/health` 受信時に、クラウド本番環境かつ前回成功から 24 時間以上経過している場合のみ
 * 非同期・非ブロッキングで Supabase DB の軽量 Keep-Alive を 1 回だけ実行する。
 * @returns {boolean} バックグラウンド実行をスケジュールした場合 true
 */
function triggerBackgroundKeepAlive(options = {}) {
  const forceRun = Boolean(options.forceRun);
  if (!forceRun) {
    if (!env.IS_CLOUD || process.env.NODE_ENV === 'test' || process.env.DISABLE_SUPABASE_KEEPALIVE === 'true') {
      return false;
    }
  }

  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  const now = nowFn();
  const intervalMs =
    Number.isFinite(Number(options.intervalMs)) && Number(options.intervalMs) >= 0
      ? Number(options.intervalMs)
      : DEFAULT_BACKGROUND_KEEPALIVE_INTERVAL_MS;

  if (!options.force && keepAliveState.lastSuccessAt > 0 && now - keepAliveState.lastSuccessAt < intervalMs) {
    return false;
  }
  if (!options.force && keepAliveState.lastOk === false && keepAliveState.lastAttemptAt > 0 && now - keepAliveState.lastAttemptAt < KEEPALIVE_FAILURE_BACKOFF_MS) {
    return false;
  }
  if (keepAliveState.inFlight) {
    return false;
  }

  const timer = setImmediate(() => {
    pingDatabaseKeepAlive({
      ...options,
      cooldownMs: intervalMs,
    })
      .then((res) => {
        if (!res.ok) {
          console.warn(`[keepalive] Supabase バックグラウンド Keep-Alive 応答異常: ${res.status}`);
        }
      })
      .catch((err) => {
        console.warn('[keepalive] Supabase バックグラウンド Keep-Alive エラー:', err?.message || err);
      });
  });
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return true;
}

module.exports = {
  REQUIRED_TABLES,
  REQUIRED_RPCS,
  verifyDatabaseSchema,
  buildConnectionFatalError,
  pingDatabaseKeepAlive,
  triggerBackgroundKeepAlive,
  _resetKeepAliveStateForTest,
};

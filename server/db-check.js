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
const DUMMY_UUID = '00000000-0000-0000-0000-000000000000';

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

function getSupabaseUrl() {
  return process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/\/+$/, '') : '';
}

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
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
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
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

async function checkTable(baseUrl, headers, table, timeoutMs) {
  const select = table.columns.join(',');
  const endpoint = `${baseUrl}/rest/v1/${table.name}?select=${select}&limit=0`;
  const label = `${table.name}(${select})`;

  try {
    const res = await requestJson(endpoint, { method: 'GET', headers, timeoutMs });
    if (res.status === 200) {
      return { ok: true, kind: 'table', name: label };
    }
    const detail = res.text ? res.text.slice(0, 160).replace(/\s+/g, ' ').trim() : '';
    return {
      ok: false,
      kind: 'table',
      name: label,
      reason: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'connection',
      name: label,
      reason: `接続失敗: ${err.message}`,
    };
  }
}

async function checkRpc(baseUrl, headers, rpc, timeoutMs) {
  const endpoint = `${baseUrl}/rest/v1/rpc/${rpc.name}`;

  try {
    const res = await requestJson(endpoint, {
      method: 'POST',
      headers,
      body: rpc.body,
      timeoutMs,
    });
    // consume_credits / usage_cost_since は 200、returns void の refund_credits は PostgREST 上 204 または 200
    if (res.status === 200 || res.status === 204) {
      return { ok: true, kind: 'rpc', name: rpc.name };
    }
    const detail = res.text ? res.text.slice(0, 160).replace(/\s+/g, ' ').trim() : '';
    return {
      ok: false,
      kind: 'rpc',
      name: rpc.name,
      reason: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
    };
  } catch (err) {
    return {
      ok: false,
      kind: 'connection',
      name: rpc.name,
      reason: `接続失敗: ${err.message}`,
    };
  }
}

/**
 * クラウド版の起動時に Supabase 上の必須テーブル・列・RPC の存在を検証する。
 * 不足や接続不能があればすべての失敗項目を列挙した Error を throw する。
 */
async function verifyDatabaseSchema(options = {}) {
  const force = Boolean(options.force);
  if (!force && !env.IS_CLOUD) {
    return { ok: true, skipped: true };
  }

  const baseUrl = (options.supabaseUrl || getSupabaseUrl()).replace(/\/+$/, '');
  const serviceRoleKey = options.serviceRoleKey || getServiceRoleKey();
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  if (!baseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定のため DB 状態確認を実行できません');
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const results = await Promise.all([
    ...REQUIRED_TABLES.map((t) => checkTable(baseUrl, headers, t, timeoutMs)),
    ...REQUIRED_RPCS.map((r) => checkRpc(baseUrl, headers, r, timeoutMs)),
  ]);

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const summary = failures.map((f) => `${f.name} [${f.reason}]`).join('; ');
    const err = new Error(`Supabase DB の起動時検証に失敗しました。不足または接続エラー項目: ${summary}`);
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
};

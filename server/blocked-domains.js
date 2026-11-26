'use strict';

/**
 * 取得除外ドメイン管理モジュール (D-2)
 * - 初期値は空（DEFAULT_BLOCKED_DOMAINS = []）
 * - 環境変数 BLOCKED_DOMAINS（カンマ・改行・空白区切り）で追加可能
 */

const env = require('./env');

// 取得しないドメインの初期一覧（既定は空）
const DEFAULT_BLOCKED_DOMAINS = Object.freeze([]);

/**
 * ドメイン文字列または URL から小文字ホスト名を正規化抽出する
 * @param {string} raw
 * @returns {string}
 */
function normalizeDomainEntry(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  s = s.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '');
  // パスやポートが混入していれば除去
  s = s.split('/')[0].split(':')[0].trim();
  return s;
}

/**
 * 有効な除外ドメイン一覧を返す
 * @param {string|undefined} [envRaw=process.env.BLOCKED_DOMAINS]
 * @param {string[]} [extraDomains=[]]
 * @returns {string[]}
 */
function getBlockedDomains(envRaw = process.env.BLOCKED_DOMAINS, extraDomains = []) {
  const fromEnv = env
    .normalizeEnvValue(envRaw)
    .split(/[\s,;]+/)
    .map(normalizeDomainEntry)
    .filter(Boolean);

  const fromExtra = Array.isArray(extraDomains)
    ? extraDomains.map(normalizeDomainEntry).filter(Boolean)
    : [];

  return Array.from(new Set([...DEFAULT_BLOCKED_DOMAINS, ...fromEnv, ...fromExtra]));
}

/**
 * 対象 URL（またはホスト名）が除外ドメインに一致するか判定する
 * サブドメイン（例: blocked.example.com に対する sub.blocked.example.com）も対象
 * @param {string} urlOrHost
 * @param {{ envRaw?: string, extraDomains?: string[] }} [options]
 * @returns {boolean}
 */
function isDomainBlocked(urlOrHost, options = {}) {
  const hostname = normalizeDomainEntry(urlOrHost);
  if (!hostname) return false;
  const blockedList = getBlockedDomains(options.envRaw, options.extraDomains);
  return blockedList.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

/**
 * 除外ドメインの場合は例外を送出する
 * @param {string} urlOrHost
 * @param {{ envRaw?: string, extraDomains?: string[] }} [options]
 */
function assertDomainAllowed(urlOrHost, options = {}) {
  if (isDomainBlocked(urlOrHost, options)) {
    const host = normalizeDomainEntry(urlOrHost);
    throw new Error(`取得除外ドメインに設定されているため本文取得をスキップしました: ${host}`);
  }
}

module.exports = {
  DEFAULT_BLOCKED_DOMAINS,
  normalizeDomainEntry,
  getBlockedDomains,
  isDomainBlocked,
  assertDomainAllowed,
};

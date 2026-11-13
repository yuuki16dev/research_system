'use strict';

/**
 * SSRF 防護・パブリック URL 検証ガードモジュール (v2.16.0 / B-6)
 *
 * - http / https 以外のスキーム遮断 (file:, ftp:, javascript:, data: 等)
 * - ユーザー名・パスワードを含む URL の遮断
 * - ポート 80 / 443 以外の不許可ポート遮断
 * - ループバック、プライベート、リンクローカル（クラウドメタデータ）、CGNAT、IPv4射影IPv6 の遮断
 * - DNS事前名前解決による内部アドレス解決の遮断
 */

const dns = require('dns').promises;
const net = require('net');

/**
 * IPv6文字列を 8 個の 16bit 整数配列へ正規化・展開する
 * @param {string} ip
 * @returns {number[]|null}
 */
function parseIpv6ToGroups(ip) {
  let s = String(ip).toLowerCase().trim();
  const zoneIdx = s.indexOf('%');
  if (zoneIdx !== -1) {
    s = s.slice(0, zoneIdx);
  }

  // 末尾に埋め込まれた IPv4 表記 (::ffff:127.0.0.1, 64:ff9b::10.0.0.1 等) を 2つの 16bit グループへ変換
  const lastColon = s.lastIndexOf(':');
  if (lastColon !== -1) {
    const tail = s.slice(lastColon + 1);
    if (net.isIPv4(tail)) {
      const octets = tail.split('.').map(Number);
      const hi = ((octets[0] << 8) | octets[1]).toString(16);
      const lo = ((octets[2] << 8) | octets[3]).toString(16);
      s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
    }
  }

  const dblParts = s.split('::');
  if (dblParts.length > 2) return null;

  let head = dblParts[0] ? dblParts[0].split(':').filter(Boolean) : [];
  let tailParts = dblParts.length === 2 && dblParts[1] ? dblParts[1].split(':').filter(Boolean) : [];

  const totalExplicit = head.length + tailParts.length;
  if (dblParts.length === 1 && totalExplicit !== 8) return null;
  if (dblParts.length === 2 && totalExplicit > 8) return null;

  const zerosNeeded = dblParts.length === 2 ? 8 - totalExplicit : 0;
  const full = [
    ...head,
    ...new Array(zerosNeeded).fill('0'),
    ...tailParts,
  ];
  if (full.length !== 8) return null;

  const groups = [];
  for (const part of full) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

function groupsLower32ToIpv4(g6, g7) {
  return `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
}

/**
 * IPアドレスが制限（内部・プライベート・メタデータ）対象かを判定
 * @param {string} ip
 * @returns {boolean}
 */
function isRestrictedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;

  // IPv4 チェック
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network / unspecified)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;
    // 127.0.0.0/8 (Loopback / localhost)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-local / AWS/GCP/Azure Cloud Metadata: 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT: 100.64.0.0 - 100.127.255.255)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (b0 >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 チェック
  if (net.isIPv6(ip)) {
    const groups = parseIpv6ToGroups(ip);
    if (!groups) return true;

    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

    // ループバック ::1
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) {
      return true;
    }
    // 未指定 ::
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0) {
      return true;
    }
    // ユニークローカル fc00::/7 (fc00:: - fdff:ffff:...)
    if ((g0 & 0xfe00) === 0xfc00) return true;
    // リンクローカル fe80::/10 (fe80:: - febf:...)
    if ((g0 & 0xffc0) === 0xfe80) return true;
    // マルチキャスト ff00::/8
    if ((g0 & 0xff00) === 0xff00) return true;
    // 文書用プレフィックス 2001:db8::/32
    if (g0 === 0x2001 && g1 === 0x0db8) return true;
    // IPv4 射影 IPv6 ::ffff:0:0/96（10進・16進両表記に対応）
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
      return isRestrictedIp(groupsLower32ToIpv4(g6, g7));
    }
    // NAT64 プレフィックス 64:ff9b::/96
    if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return isRestrictedIp(groupsLower32ToIpv4(g6, g7));
    }

    return false;
  }

  return true;
}

/**
 * URLが一般公開されたパブリックWebサイトかを厳格検証し、違反時は例外を投げる
 * @param {string} urlStr
 * @returns {Promise<URL>} パース済みの安全な URL オブジェクト
 * @throws {Error} SSRFまたは不正な形式の場合
 */
async function assertPublicUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    throw new Error('URLが指定されていないか、無効な文字列です');
  }

  const trimmed = urlStr.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`無効なURL形式です: ${trimmed}`);
  }

  // 1. スキームが http: / https: 以外なら例外
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不許可のURLスキームです: ${parsed.protocol}（httpおよびhttpsのみ許可）`);
  }

  // 2. ユーザー名やパスワードを含むなら例外
  if (parsed.username || parsed.password) {
    throw new Error('ユーザー名やパスワードを含むURLは禁止されています');
  }

  // 3. ポートが 80・443 以外なら例外（明示的ポート指定時）
  if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
    throw new Error(`不許可のポート番号です: ${parsed.port}（80または443のみ許可）`);
  }

  // 4. ホスト名の検証（IPv6 の角かっこ [...] を外してから判定）
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new Error('ホスト名が指定されていません');
  }

  // localhost および内部ドメイン名の即時拒絶
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.invalid')
  ) {
    throw new Error(`ローカル・内部ホスト名へのアクセスは禁止されています: ${hostname}`);
  }

  // 5. ホスト名が IP アドレス直打ちの場合
  if (net.isIP(hostname)) {
    if (isRestrictedIp(hostname)) {
      throw new Error(`プライベートまたは制限されたIPアドレスへのアクセスは禁止されています: ${hostname}`);
    }
    return parsed;
  }

  // 6. ドメイン名の場合: DNS lookup で解決されたすべての IP を検証
  let lookupRecords;
  try {
    lookupRecords = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`ドメインの名前解決に失敗しました (${hostname}): ${err.message}`);
  }

  if (!lookupRecords || lookupRecords.length === 0) {
    throw new Error(`ドメイン (${hostname}) に割り当てられたIPアドレスが見つかりませんでした`);
  }

  for (const record of lookupRecords) {
    if (isRestrictedIp(record.address)) {
      throw new Error(
        `ドメイン (${hostname}) が制限された内部IP (${record.address}) に解決されたためアクセスを拒否しました`
      );
    }
  }

  return parsed;
}

/**
 * 例外を投げずにパブリック URL かを真偽値で判定するヘルパー
 * @param {string} urlStr
 * @returns {Promise<boolean>}
 */
async function isPublicUrl(urlStr) {
  try {
    await assertPublicUrl(urlStr);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  assertPublicUrl,
  isPublicUrl,
  isRestrictedIp,
};

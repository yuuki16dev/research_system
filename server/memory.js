'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');

const FILE = path.join(DATA_DIR, 'memory.json');

/**
 * 記憶データの読み込み
 */
function load() {
  try {
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.error('[memory] load error:', e.message);
  }
  return [];
}

/**
 * 記憶データの保存
 */
function save(list) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('[memory] save error:', e.message);
  }
}

/** 単語の簡易トークナイズ（キーワード抽出用） */
function extractKeywords(text = '') {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return [...new Set(cleaned.split(/\s+/).filter((w) => w.length >= 2))];
}

/**
 * 高信頼ソースの自動記憶（リサーチ完了時に呼び出し）
 * スコア75点以上のドメインのみを記憶し、低品質サイトは学習しない
 */
function learnFromResearch(result) {
  if (!result || !Array.isArray(result.sources) || !result.theme) return;

  const current = load();
  const themeKeywords = extractKeywords(result.theme);
  const now = new Date().toISOString();

  result.sources.forEach((s) => {
    // 信頼度スコア75点以上の優良一次情報・専門ソースのみ記憶
    if (!s || !s.domain || typeof s.score !== 'number' || s.score < 75) return;
    const dom = s.domain.toLowerCase().trim();

    // SNSドメインや検索ポータル自体は記憶対象から除外（過度な集中を防ぐ）
    if (/^(google\.|duckduckgo\.|yahoo\.|twitter\.|x\.com|facebook\.|instagram\.)/.test(dom)) return;

    const existing = current.find((item) => item.domain === dom);
    if (existing) {
      existing.useCount = (existing.useCount || 1) + 1;
      existing.lastUsedAt = now;
      existing.avgScore = Math.round((existing.avgScore * 0.7) + (s.score * 0.3));
      if (!existing.themes.includes(result.theme)) {
        existing.themes.unshift(result.theme);
        existing.themes = existing.themes.slice(0, 5); // 直近5件のテーマ
      }
      const newKeywords = new Set([...existing.keywords, ...themeKeywords]);
      existing.keywords = [...newKeywords].slice(0, 20);
    } else {
      current.push({
        domain: dom,
        firstDiscoveredAt: now,
        lastUsedAt: now,
        useCount: 1,
        avgScore: s.score,
        themes: [result.theme],
        keywords: themeKeywords.slice(0, 15),
      });
    }
  });

  // 直近最大150ドメインまで保持（古い順に整理）
  current.sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
  save(current.slice(0, 150));
}

/**
 * 偏り防止（Anti-Bias）アルゴリズムを備えた過去知見ドメインの推薦
 *
 * 【懸念払拭・偏り防止の4大原則】
 * 1. 探索率70%以上の保証: 記憶ドメインからの巡回は最大でも2件までに制限
 * 2. トピック関連度一致: 今回のテーマキーワードと一致する場合のみ候補とする
 * 3. クールダウン・多様性ペナルティ: 頻繁に使われすぎているドメインはスコアを減点
 * 4. 明示的フラグ: 記憶ドメイン由来のソースには [知見メモリ] フラグを付与
 */
function suggestRelevantDomains(theme, { limit = 2, exclude = [] } = {}) {
  const current = load();
  if (!current.length || !theme) return [];

  const themeWords = extractKeywords(theme);
  if (!themeWords.length) return [];

  const now = Date.now();
  const excludeSet = new Set(exclude.map((d) => d.toLowerCase()));

  const scored = current
    .filter((item) => !excludeSet.has(item.domain))
    .map((item) => {
      // 1. キーワード一致スコア
      let matchCount = 0;
      for (const tw of themeWords) {
        if (item.keywords.some((kw) => kw.includes(tw) || tw.includes(kw))) {
          matchCount++;
        }
        if (item.themes.some((th) => th.includes(tw))) {
          matchCount += 1.5;
        }
      }
      if (matchCount === 0) return null; // テーマに関連しないドメインは完全除外

      // 2. 品質スコア (75〜100)
      const qualityFactor = (item.avgScore || 80) / 100;

      // 3. 多様性ペナルティ（特定サイトばかり偏って見ないための減点）
      // 直近24時間以内に使われたドメインは減点してローテーションを促す
      const hoursSinceLastUse = Math.max(0, (now - new Date(item.lastUsedAt).getTime()) / (1000 * 3600));
      const recencyPenalty = hoursSinceLastUse < 24 ? 0.6 : 1.0;

      // 4. 過剰利用ペナルティ（利用回数が10回を超えるドメインは探索優先のため抑制）
      const overusePenalty = item.useCount > 8 ? 0.75 : 1.0;

      const totalScore = matchCount * qualityFactor * recencyPenalty * overusePenalty;
      return {
        domain: item.domain,
        score: totalScore,
        avgScore: item.avgScore,
        sampleTheme: item.themes[0] || '',
        matchKeywords: matchCount,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/** ドメインの個別削除 */
function remove(domain) {
  const current = load();
  const filtered = current.filter((x) => x.domain.toLowerCase() !== String(domain).toLowerCase());
  save(filtered);
  return filtered.length !== current.length;
}

/** 全記憶のリセット */
function clear() {
  save([]);
  return true;
}

module.exports = {
  load,
  learnFromResearch,
  suggestRelevantDomains,
  remove,
  clear,
};

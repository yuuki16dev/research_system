'use strict';

/** 調査範囲ラベル */
const SCOPE_LABELS = {
  web: 'Web全体',
  sns: 'SNS・トレンド',
  sites: '特定サイト・専門サイト',
};

const DEPTH_LABELS = {
  quick: 'クイック（要点のみ・約35〜40秒）',
  deep: 'ディープ（深層推論・多角分析・約1分以上）',
};

const PERIOD_LABELS = {
  year: '直近1年（最新推奨）',
  month: '直近1ヶ月（速報）',
  '3years': '直近3年（中期）',
  all: '全期間（制限なし・過去情報含む）',
  custom: '年代指定（過去期間）',
};

const PURPOSE_LABELS = {
  business: 'ビジネス・戦略資料（標準）',
  tech: '技術・エンジニアリング実装',
  brief: '3分クイック要約・箇条書き',
  decision: '意思決定・比較導入ガイド',
  academic: '学術・体系的サーベイ',
  custom: 'カスタム自由指定',
  general: '総合リサーチ（標準）',
  compare: '競合比較・機能・価格',
  tool: 'ツール選定・料金・制限',
  risk: 'リスク・法規制・落とし穴',
  get trend() {
    return `${new Date().getFullYear()}年最新トレンド・速報`;
  },
};

const SNS_DOMAINS = ['x.com', 'twitter.com', 'reddit.com', 'togetter.com', 'news.ycombinator.com'];

/** ドメインの種別分類（ファクトチェック支援用） */
function classifyDomain(domain = '') {
  const d = domain.toLowerCase();
  if (/\.(go\.jp|lg\.jp|gov|gov\.[a-z]{2}|int)$/.test(d)) return { type: 'gov', label: '公的・行政機関', badge: '🏛️ 公的機関' };
  if (/\.(ac\.jp|edu)$/.test(d) || d.includes('arxiv.org') || d.includes('nature.com')) return { type: 'academic', label: '学術・研究機関', badge: '🎓 学術研究' };
  
  const newsMedia = ['nikkei.com', 'reuters.com', 'bloomberg.com', 'bloomberg.co.jp', 'nhk.or.jp', 'itmedia.co.jp',
    'techcrunch.com', 'wired.com', 'wired.jp', 'impress.co.jp', 'nikkeibp.co.jp', 'toyokeizai.net', 'diamond.jp', 'forbesjapan.com', 'forbes.com'];
  if (newsMedia.some((t) => d === t || d.endsWith('.' + t))) return { type: 'media', label: '報道・専門メディア', badge: '📰 専門報道' };
  
  const techDev = ['zenn.dev', 'qiita.com', 'github.com', 'dev.to', 'gihyo.jp', 'publickey1.jp', 'speakerdeck.com'];
  if (techDev.some((t) => d === t || d.endsWith('.' + t))) return { type: 'tech', label: '技術・知見共有', badge: '💻 技術共有' };
  
  const corpPr = ['prtimes.jp', 'statista.com', 'mckinsey.com', 'gartner.com', 'stripe.com'];
  if (corpPr.some((t) => d === t || d.endsWith('.' + t)) || d.includes('corp') || d.includes('company')) return { type: 'corp', label: '企業IR・公式リリース', badge: '💼 企業公式' };
  
  const social = ['x.com', 'twitter.com', 'reddit.com', 'togetter.com', 'youtube.com', 'tiktok.com', 'instagram.com', 'facebook.com'];
  if (social.some((t) => d === t || d.endsWith('.' + t))) return { type: 'sns', label: 'SNS・コミュニティ', badge: '💬 コミュニティ' };
  
  return { type: 'web', label: 'Web記事・解説', badge: '🌐 Web情報' };
}

/** URL / ドメイン文字列からホスト名を取り出す */
function domainOf(input) {
  if (!input || typeof input !== 'string') return '';
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    return new URL(s).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** 「zenn.dev, qiita.com」形式の入力をドメイン配列に */
function parseSites(input) {
  if (!input) return [];
  const list = String(input)
    .split(/[\s,、，;；\n]+/)
    .map(domainOf)
    .filter((d) => d && d.includes('.'));
  return [...new Set(list)].slice(0, 5);
}

/** ドメインに基づく信頼度のヒューリスティック（0-100） */
function scoreDomain(domain = '') {
  const d = domain.toLowerCase();
  let score = 58;
  if (/\.(go\.jp|lg\.jp|gov|gov\.[a-z]{2}|ac\.jp|edu|int)$/.test(d)) score += 32;
  const tier1 = ['nikkei.com', 'reuters.com', 'bloomberg.com', 'bloomberg.co.jp', 'nhk.or.jp', 'itmedia.co.jp',
    'techcrunch.com', 'wired.com', 'wired.jp', 'prtimes.jp', 'statista.com', 'mckinsey.com', 'gartner.com',
    'impress.co.jp', 'nikkeibp.co.jp', 'toyokeizai.net', 'diamond.jp', 'forbesjapan.com', 'forbes.com',
    'wikipedia.org', 'github.com', 'stripe.com', 'arxiv.org', 'nature.com'];
  const tier2 = ['zenn.dev', 'qiita.com', 'note.com', 'medium.com', 'indiehackers.com', 'dev.to',
    'news.ycombinator.com', 'producthunt.com', 'speakerdeck.com', 'gihyo.jp', 'publickey1.jp', 'b.hatena.ne.jp'];
  const social = ['x.com', 'twitter.com', 'reddit.com', 'togetter.com', 'youtube.com', 'tiktok.com', 'instagram.com', 'facebook.com'];
  const match = (list) => list.some((t) => d === t || d.endsWith('.' + t));
  if (match(tier1)) score += 24;
  else if (match(tier2)) score += 12;
  else if (match(social)) score -= 8;
  return clamp(score, 25, 97);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const str = (v, d = '') => (typeof v === 'string' ? v.trim() : v == null ? d : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * AI / モックの生出力を、フロントエンドが期待する統一スキーマへ正規化する。
 */
function normalizeResult(raw = {}, meta = {}) {
  const assessments = arr(raw.sourceAssessments);
  const sources = arr(meta.sources).map((s, i) => {
    const a = assessments.find((x) => Number(x && x.index) === i + 1);
    const domain = s.domain || domainOf(s.url);
    const heuristic = scoreDomain(domain);
    const cat = classifyDomain(domain);
    const aiScore = a && Number.isFinite(Number(a.score)) ? Number(a.score) : null;
    const score = aiScore == null ? heuristic : Math.round(aiScore * 0.7 + heuristic * 0.3);
    return {
      index: i + 1,
      title: str(s.title, s.url) || s.url,
      url: s.url,
      domain,
      snippet: str(s.snippet).slice(0, 400),
      score: clamp(Math.round(score), 0, 100),
      category: cat.type,
      categoryLabel: cat.label,
      categoryBadge: cat.badge,
      note: str(a && a.note),
      type: s.type || 'web',
      publishedDate: str(s.publishedDate),
      fromMemory: !!s.fromMemory,
    };
  });

  const columns = arr(raw.table && raw.table.columns).map((c) => str(c)).filter(Boolean);
  const rows = arr(raw.table && raw.table.rows)
    .filter(Array.isArray)
    .map((r) => {
      const cells = r.map((c) => str(c));
      while (cells.length < columns.length) cells.push('');
      return cells.slice(0, columns.length || cells.length);
    });

  return {
    id: meta.id,
    theme: meta.theme,
    scope: meta.scope,
    scopeLabel: SCOPE_LABELS[meta.scope] || meta.scope,
    sites: arr(meta.sites),
    depth: meta.depth,
    depthLabel: DEPTH_LABELS[meta.depth] || meta.depth,
    focus: meta.focus || 'auto',
    focusLabel: meta.focusLabel || FOCUS_LABELS[meta.focus] || FOCUS_LABELS.auto,
    purpose: meta.purpose || 'business',
    purposeLabel:
      meta.purpose === 'custom' && meta.customPurpose
        ? `カスタム指定: ${meta.customPurpose}`
        : (PURPOSE_LABELS[meta.purpose] || 'ビジネス・戦略資料'),
    customPurpose: meta.customPurpose || '',
    referenceContext: meta.referenceContext || '',
    period: meta.period || 'year',
    periodLabel:
      meta.period === 'custom' && meta.customPeriod
        ? `指定年代: ${meta.customPeriod}`
        : (PERIOD_LABELS[meta.period] || '直近1年（最新推奨）'),
    customPeriod: meta.customPeriod || '',
    mode: meta.mode,
    model: meta.model || null,
    searchProvider: meta.searchProvider || null,
    createdAt: meta.createdAt || new Date().toISOString(),
    durationMs: meta.durationMs || 0,
    queries: arr(meta.queries),
    notices: arr(meta.notices),

    title: str(raw.title) || meta.theme,
    subtitle: str(raw.subtitle),
    summary: str(raw.summary),
    keyPoints: arr(raw.keyPoints).map((k) => str(k)).filter(Boolean),
    metrics: arr(raw.metrics)
      .map((m) => ({ label: str(m && m.label), value: str(m && m.value), note: str(m && m.note) }))
      .filter((m) => m.label || m.value)
      .slice(0, 6),
    table: { caption: str(raw.table && raw.table.caption), columns, rows },
    sections: arr(raw.sections)
      .map((s) => ({
        heading: str(s && s.heading),
        body: str(s && s.body),
        bullets: arr(s && s.bullets).map((b) => str(b)).filter(Boolean),
      }))
      .filter((s) => s.heading || s.body),
    insights: arr(raw.insights)
      .map((x) => ({
        title: str(x && x.title),
        body: str(x && x.body),
        priority: ['高', '中', '低'].includes(str(x && x.priority)) ? str(x.priority) : '中',
      }))
      .filter((x) => x.title || x.body),
    deepThinking: raw.deepThinking
      ? {
          analystNote: typeof raw.deepThinking.analystNote === 'string'
            ? {
                coreHypothesis: raw.deepThinking.analystNote,
                criticalQuestions: [],
                analyticalMethod: '',
              }
            : {
                coreHypothesis: str(
                  (raw.deepThinking.analystNote && raw.deepThinking.analystNote.coreHypothesis) ||
                  (typeof raw.deepThinking.analystNote === 'string' ? raw.deepThinking.analystNote : '')
                ),
                criticalQuestions: arr(raw.deepThinking.analystNote && raw.deepThinking.analystNote.criticalQuestions)
                  .map((q) => str(q))
                  .filter(Boolean),
                analyticalMethod: str(raw.deepThinking.analystNote && raw.deepThinking.analystNote.analyticalMethod),
              },
          dynamicsAndRootCauses: arr(raw.deepThinking.dynamicsAndRootCauses)
            .map((d) => ({
              topic: str(d && d.topic),
              mechanism: str(d && d.mechanism),
              keyFactor: str(d && (d.keyFactor || d.factor)),
            }))
            .filter((d) => d.topic || d.mechanism),
          tradeoffs: arr(raw.deepThinking.tradeoffs)
            .map((t) => ({
              axis: str(t && t.axis),
              proSide: str(t && (t.proSide || t.pro)),
              conSide: str(t && (t.conSide || t.con)),
              synthesis: str(t && t.synthesis),
            }))
            .filter((t) => t.axis || t.proSide),
          scenarios: {
            mainScenario: str(raw.deepThinking.scenarios && (raw.deepThinking.scenarios.mainScenario || raw.deepThinking.scenarios.main)),
            upsideScenario: str(raw.deepThinking.scenarios && (raw.deepThinking.scenarios.upsideScenario || raw.deepThinking.scenarios.upside)),
            downsideScenario: str(raw.deepThinking.scenarios && (raw.deepThinking.scenarios.downsideScenario || raw.deepThinking.scenarios.downside)),
            criticalTriggers: arr(raw.deepThinking.scenarios && raw.deepThinking.scenarios.criticalTriggers).map((ct) => str(ct)).filter(Boolean),
          },
          roadmap: arr(raw.deepThinking.roadmap)
            .map((r) => ({
              phase: str(r && r.phase),
              focus: str(r && r.focus),
              actions: arr(r && (r.actions || r.steps)).map((a) => str(a)).filter(Boolean),
            }))
            .filter((r) => r.phase || r.focus),
        }
      : null,
    framework: raw.framework
      ? {
          focus: str(raw.framework.focus || raw.framework.focusKey),
          focusLabel: str(raw.framework.focusLabel || FOCUS_LABELS[raw.framework.focus] || 'AI自動最適化'),
          rationale: str(raw.framework.rationale),
          dynamicHeadings: arr(raw.framework.dynamicHeadings)
            .map((dh) => ({
              heading: str(dh && dh.heading),
              keyQuestion: str(dh && dh.keyQuestion),
            }))
            .filter((dh) => dh.heading),
          tableComparisonAxis: str(raw.framework.tableComparisonAxis),
        }
      : null,
    sources,
  };
}

const FOCUS_LABELS = {
  auto: 'AI自動最適化（推奨）',
  decision: '意思決定・稟議・ROI重視',
  tech: '技術比較・選定・アーキテクチャ',
  market: '市場動向・競合ベンチマーク',
  problem: '課題解決・根本原因・リスク分析',
};

module.exports = {
  SCOPE_LABELS,
  DEPTH_LABELS,
  PERIOD_LABELS,
  PURPOSE_LABELS,
  FOCUS_LABELS,
  SNS_DOMAINS,
  domainOf,
  classifyDomain,
  parseSites,
  scoreDomain,
  normalizeResult,
  clamp,
  str,
  arr,
};

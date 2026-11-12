'use strict';

const { resolveTheme } = require('./themes');

/** 調査範囲ラベル */
const SCOPE_LABELS = {
  web: 'Web全体',
  sns: 'SNS・トレンド',
  sites: '特定サイト・専門サイト',
};

const DEPTH_LABELS = {
  quick: 'クイック（要点のみ・約15〜25秒）',
  deep: '自律深層リサーチ（2段階探索・約50〜80秒）',
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
  risk: 'リスク・落とし穴徹底調査',
  cost: 'コスト・ROI・相見積もり',
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

function deriveDefaultTags(meta = {}, raw = {}) {
  const tags = new Set();
  const purpose = meta.purpose || 'business';
  if (purpose === 'tech') tags.add('技術調査');
  else if (purpose === 'decision') tags.add('意思決定');
  else if (purpose === 'academic') tags.add('学術・論文');
  else if (purpose === 'risk') tags.add('リスク・課題');
  else if (purpose === 'cost') tags.add('コスト・投資');
  else if (purpose === 'brief') tags.add('クイック要約');
  else tags.add('ビジネス・戦略');

  if (meta.isCrossSynthesis || raw.isCrossSynthesis) tags.add('クロス統合');
  if (meta.isDeltaTracking || raw.isDeltaTracking) tags.add('定点差分');
  if (meta.depth === 'deep' || meta.depth === 'autonomous') tags.add('深層調査');

  return Array.from(tags);
}

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
      hop: Number(s.hop) || 1,
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
    // B-10: 手持ち資料テキスト（referenceContext）はレポート保存・返却オブジェクトから除外
    referenceUrls: arr(raw.referenceUrls || meta.referenceUrls)
      .map(str)
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 10),
    attachedFiles: arr(raw.attachedFiles || meta.attachedFiles)
      .map((f) => ({
        name: str(f && f.name),
        size: Number(f && f.size) || 0,
        type: str(f && f.type),
      }))
      .filter((f) => f.name),
    isCrossSynthesis: !!(raw.isCrossSynthesis || meta.isCrossSynthesis),
    synthesizedReportIds: arr(raw.synthesizedReportIds || meta.synthesizedReportIds).map(str).filter(Boolean),
    synthesizedThemes: arr(raw.synthesizedThemes || meta.synthesizedThemes).map(str).filter(Boolean),
    isDeltaTracking: !!(raw.isDeltaTracking || meta.isDeltaTracking),
    baseReportId: str(raw.baseReportId || meta.baseReportId),
    baseReportDate: str(raw.baseReportDate || meta.baseReportDate),
    baseReportTitle: str(raw.baseReportTitle || meta.baseReportTitle),
    deltaHighlights: arr(raw.deltaHighlights || meta.deltaHighlights)
      .map((dh) => ({
        category: str(dh && dh.category) || '新着アップデート',
        title: str(dh && dh.title),
        description: str(dh && (dh.description || dh.body)),
        impact: ['高', '中', '低'].includes(str(dh && (dh.impact || dh.priority)))
          ? str(dh && (dh.impact || dh.priority))
          : '中',
      }))
      .filter((dh) => dh.title || dh.description),
    reportTheme: resolveTheme(raw.reportTheme || meta.reportTheme || meta.themePreset),
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
    chart: raw.chart && typeof raw.chart === 'object'
      ? {
          type: ['bar', 'radar', 'line', 'pie', 'doughnut'].includes(raw.chart.type) ? raw.chart.type : 'bar',
          title: str(raw.chart.title),
          description: str(raw.chart.description),
          labels: arr(raw.chart.labels).map(str).filter(Boolean),
          datasets: arr(raw.chart.datasets).map((ds) => ({
            label: str(ds && ds.label),
            data: arr(ds && ds.data).map((v) => Number(v) || 0),
          })),
        }
      : null,
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
    multiHop: (raw.multiHop || meta.multiHop)
      ? {
          enabled: !!((raw.multiHop && raw.multiHop.enabled) || (meta.multiHop && meta.multiHop.enabled)),
          hopsExecuted: Number((raw.multiHop && raw.multiHop.hopsExecuted) || (meta.multiHop && meta.multiHop.hopsExecuted)) || 1,
          gapsDetected: arr((raw.multiHop && raw.multiHop.gapsDetected) || (meta.multiHop && meta.multiHop.gapsDetected)).map((g) => str(g)).filter(Boolean),
          followUpQueries: arr((raw.multiHop && raw.multiHop.followUpQueries) || (meta.multiHop && meta.multiHop.followUpQueries)).map((q) => str(q)).filter(Boolean),
          secondHopSourcesCount: Number((raw.multiHop && raw.multiHop.secondHopSourcesCount) || (meta.multiHop && meta.multiHop.secondHopSourcesCount)) || 0,
        }
      : null,
    tokenUsage: (raw.tokenUsage || meta.tokenUsage)
      ? {
          promptTokens: Number((raw.tokenUsage || meta.tokenUsage).promptTokens) || 0,
          candidatesTokens: Number((raw.tokenUsage || meta.tokenUsage).candidatesTokens) || 0,
          totalTokens: Number((raw.tokenUsage || meta.tokenUsage).totalTokens) || 0,
          calls: Number((raw.tokenUsage || meta.tokenUsage).calls) || 0,
          provider: str((raw.tokenUsage || meta.tokenUsage).provider) || 'gemini',
          model: str((raw.tokenUsage || meta.tokenUsage).model) || '',
        }
      : null,
    tags: Array.isArray(raw.tags) && raw.tags.length
      ? raw.tags.map(str).filter(Boolean)
      : Array.isArray(meta.tags) && meta.tags.length
        ? meta.tags.map(str).filter(Boolean)
        : deriveDefaultTags(meta, raw),
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

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return String(iso);
  }
}

/** Markdown形式 (.md) の生成 */
function buildMarkdown(data) {
  if (!data) return '';

  let md = `# ${data.title || data.theme}\n\n`;
  if (data.subtitle) md += `> **${data.subtitle}**\n\n`;

  md += `| 項目 | 内容 |\n|---|---|\n`;
  md += `| **リサーチテーマ** | ${data.theme || ''} |\n`;
  md += `| **調査対象期間** | ${data.periodLabel || '直近1年（最新推奨）'} |\n`;
  md += `| **調査範囲** | ${data.scopeLabel || ''} (${data.depthLabel || ''}) |\n`;
  md += `| **作成日時** | ${fmtDate(data.createdAt)} |\n`;
  md += `| **収集ソース件数** | ${data.sources ? data.sources.length : 0} 件 |\n\n`;

  md += `## エグゼクティブサマリー\n\n${data.summary || ''}\n\n`;

  if (data.metrics && data.metrics.length) {
    md += `## 主要指標 (KPI)\n\n`;
    data.metrics.forEach((m) => {
      md += `- **${m.label}**: ${m.value}${m.note ? ` (${m.note})` : ''}\n`;
    });
    md += '\n';
  }

  if (data.keyPoints && data.keyPoints.length) {
    md += `## キーハイライト\n\n`;
    data.keyPoints.forEach((kp) => {
      md += `- ${kp}\n`;
    });
    md += '\n';
  }

  if (data.table && data.table.columns && data.table.rows) {
    md += `## ${data.table.caption || '構造化比較マトリクス'}\n\n`;
    md += `| ${data.table.columns.join(' | ')} |\n`;
    md += `| ${data.table.columns.map(() => '---').join(' | ')} |\n`;
    data.table.rows.forEach((r) => {
      md += `| ${r.join(' | ')} |\n`;
    });
    md += '\n';
  }

  if (data.deepThinking && data.deepThinking.tradeoffs && data.deepThinking.tradeoffs.length) {
    md += `## 多角トレードオフ・対立軸マトリクス\n\n`;
    data.deepThinking.tradeoffs.forEach((t) => {
      md += `### 対立軸: ${t.axis}\n\n`;
      md += `- **推進派の論拠・メリット**: ${t.proSide}\n`;
      md += `- **慎重派の論拠・潜在リスク**: ${t.conSide}\n`;
      if (t.synthesis) md += `- **アナリストの統合判断**: ${t.synthesis}\n`;
      md += '\n';
    });
  }

  if (data.sections && data.sections.length) {
    md += `## 詳細解説・多角分析\n\n`;
    data.sections.forEach((sec) => {
      md += `### ${sec.heading}\n\n${sec.body}\n\n`;
      if (sec.bullets && sec.bullets.length) {
        sec.bullets.forEach((b) => (md += `- ${b}\n`));
        md += '\n';
      }
    });
  }

  if (data.insights && data.insights.length) {
    md += `## 示唆・提言\n\n`;
    data.insights.forEach((ins) => {
      md += `#### [優先度: ${ins.priority || '中'}] ${ins.title}\n${ins.body}\n\n`;
    });
  }

  if (data.deepThinking) {
    const sc = data.deepThinking.scenarios;
    const rm = data.deepThinking.roadmap;
    if (sc) {
      md += `## 将来シナリオ予測（今後1〜3年）\n\n`;
      md += `- **メイン予測 (確率60%)**: ${sc.mainScenario}\n`;
      md += `- **加速シナリオ (上振れ25%)**: ${sc.upsideScenario}\n`;
      md += `- **停滞シナリオ (下振れ15%)**: ${sc.downsideScenario}\n\n`;
      if (sc.criticalTriggers && sc.criticalTriggers.length) {
        md += `**シナリオ分岐トリガー**: ${sc.criticalTriggers.join(' / ')}\n\n`;
      }
    }
    if (rm && rm.length) {
      md += `## 実行戦略ロードマップ\n\n`;
      rm.forEach((step) => {
        md += `### ${step.phase}\n`;
        if (step.focus) md += `_重点テーマ: ${step.focus}_\n\n`;
        if (step.actions && step.actions.length) {
          step.actions.forEach((act) => (act && (md += `- ${act}\n`)));
          md += '\n';
        }
      });
    }
  }

  if (data.deepDives && data.deepDives.length) {
    md += `## 追加深掘り知見\n\n`;
    data.deepDives.forEach((dd, idx) => {
      md += `### ${idx + 1}. Q: ${dd.question}\n\n`;
      if (dd.quote) md += `> 引用箇所: "${dd.quote}"\n\n`;
      md += `${dd.answer}\n\n`;
      if (dd.keyPoints && dd.keyPoints.length) {
        dd.keyPoints.forEach((kp) => (md += `- ${kp}\n`));
        md += '\n';
      }
    });
  }

  if (data.sources && data.sources.length) {
    md += `## 収集ソース一覧\n\n`;
    data.sources.forEach((s) => {
      md += `${s.index}. [${s.title}](${s.url}) - **${s.domain}** (信頼度スコア: ${s.score}/100)\n`;
      if (s.snippet) md += `   > ${s.snippet.replace(/\n/g, ' ')}\n`;
    });
    md += '\n';
  }

  return md;
}

/** プレーンテキスト形式 (.txt) の生成 */
function buildPlainText(data) {
  if (!data) return '';

  const divider = '='.repeat(64);
  const subDivider = '-'.repeat(64);
  let txt = `${divider}\n`;
  txt += `【リサーチレポート】 ${data.title || data.theme}\n`;
  if (data.subtitle) txt += `サブタイトル: ${data.subtitle}\n`;
  txt += `${divider}\n\n`;

  txt += `■ 調査概要\n`;
  txt += `・リサーチテーマ: ${data.theme}\n`;
  txt += `・調査対象期間: ${data.periodLabel || '直近1年（最新推奨）'}\n`;
  txt += `・調査範囲: ${data.scopeLabel} (${data.depthLabel})\n`;
  txt += `・作成日時: ${fmtDate(data.createdAt)}\n`;
  txt += `・収集ソース件数: ${data.sources ? data.sources.length : 0} 件\n\n`;

  txt += `${subDivider}\n■ エグゼクティブサマリー\n${subDivider}\n${data.summary}\n\n`;

  if (data.metrics && data.metrics.length) {
    txt += `■ 主要指標 (KPI)\n`;
    data.metrics.forEach((m) => {
      txt += `・${m.label}: ${m.value}${m.note ? ` (${m.note})` : ''}\n`;
    });
    txt += '\n';
  }

  if (data.keyPoints && data.keyPoints.length) {
    txt += `■ キーハイライト\n`;
    data.keyPoints.forEach((kp, i) => {
      txt += `${i + 1}. ${kp}\n`;
    });
    txt += '\n';
  }

  if (data.table && data.table.columns && data.table.rows) {
    txt += `${subDivider}\n■ ${data.table.caption || '構造化比較マトリクス'}\n${subDivider}\n`;
    txt += data.table.columns.join(' | ') + '\n';
    txt += '-'.repeat(Math.min(80, data.table.columns.join(' | ').length * 2)) + '\n';
    data.table.rows.forEach((r) => {
      txt += r.join(' | ') + '\n';
    });
    txt += '\n';
  }

  if (data.sections && data.sections.length) {
    txt += `${subDivider}\n■ 詳細解説・多角分析\n${subDivider}\n\n`;
    data.sections.forEach((sec, idx) => {
      txt += `【セクション ${idx + 1}】 ${sec.heading}\n`;
      txt += `${sec.body}\n`;
      if (sec.bullets && sec.bullets.length) {
        sec.bullets.forEach((b) => (txt += `  ・${b}\n`));
      }
      txt += '\n';
    });
  }

  if (data.insights && data.insights.length) {
    txt += `${subDivider}\n■ 示唆・提言\n${subDivider}\n`;
    data.insights.forEach((ins, idx) => {
      txt += `${idx + 1}. [優先度: ${ins.priority || '中'}] ${ins.title}\n`;
      txt += `   ${ins.body}\n\n`;
    });
  }

  if (data.deepThinking) {
    const sc = data.deepThinking.scenarios;
    const rm = data.deepThinking.roadmap;
    if (sc) {
      txt += `${subDivider}\n■ 将来シナリオ予測（今後1〜3年）\n${subDivider}\n`;
      txt += `・メイン予測 (確率60%): ${sc.mainScenario}\n`;
      txt += `・加速シナリオ (上振れ25%): ${sc.upsideScenario}\n`;
      txt += `・停滞シナリオ (下振れ15%): ${sc.downsideScenario}\n\n`;
      if (sc.criticalTriggers && sc.criticalTriggers.length) {
        txt += `分岐トリガー: ${sc.criticalTriggers.join(' / ')}\n\n`;
      }
    }
    if (rm && rm.length) {
      txt += `${subDivider}\n■ 実行戦略ロードマップ\n${subDivider}\n`;
      rm.forEach((step) => {
        txt += `【${step.phase}】${step.focus ? ` 重点: ${step.focus}` : ''}\n`;
        if (step.actions && step.actions.length) {
          step.actions.forEach((act) => (txt += `  ・${act}\n`));
        }
        txt += '\n';
      });
    }
  }

  if (data.deepDives && data.deepDives.length) {
    txt += `${subDivider}\n■ 追加深掘り知見\n${subDivider}\n`;
    data.deepDives.forEach((dd, idx) => {
      txt += `[質問 ${idx + 1}] Q: ${dd.question}\n`;
      if (dd.quote) txt += `  引用: "${dd.quote}"\n`;
      txt += `  回答: ${dd.answer}\n`;
      if (dd.keyPoints && dd.keyPoints.length) {
        dd.keyPoints.forEach((kp) => (txt += `  ・${kp}\n`));
      }
      txt += '\n';
    });
  }

  if (data.sources && data.sources.length) {
    txt += `${subDivider}\n■ 収集ソース一覧\n${subDivider}\n`;
    data.sources.forEach((s) => {
      txt += `[${s.index}] ${s.title}\n    URL: ${s.url}\n    提供元: ${s.domain} (信頼度: ${s.score}/100)\n`;
      if (s.snippet) txt += `    抜粋: ${s.snippet.replace(/\n/g, ' ')}\n`;
    });
    txt += '\n';
  }

  txt += `${divider}\nGenerated by Research Studio\n${divider}\n`;
  return txt;
}

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
  buildMarkdown,
  buildPlainText,
  clamp,
  str,
  arr,
};

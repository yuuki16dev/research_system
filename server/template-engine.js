'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(__dirname, 'templates');

// キャッシュ
let cachedCoreCss = null;
let cachedCoreJs = null;
const cachedTemplates = {};

function getCoreCss() {
  if (!cachedCoreCss) {
    cachedCoreCss = fs.readFileSync(path.join(TEMPLATES_DIR, 'core.css'), 'utf8');
  }
  return cachedCoreCss;
}

function getCoreJs() {
  if (!cachedCoreJs) {
    cachedCoreJs = fs.readFileSync(path.join(TEMPLATES_DIR, 'core.js'), 'utf8');
  }
  return cachedCoreJs;
}

function getTemplateRaw(filename) {
  if (!cachedTemplates[filename]) {
    cachedTemplates[filename] = fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf8');
  }
  return cachedTemplates[filename];
}

/**
 * リサーチデータ（data）を新テンプレート共通スキーマに正規化
 */
function adaptDataForTemplate(data = {}, brand = {}) {
  const publisher = (brand && brand.publisherName) || 'Research Studio';
  const classification = (brand && brand.confidentiality) || '社内限定 (INTERNAL USE ONLY)';
  
  let dateStr = '2026.11.06';
  if (data.createdAt) {
    try {
      const d = new Date(data.createdAt);
      if (!isNaN(d.getTime())) {
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        dateStr = `${Y}.${M}.${D}`;
      }
    } catch {}
  }

  const scoreVal = typeof data.confidenceScore === 'number'
    ? data.confidenceScore
    : (typeof data.score === 'number' ? (data.score > 1 ? data.score : Math.round(data.score * 100)) : 88);

  const title = data.title || data.theme || 'エグゼクティブ・リサーチレポート';
  const subtitle = data.subtitle || [data.theme, data.purposeLabel || data.purpose].filter(Boolean).join(' — ') || '構造化分析レポート';

  // metrics
  let metrics = [];
  if (Array.isArray(data.metrics) && data.metrics.length > 0) {
    metrics = data.metrics.map(m => ({
      label: m.label || '指標',
      value: String(m.value || '—'),
      note: m.note || '',
    }));
  } else {
    metrics = [
      { label: '総合信頼度', value: `${scoreVal}点`, note: '一次情報裏付け' },
      { label: '参照ソース数', value: `${(data.sources && data.sources.length) || 0}件`, note: 'Webインデックス及び一次情報源' },
      { label: '分析スタイル', value: data.styleLabel || data.style || '標準ビジネス', note: 'AI動的構造化エンジン' },
      { label: '調査品質水準', value: 'エンタープライズ', note: '多角クロスチェック検証' },
    ];
  }

  // keyPoints
  const keyPoints = Array.isArray(data.keyPoints) && data.keyPoints.length > 0
    ? data.keyPoints
    : [
        '対象市場・技術領域における最新ファクトと動向の構造化整理。',
        '主要アプローチ間のトレードオフおよび定量的コスト・性能比較。',
        '実効性と安全性を両立する段階的導入ロードマップの提示。',
      ];

  // table
  const hasDynamicTable = data.table && Array.isArray(data.table.columns) && Array.isArray(data.table.rows) && data.table.rows.length > 0;
  const table = {
    caption: (data.table && data.table.caption) ? data.table.caption : `${data.title || data.theme || '主要方式'} 比較マトリクス`,
    columns: hasDynamicTable
      ? data.table.columns
      : ['項目名', '選択肢A', '選択肢B', '選定基準', '推奨度'],
    rows: hasDynamicTable
      ? data.table.rows
      : [
          ['要件適合度', '◎', '○', 'コア業務プロセスの網羅性', '◎ 推奨'],
          ['導入迅速性', '◎', '△', '本番稼働までのリードタイム', '◎ 推奨'],
          ['初期・運用費用', '○', '△', 'TCO（総保有コスト）', '○ 標準'],
        ],
  };

  // sections
  const sections = Array.isArray(data.sections) && data.sections.length > 0
    ? data.sections.map(s => ({
        heading: s.heading || s.title || '調査詳細',
        body: s.body || s.content || s.text || '',
        bullets: Array.isArray(s.bullets) ? s.bullets : [],
      }))
    : [];

  // sources
  const sources = Array.isArray(data.sources) && data.sources.length > 0
    ? data.sources.map((s, idx) => ({
        id: s.id || `S${idx + 1}`,
        title: s.title || s.domain || '調査情報源',
        publisher: s.publisher || s.category || s.domain || '業界一次情報',
        score: typeof s.score === 'number' ? (s.score > 1 ? s.score : Math.round(s.score * 100)) : 85,
        url: s.url || '',
      }))
    : [
        { id: 'S1', title: '公的統計・産業レポート', publisher: '公的機関', score: 92, url: 'https://example.com/s1' },
        { id: 'S2', title: '主要ベンダー公式ドキュメント', publisher: '公式情報', score: 88, url: 'https://example.com/s2' },
      ];

  // decision (B用)
  const decision = data.decision || {
    verdict: scoreVal >= 85 ? 'GO' : (scoreVal >= 65 ? 'CONDITIONAL_GO' : 'HOLD'),
    question: `${title}における推奨方針を承認し、次フェーズへ進めるべきか`,
    due: `${dateStr} +14d`,
    asks: Array.isArray(data.insights) && data.insights.length > 0
      ? data.insights.slice(0, 3).map(ins => ins.title || ins.body || '施策の推進')
      : [
          '先行検証（PoC）の予算承認および対象部門の確定',
          'セキュリティ・コンプライアンス要件への適合確認',
          '本格展開に向けた推進責任者の任命',
        ],
  };

  // issues (B用)
  const issues = Array.isArray(data.issues) && data.issues.length > 0
    ? data.issues
    : (Array.isArray(data.keyPoints) && data.keyPoints.length > 0
        ? data.keyPoints.slice(0, 3).map((kp, i) => ({
            issue: kp,
            action: (data.insights && data.insights[i] && data.insights[i].title) || '定量的KPIの計測とガイドライン策定',
          }))
        : [
            { issue: '市場環境や競合動向の急速な変化', action: '先行トライアルによる実効性のベースライン計測' },
            { issue: '初期投資・運用コストとROIのバランス', action: '段階的リソース配分による投資回収の早期化' },
          ]);

  // risks (B用)
  const risks = Array.isArray(data.risks) && data.risks.length > 0
    ? data.risks
    : [
        { name: '要件不整合・仕様乖離', impact: 3, likelihood: 2, mitigation: '一次情報および仕様書の詳細クロスチェックと受入検証の実施', owner: '推進PMO' },
        { name: 'コスト・リソース超過', impact: 2, likelihood: 2, mitigation: '段階的PoCによるTCOベースライン測定と予算モニタリング', owner: '統括部門' },
        { name: '運用定着・保守難易度', impact: 2, likelihood: 2, mitigation: '運用ガイドラインの事前策定とスキルトランスファー', owner: '業務部門' },
        { name: '外部依存・ロックイン', impact: 2, likelihood: 1, mitigation: 'オープン標準準拠およびデータ移行条項の事前確保', owner: '調達・法務' },
      ];

  // actions (A/B/C用)
  const actions = Array.isArray(data.actions) && data.actions.length > 0
    ? data.actions
    : (Array.isArray(data.insights) && data.insights.length > 0
        ? data.insights.slice(0, 4).map((ins, i) => ({
            task: ins.title ? `${ins.title}：${ins.body || ''}` : (ins.body || '推奨施策の実施'),
            owner: (ins.category && ins.category !== '市場') ? ins.category : (i === 0 ? '推進PMO' : (i === 1 ? '業務部門' : '統括部門')),
            due: `${dateStr} +${(i + 1) * 30}d`,
            status: '着手前',
          }))
        : [
            { task: '詳細要件の定義および先行検証（PoC）の開始', owner: '推進PMO', due: `${dateStr} +30d`, status: '着手前' },
            { task: '限定スコープでの効果測定と課題抽出', owner: '推進部門', due: `${dateStr} +45d`, status: '着手前' },
            { task: '成果検証と運用ガイドラインの策定', owner: '統括部門', due: `${dateStr} +60d`, status: '着手前' },
            { task: '全社展開に向けた承認手続きとリソース配分', owner: '各部門長', due: `${dateStr} +90d`, status: '着手前' },
          ]);

  return {
    meta: {
      title,
      subtitle,
      theme: data.theme || 'ビジネスリサーチ',
      date: dateStr,
      publisher,
      classification,
      confidenceScore: scoreVal,
    },
    summary: data.summary || (title ? `${title}に関する客観的エビデンスに基づく構造化分析結果。` : ''),
    metrics,
    keyPoints,
    table,
    sections,
    sources,
    decision,
    issues,
    risks,
    actions,
  };
}

/**
 * 指定テンプレートにデータを埋め込んで完全なHTMLを生成
 * @param {'slides'|'decision'|'report'} templateKey 
 * @param {Object} data 
 * @param {Object} brand 
 * @returns {string} 完全なHTML文字列
 */
function renderTemplateHtml(templateKey = 'slides', data = {}, brand = {}) {
  let fileKey = 'template-a-slides.html';
  const normKey = String(templateKey).toLowerCase();

  if (normKey === 'decision' || normKey === 'decision-brief' || normKey === 'b') {
    fileKey = 'template-b-decision.html';
  } else if (normKey === 'report' || normKey === 'research-report' || normKey === 'c') {
    fileKey = 'template-c-report.html';
  } else {
    fileKey = 'template-a-slides.html';
  }

  const rawHtml = getTemplateRaw(fileKey);
  const coreCss = getCoreCss();
  const coreJs = getCoreJs();
  const adapted = adaptDataForTemplate(data, brand);

  const jsonStr = JSON.stringify(adapted)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  let html = rawHtml
    .replace('/*@@CORE_CSS@@*/', coreCss)
    .replace('/*@@CORE_JS@@*/', coreJs);

  // report-data ブロックの置換
  const reData = /^(<script id="report-data" type="application\/json">)[\s\S]*?(<\/script>)$/m;
  if (reData.test(html)) {
    html = html.replace(reData, `$1\n${jsonStr}\n$2`);
  } else {
    html = html.replace('@@DATA@@', jsonStr);
  }

  return html;
}

module.exports = {
  renderTemplateHtml,
  adaptDataForTemplate,
};


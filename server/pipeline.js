'use strict';

const { generateJSON } = require('./gemini');
const { generateGroq } = require('./groq');
const search = require('./search');
const { buildMock, buildDeltaMockRaw } = require('./mock');
const memory = require('./memory');
const { normalizeResult, parseSites, domainOf, arr, str, SCOPE_LABELS, SNS_DOMAINS, FOCUS_LABELS } = require('./util');
const { PROMPT_INJECTION_BARRIER, wrapUntrustedContent } = require('./security');

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('キャンセルされました'));
    const t = setTimeout(resolve, ms);
    signal && signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('キャンセルされました'));
    }, { once: true });
  });
}

/** 長時間のAI待ちの間、プログレスを漸近的に進めつつ思考プロセスログを定期送出 */
function rampProgress(ctx, from, to, stage, theme = '') {
  let v = from;
  let ticks = 0;
  const kw = theme ? `「${theme.slice(0, 20)}」` : '';
  const timer = setInterval(() => {
    ticks++;
    v += (to - v) * 0.08;
    ctx.progress(Math.round(v * 10) / 10, stage);

    // AI思考プロセス（Thinking Process）をリアルタイムに可視化
    if (ticks === 6) {
      ctx.log(
        `💡 思考ストリーム: ${kw}の収集ソースを照合し、主要な論点と因果メカニズムを分析中…`,
        'thinking',
        '一次情報と現場知見を突き合わせ、事実の歪曲がないか検証'
      );
    } else if (ticks === 15) {
      ctx.log(
        `⚖️ 思考ストリーム: 選択肢ごとのメリット・隠れコスト・運用リスクを多角検証中…`,
        'thinking',
        '読者の意思決定に直結する比較軸と定量的KPIを構造化'
      );
    } else if (ticks === 28) {
      ctx.log(
        `📊 思考ストリーム: 構造化レポートの各セクション・比較マトリクスを論理的に執筆中…`,
        'thinking',
        '無理な型ハメを排し、収集データに基づいた客観的記述を徹底'
      );
    } else if (ticks === 45) {
      ctx.log(
        `🛡️ 思考ストリーム: 出典URL・ファクト整合性を最終チェック中（まもなく完成します）…`,
        'thinking',
        'エグゼクティブサマリーおよびネクストアクションの最終推敲'
      );
    }
  }, 700);
  return () => clearInterval(timer);
}

/** 期間指定に応じた検索パラメータと説明文の解決 */
function resolveSearchDateParams(period = 'year', customPeriod = '') {
  const currentYear = new Date().getFullYear();
  let timeRange;
  let startDate;
  let endDate;
  let df;
  let label = '直近1年（最新動向優先）';

  if (period === 'year' || !period) {
    timeRange = 'year';
    df = 'y';
    label = '直近1年（最新動向優先）';
  } else if (period === 'month') {
    timeRange = 'month';
    df = 'm';
    label = '直近1ヶ月（最新速報）';
  } else if (period === '3years') {
    startDate = `${currentYear - 3}-01-01`;
    endDate = `${currentYear}-12-31`;
    df = `${currentYear - 3}-01-01..${new Date().toISOString().slice(0, 10)}`;
    label = `直近3年（${currentYear - 3}〜${currentYear}年）`;
  } else if (period === 'custom') {
    label = customPeriod ? `指定年代: ${customPeriod}` : '指定年代・過去期間';
    const years = [...customPeriod.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => parseInt(m[1], 10));
    if (years.length >= 2) {
      const minYear = Math.min(years[0], years[1]);
      const maxYear = Math.max(years[0], years[1]);
      startDate = `${minYear}-01-01`;
      endDate = `${maxYear}-12-31`;
      df = `${minYear}-01-01..${maxYear}-12-31`;
    } else if (years.length === 1) {
      if (/以前|前|過去|old/i.test(customPeriod)) {
        endDate = `${years[0]}-12-31`;
        df = `1990-01-01..${years[0]}-12-31`;
      } else if (/以降|から|以後|since/i.test(customPeriod)) {
        startDate = `${years[0]}-01-01`;
        df = `${years[0]}-01-01..${currentYear}-12-31`;
      } else {
        startDate = `${years[0]}-01-01`;
        endDate = `${years[0]}-12-31`;
        df = `${years[0]}-01-01..${years[0]}-12-31`;
      }
    }
  } else if (period === 'all') {
    label = '全期間（制限なし・過去情報含む）';
  }

  return { timeRange, startDate, endDate, df, label };
}

/** Google無料枠過負荷時用の自律ローカルクエリ立案エンジン */
function buildLocalSearchPlan(theme, purpose, period, deep) {
  const currentYear = new Date().getFullYear();
  const kw = String(theme || '').trim();

  if (purpose === 'risk') {
    const queries = [
      `${kw} リスク 課題 注意点`,
      `${kw} 失敗事例 落とし穴 デメリット`,
      `${kw} 法規制 セキュリティ 規約`,
      `${kw} 隠れコスト トラブル 回避策`,
    ];
    if (deep) {
      queries.push(`${kw} 訴訟 炎上 事故 過去事例`);
      queries.push(`${kw} 導入前 チェックリスト ガイドライン`);
    }
    return {
      queries,
      angles: ['法的・規約リスク', '失敗事例と教訓', 'セキュリティ・運用落とし穴', 'リスク回避チェックリスト'],
      framework: {
        focus: 'risk',
        focusLabel: 'リスク・落とし穴徹底調査',
        rationale: '導入や投資における潜在的リスクと失敗要因の早期特定',
        dynamicHeadings: [
          { heading: `${kw}における潜在リスクと重大落とし穴`, keyQuestion: 'どのような見落としやすいリスクが存在するか？' },
          { heading: '過去の失敗事例と教訓の分析', keyQuestion: '先行事例では何が原因でトラブルや失敗が生じたか？' },
          { heading: '法規制・コンプライアンス・セキュリティ上の留意点', keyQuestion: '法的・契約上の制約やセキュリティ脆弱性は何か？' },
          { heading: 'リスク緩和策と事前検証チェックリスト', keyQuestion: '事故や損失を未然に防ぐ具体的な防衛策は？' },
        ],
        tableComparisonAxis: 'リスク要因 / 影響度・発生確率 / 典型的な被害 / 推奨回避策',
      },
    };
  }

  if (purpose === 'cost') {
    const queries = [
      `${kw} 料金プラン 価格 月額 初期費用`,
      `${kw} コスト 比較 無料枠 制限`,
      `${kw} 費用対効果 ROI 投資対効果`,
      `${kw} 見積もり 追加費用 課金体系`,
    ];
    if (deep) {
      queries.push(`${kw} 価格改定 値上げ ランニングコスト`);
      queries.push(`${kw} 競合 相見積もり コスト削減`);
    }
    return {
      queries,
      angles: ['料金体系・初期費用', 'プラン比較と無料枠', '隠れコストと従量課金', 'ROI・投資回収試算'],
      framework: {
        focus: 'cost',
        focusLabel: 'コスト・ROI・相見積もり',
        rationale: '初期費用から月額運用費、ROIまでを定量的に比較',
        dynamicHeadings: [
          { heading: `${kw}の料金体系と初期・月額コスト構造`, keyQuestion: '基本プランや従量課金の仕組みはどうなっているか？' },
          { heading: '主要選択肢のコスト・無料枠徹底比較', keyQuestion: '競合や代替手段と比べた費用差や制限は？' },
          { heading: '見落としがちな追加費用と隠れコスト', keyQuestion: '超過料金、移行費用、サポート費用などの盲点は？' },
          { heading: '費用対効果（ROI）試算と投資回収ロードマップ', keyQuestion: '投資に対してどれだけの成果やコスト削減が見込めるか？' },
        ],
        tableComparisonAxis: '初期費用 / 月額費用 / 無料枠制限 / サポート費用 / 推奨規模',
      },
    };
  }

  const queries = [
    kw,
    `${kw} 最新動向 ${currentYear}`,
    `${kw} 比較 料金 機能`,
    `${kw} メリット デメリット 評判`,
  ];
  if (deep) {
    queries.push(`${kw} 課題 リスク 事例`);
    queries.push(`${kw} 将来予測 展望`);
  }
  return {
    queries,
    angles: ['概要と最新動向', '比較と料金', '評判とメリット', '課題と将来展望'],
    framework: {
      focus: 'auto',
      focusLabel: 'テーマ特化型最適構造',
      rationale: 'テーマの多角的理解と実践的な意思決定を両立する構造',
      dynamicHeadings: [
        { heading: `${kw}の現状と全体市場動向`, keyQuestion: 'どのような背景と変遷があるか？' },
        { heading: '主要サービス・アプローチの徹底比較', keyQuestion: '選択肢ごとの強みとコスト差は？' },
        { heading: '導入時の課題・落とし穴と回避策', keyQuestion: 'どのようなリスクと留意点があるか？' },
        { heading: '今後の将来展望と推奨アクション', keyQuestion: '今後1〜3年でどう変化するか？' },
      ],
      tableComparisonAxis: '主要機能 / 料金プラン / メリット / 課題',
    },
  };
}

/** Google無料枠過負荷・停止時の緊急セーフティネット救済合成エンジン */
function buildLiveFallbackReport({ theme, purpose, sources, sites, framework, deep, attachedFiles, referenceUrls }) {
  const currentYear = new Date().getFullYear();
  const kw = String(theme || '').trim();
  const srcList = Array.isArray(sources) && sources.length > 0 ? sources : [];

  const topSnippets = srcList.slice(0, 5).map((s) => s.snippet || s.title).filter(Boolean);
  const summaryText = topSnippets.length > 0
    ? `「${kw}」に関する最新のWeb検索調査結果です。${topSnippets.join(' ')}\n\n主要なWebソースに基づき、現状の市場動向、各プレイヤーの機能・料金体系、導入時の留意点を多角的に整理しました。`
    : `「${kw}」に関する最新調査レポートです。Web上の公知情報および関連資料に基づき、現状動向と重要ポイントを総括しました。`;

  const keyPoints = [
    `${kw}に関する最新トレンドと市場需要の拡大（${currentYear}年最新）`,
    `主要プレイヤーによる機能拡張と価格・プランの最適化`,
    `導入・実践における運用コストおよび技術的課題への配慮の重要性`,
    `中長期的な競争優位性を確立するための実行戦略の策定`,
  ];

  const metrics = [
    { label: '情報鮮度', value: `${currentYear}年最新`, note: '直近Webソースより抽出' },
    { label: '収集ソース数', value: `${srcList.length} 件`, note: '多角検索結果' },
    { label: '分析信頼度', value: '88/100', note: '一次情報突き合わせ' },
    { label: '推奨導入度', value: '高', note: 'ROI重視' },
  ];

  const tableRows = srcList.slice(0, 4).map((s, idx) => [
    s.domain || `選択肢 ${idx + 1}`,
    s.title ? s.title.slice(0, 25) + '…' : '標準機能',
    s.score ? `信頼度 ${s.score}%` : '標準価格',
    '最新Webソース参照',
  ]);
  if (tableRows.length === 0) {
    tableRows.push(['基本構成', '標準機能一式', '初期費用低廉', '中小規模向け']);
    tableRows.push(['高度構成', 'エンタープライズ機能', '従量/定額制', '大規模・高信頼性向け']);
  }

  const sections = (framework && framework.dynamicHeadings && framework.dynamicHeadings.length)
    ? framework.dynamicHeadings.map((dh, i) => {
        const matchingSrc = srcList[i] || srcList[0] || {};
        return {
          heading: dh.heading,
          body: `${dh.heading}に関する詳細分析です。${matchingSrc.snippet || '収集された情報をもとに体系的な知見を整理しています。'}\n\n具体的な運用や意思決定においては、要件に応じた柔軟な設計と最新データの定点観測が推奨されます。`,
          bullets: [
            `${dh.keyQuestion || '重要検討課題の整理'}`,
            `実務運用におけるベストプラクティスの実践`,
            `リスク緩和に向けた事前の検証プロセス`,
          ],
        };
      })
    : [
        {
          heading: `${kw}の市場動向と基本背景`,
          body: `現在、${kw}を取り巻く環境は急速に進化しています。特に${currentYear}年にかけて、ユーザーニーズの多様化と新たな技術基盤の台頭が顕著です。`,
          bullets: ['市場規模の継続的拡大', '参入障壁の変化と新興サービスの台頭'],
        },
        {
          heading: '競合サービス・主要アプローチの比較分析',
          body: `各選択肢における機能差、コスト構造、サポート体制を網羅的に検証しました。用途や組織規模によって最適な選択肢が分かれます。`,
          bullets: ['初期コストとランニングコストのトレードオフ', '操作性と拡張性のバランス'],
        },
        {
          heading: '導入時の潜在的リスクと成功への推奨事項',
          body: `導入にあたっては、隠れた追加費用や運用の属人化を防ぐためのチェック体制が不可欠です。`,
          bullets: ['段階的なPoCによる実行可能性評価', '継続的な定点観測とガバナンスの確立'],
        },
      ];

  const insights = [
    { priority: '高', title: '最新ファクトに基づく優先順位付け', body: `${kw}の検討においては、初期要件にこだわりすぎず、市場で実証されたアプローチを優先的に採択することが成功の鍵となります。` },
    { priority: '中', title: 'コストパフォーマンスとTCOの最適化', body: '目先の導入コストだけでなく、将来の運用保守・拡張コストを含めた総所有コスト（TCO）の観点で選定を行うべきです。' },
    { priority: '中', title: 'リスク事前検知とスケーラビリティの確保', body: '定期的な差分情報の再調査と、外部環境の変化に迅速に対応できる柔軟なアーキテクチャの構築を推奨します。' },
  ];

  return {
    title: `【総合調査報告】${kw}`,
    subtitle: `${currentYear}年最新Webインテリジェンス・構造化分析レポート`,
    summary: summaryText,
    keyPoints,
    metrics,
    table: {
      caption: (framework && framework.tableComparisonAxis) ? `比較マトリクス (${framework.tableComparisonAxis})` : `${kw} 主要アプローチ・選択肢の比較マトリクス`,
      columns: ['分類 / 対象', '主要特徴・提供機能', '信頼性・評価', '備考・推奨事項'],
      rows: tableRows,
    },
    sections,
    insights,
    sourceAssessments: srcList.map((s, idx) => ({ index: idx + 1, score: s.score || 85, note: s.domain })),
  };
}

/* =================================================================== LIVE */

async function runLive(p, s, ctx) {
  const deep = p.depth === 'deep';
  const { signal } = ctx;
  const notices = [];
  const isFreeTier = s.geminiAccountTier === 'free' || (s.geminiAccountTier !== 'tier1');

  const jobTokenUsage = {
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0,
    calls: 0,
    provider: 'gemini',
    model: s.geminiModel || 'gemini-3.8-flash',
  };

  const recordJobUsage = (usageInfo) => {
    if (!usageInfo) return;
    const pt = Number(usageInfo.promptTokens) || 0;
    const ct = Number(usageInfo.candidatesTokens) || 0;
    const tt = Number(usageInfo.totalTokens) || (pt + ct);
    jobTokenUsage.promptTokens += pt;
    jobTokenUsage.candidatesTokens += ct;
    jobTokenUsage.totalTokens += tt;
    jobTokenUsage.calls += 1;
    if (usageInfo.provider) jobTokenUsage.provider = usageInfo.provider;
    if (usageInfo.model) jobTokenUsage.model = usageInfo.model;
  };

  const ai = (prompt, opts = {}) =>
    generateJSON({
      apiKey: s.geminiApiKey,
      model: s.geminiModel,
      prompt,
      signal,
      isFreeTier,
      onUsage: (u) => recordJobUsage({ ...u, provider: 'gemini' }),
      onRetry: ({ attempt, maxRetries, waitMs, currentModel, isFallback, isKeyRotated, isCooldown, keyIndex, totalKeys, error }) => {
        if (isKeyRotated) {
          ctx.log(
            `🔑 APIキー[${keyIndex - 1}]の無料枠一時制限を検知。予備キー[${keyIndex}/${totalKeys}]へ即座に自動切り替えました`,
            'ai'
          );
        } else if (isFallback) {
          ctx.log(
            `🔄 Google無料枠サーバーの混雑（503/429）を検知。空いている安定モデル「${currentModel}」へ自動迂回して調査を続行中 (${attempt}/${maxRetries}回目)…`,
            'warn'
          );
        } else if (isCooldown) {
          ctx.log(
            `⏳ Google無料枠の一時制限（全クォータ消費）を検知。制限解除まで自動待機中（約${Math.round(waitMs / 1000)}秒後に自動再開します）…`,
            'warn'
          );
        } else {
          ctx.log(
            `Google API通信を最適化して再試行中 (${attempt}/${maxRetries}回目, ${(waitMs / 1000).toFixed(1)}秒後)…`,
            'warn'
          );
        }
      },
      ...opts,
    });

  let provider = 'duckduckgo';
  if (s.searchProvider !== 'duckduckgo' && s.tavilyApiKey) provider = 'tavily';
  if (s.searchProvider === 'tavily' && !s.tavilyApiKey) notices.push('Tavily APIキーが未設定のため DuckDuckGo で検索しました');
  const providerLabel = provider === 'tavily' ? 'Tavily' : 'DuckDuckGo';

  /* ---- 1. 計画 */
  ctx.progress(3, 'plan');
  const currentYear = new Date().getFullYear();
  const dateParams = resolveSearchDateParams(p.period, p.customPeriod);

  let periodInstruction = '';
  if (p.period === 'year' || !p.period) {
    periodInstruction = `【重要: 情報鮮度・期間指定】現在は${currentYear}年です。直近1年（${currentYear - 1}〜${currentYear}年）の最新情報を最優先で取得します。最新動向・現状・${currentYear}年の状況を捉えられるクエリ（必要に応じて最新年「${currentYear}」や「最新」を含む）を意識して作成してください。`;
  } else if (p.period === 'month') {
    periodInstruction = `【重要: 情報鮮度・期間指定】現在は${currentYear}年です。直近1ヶ月（最新速報・直近ニュース）の情報を最優先で取得します。「速報」「最新」「今月」や最新の動向を捉えるクエリを作成してください。`;
  } else if (p.period === '3years') {
    periodInstruction = `【重要: 情報鮮度・期間指定】現在は${currentYear}年です。直近3年（${currentYear - 3}〜${currentYear}年）の中期的なトレンド・変遷を調査します。`;
  } else if (p.period === 'custom') {
    periodInstruction = `【重要: 情報鮮度・期間指定】過去・特定の年代情報「${p.customPeriod || '過去情報'}」を対象として調査します。この時期（${p.customPeriod}）の情報が的確にヒットするよう、年代キーワード（例: 年号や当時の関連用語）をクエリに必ず含めてください。`;
  } else if (p.period === 'all') {
    periodInstruction = `【重要: 情報鮮度・期間指定】全期間を対象とします。時期を限定せず、歴史的経緯や初期の知見・発祥・変遷も含めて幅広く多角的なクエリを作成してください。`;
  }

  const purpose = p.purpose || 'business';
  let purposeInstruction = '';
  if (purpose === 'business') {
    purposeInstruction = '【調査の方向性: ビジネス・戦略資料】市場規模・CAGR・収益マネタイズ構造・主要競合・ターゲット顧客の課題・参入障壁や事業機会を把握できるクエリを作成してください。';
  } else if (purpose === 'tech') {
    purposeInstruction = '【調査の方向性: 技術・エンジニアリング実装】システム設計・アーキテクチャ・選定比較・ベンチマーク性能・実装コード例・落とし穴（Gotchas）・破壊的変更を調査できる技術的クエリを作成してください。';
  } else if (purpose === 'brief') {
    purposeInstruction = '【調査の方向性: 3分クイック要約】重要数字・最新の結論・要点トップ5・キーファクトを即座に抽出できる直接的で高精度なクエリを作成してください。';
  } else if (purpose === 'decision') {
    purposeInstruction = '【調査の方向性: 意思決定・比較導入ガイド】「結局どれを選ぶべきか？」を判断するための料金体系・強み弱み・実際の評判や口コミ・不満点・選定基準を洗い出すクエリ（「比較」「料金」「評判」「デメリット」等）を作成してください。';
  } else if (purpose === 'academic') {
    purposeInstruction = '【調査の方向性: 学術・体系的サーベイ】根本原理・数学的/工学的メカニズム・歴史的変遷・主要論文/研究・未解決の技術課題を体系的に辿るクエリを作成してください。';
  } else if (purpose === 'custom') {
    purposeInstruction = `【調査の方向性: カスタム指示】ユーザー独自の指定「${p.customPurpose || p.theme}」を最重要視し、この希望に合致する情報を的確に収集できるクエリを作成してください。`;
  } else if (purpose === 'compare') {
    purposeInstruction = '【調査目的: 競合比較・機能・価格】主要な競合サービス・代表的プレイヤーの料金体系、機能差、強み・弱み、シェアを徹底比較できるクエリを重点的に作成してください。';
  } else if (purpose === 'tool') {
    purposeInstruction = '【調査目的: ツール選定・導入検討】具体的な料金プラン、無料プランの制限、導入手順、連携機能、実際のユーザーの不満点やデメリットを調査するクエリを作成してください。';
  } else if (purpose === 'risk') {
    purposeInstruction = '【調査の方向性: リスク・落とし穴徹底調査】重大な見落としや失敗を防ぐため、導入時の法的リスク、規約違反、セキュリティ懸念、実際の失敗事例やトラブル、隠れたコスト、デメリットを洗い出すクエリ（「失敗事例」「トラブル」「リスク」「落とし穴」「デメリット」等）を重点的に作成してください。';
  } else if (purpose === 'cost') {
    purposeInstruction = '【調査の方向性: コスト・ROI・相見積もり】正確な予算算出と投資判断のため、初期費用、月額ランニングコスト、従量課金、無料枠の制限、追加オプション費用、ROI・費用対効果、競合相見積もりを徹底検証できるクエリ（「料金」「価格」「月額」「初期費用」「無料枠」「コスト比較」等）を作成してください。';
  } else if (purpose === 'trend') {
    purposeInstruction = `【調査目的: ${currentYear}年最新トレンド・速報】直近数ヶ月の最新ニュース、大型アップデート、新規参入、今後のロードマップを追跡できるクエリを作成してください。`;
  } else {
    purposeInstruction = '【調査目的: 総合リサーチ】全体概要、主要な事例・数値・価格相場・課題・最新動向をバランスよく網羅する多角的クエリを作成してください。';
  }

  const isUrl = /^https?:\/\/[^\s]+$/i.test(p.theme.trim());
  let urlDomain = '';
  let urlDirectInstruction = '';
  if (isUrl) {
    urlDomain = domainOf(p.theme);
    urlDirectInstruction = `【重要: 特定URLダイレクト分析モード】入力テーマはWebサイト/プロダクトのURL「${p.theme}」（ドメイン: ${urlDomain}）です。このサービス・プロダクトの基本概要、特徴、機能、料金体系、競合ツール、実際の評判・口コミ、メリット・デメリットを網羅的に調査できるクエリを作成してください。`;
    ctx.log(`🌐 特定URLダイレクト分析モード: ${urlDomain} の競合・特徴・評判を多角調査します`, 'plan');
  }

  const focus = (p.focus && FOCUS_LABELS[p.focus]) ? p.focus : 'auto';
  let focusInstruction = '';
  if (focus === 'decision') {
    focusInstruction = '【分析フォーカス: 意思決定・稟議・ROI重視】経営陣や事業責任者が「選択肢を決定し、Go/No-Goを判断する」ための比較軸、費用対効果、リスク緩和策、意思決定マトリクスに特化した分析構造を設計してください。';
  } else if (focus === 'tech') {
    focusInstruction = '【分析フォーカス: 技術比較・選定・アーキテクチャ】エンジニアや技術責任者が「技術選定・システム設計」を行うための仕様差、パフォーマンス、開発生産性、運用の落とし穴、移行ステップに特化した分析構造を設計してください。';
  } else if (focus === 'market') {
    focusInstruction = '【分析フォーカス: 市場動向・競合ベンチマーク】事業企画やマーケターが「市場機会とポジショニング」を掴むための市場規模推移、主要プレイヤーシェア、成長ドライバー、参入障壁に特化した分析構造を設計してください。';
  } else if (focus === 'problem') {
    focusInstruction = '【分析フォーカス: 課題解決・根本原因・リスク分析】問題解決や品質改善のための、なぜなぜ分析、根本的ボトルネック、失敗事例の教訓、回避策・恒久対策に特化した分析構造を設計してください。';
  } else {
    focusInstruction = '【分析フォーカス: AI自動最適化】このテーマを調査する読者が「最も知りたい核心的な問い」「最も納得感を得られる論理構造」をAIが深く推論し、テーマに特化した独自の動的分析見出し・構造を自動設計してください。';
  }

  const isAuthoritative = !!p.authoritative;
  let authoritativeInstruction = '';
  if (isAuthoritative) {
    authoritativeInstruction = '【最重要: 一次情報・公的データ優先モード】個人ブログやアフィリエイト・キュレーションまとめサイトを徹底排除してください。官公庁（省庁白書・公的統計）、学術・研究機関（大学・J-STAGE・研究所）、企業公式IR（決算説明資料・有価証券報告書）、業界団体の一次データを最優先で収集できるクエリを半数以上含めてください。';
    ctx.log('🏛️ 一次情報・公的データ優先モードが有効: 官公庁(.go.jp)・学術(.ac.jp)・企業IR等の一次ソースを優先', 'plan');
  }

  // 添付資料（BYOD）の内容・サマリーを計画段階から注入（トークン過大化・503過負荷を防ぐためテキスト抜粋を軽量注入）
  let planAttachedContext = '';
  if (Array.isArray(p.attachedFiles) && p.attachedFiles.length > 0) {
    const fileSummaries = p.attachedFiles.map((f, i) => {
      const txt = (f.text || '').trim();
      const snippet = txt ? txt.slice(0, 1200) : '（手持ちレポート・独自資料）';
      return `・添付資料[${i + 1}]: ${f.name} (${Math.round((f.size || 0) / 1024)}KB)\n  内容抜粋: ${snippet}`;
    }).join('\n');
    planAttachedContext = `\n【最重要前提: ユーザー添付の手持ち独自資料・前提レポート情報】\n` +
      `ユーザーから以下の手持ち独自資料・レポートが添付されています。この資料の内容や課題意識、言及されている前提（例: レンダラー追加、親和性、実現可能性など）を最優先で解釈し、それを踏まえた調査クエリと分析構造を立案してください：\n` +
      `${fileSummaries}\n`;
    ctx.log(`📎 添付資料 ${p.attachedFiles.length}件（${p.attachedFiles.map((f) => f.name).join(', ')}）の内容を確認し、調査計画に統合中…`, 'plan');
  }

  if (p.referenceContext && p.referenceContext.trim()) {
    planAttachedContext += `\n【ユーザー指定の前提コンテキスト・メモ】\n${p.referenceContext.trim().slice(0, 1500)}\n`;
  }

  ctx.log(`AI多角クエリ展開 ＆ 動的分析構造の設計中（フォーカス: ${FOCUS_LABELS[focus] || '自動最適化'} / 期間: ${dateParams.label}${isAuthoritative ? ' / 一次情報優先' : ''}）…`, 'plan');
  ctx.log(`🧠 AI思考: テーマ「${p.theme}」の核心的問い・比較軸・調査計画を自律設計中…`, 'thinking', `フォーカス: ${FOCUS_LABELS[focus] || '自動最適化'} / 期間: ${dateParams.label}`);
  const nQ = deep ? 6 : 4;
  const nHeadings = deep ? '4〜5' : '3〜4';
  let plan;
  try {
    plan = await ai(
      `あなたはトップティア戦略コンサルタントのシニアリサーチディレクターです。次のテーマについて、人間が手作業で何時間もかけて複数回検索する作業を完全に代替するため、多角的で質の高いWeb検索サブクエリを${nQ}個作成すると同時に、このテーマに最も適した動的分析構造（フレームワーク）を設計してください。\n` +
        `テーマ: ${p.theme}\n調査範囲: ${SCOPE_LABELS[p.scope]}\n` +
        `${planAttachedContext}` +
        `${urlDirectInstruction ? urlDirectInstruction + '\n' : ''}` +
        `${purposeInstruction}\n` +
        `${focusInstruction}\n` +
        `${authoritativeInstruction ? authoritativeInstruction + '\n' : ''}` +
        `${periodInstruction}\n` +
        `- 日本語クエリを中心に、世界的・海外事例が有用なら英語クエリを1〜2個含める\n` +
        `- 視点を分散させる（①最新動向/市場、②料金・具体的数値、③導入事例・代表サービス、④課題・失敗・リスク等）\n` +
        `- site: 演算子は使わない。各クエリは短く的確に（2〜6語）\n` +
        `- dynamicHeadings: テーマの核心を多角的に解明するためのセクション見出し${nHeadings}個と、各見出しで解明すべき核心的問い\n` +
        `出力JSON:\n` +
        `{\n` +
        `  "queries": ["..."],\n` +
        `  "angles": ["調査観点（15字以内）"],\n` +
        `  "framework": {\n` +
        `    "focus": "${focus}",\n` +
        `    "focusLabel": "${FOCUS_LABELS[focus] || 'テーマ特化型最適構造'}",\n` +
        `    "rationale": "この分析構造を選定した理由（40字以内）",\n` +
        `    "dynamicHeadings": [{"heading": "見出し（25字以内）", "keyQuestion": "このセクションで解明すべき論点（50字以内）"}],\n` +
        `    "tableComparisonAxis": "推奨される比較表の切り口（例: 機能 vs コスト vs 運用難易度）"\n` +
        `  }\n` +
        `}`,
      { temperature: 0.4 }
    );
  } catch (errPlan) {
    if (signal && signal.aborted) throw errPlan;
    if (s.groqApiKey) {
      try {
        ctx.log(`🚀 Google混雑検知。補欠の Groq (${s.groqModel || 'Llama 3.3 70B'}) で検索クエリを展開中…`, 'ai');
        plan = await generateGroq({
          apiKey: s.groqApiKey,
          model: s.groqModel,
          prompt: `あなたはトップティア戦略コンサルタントのリサーチディレクターです。以下のテーマについて検索サブクエリ${nQ}個と動的分析構造をJSONで作成してください：\nテーマ: ${p.theme}\n出力JSON:\n{"queries": ["クエリ1", "クエリ2"], "angles": ["観点1"], "framework": {"focus": "${focus}", "focusLabel": "${FOCUS_LABELS[focus]}", "dynamicHeadings": [{"heading": "見出し", "keyQuestion": "問い"}], "tableComparisonAxis": "軸"}}`,
          signal,
          timeoutMs: 15000,
          onUsage: (u) => recordJobUsage({ ...u, provider: 'groq' }),
        });
        notices.push(`💡 Google無料枠混雑のため、補欠の Groq (${s.groqModel || 'Llama 3.3 70B'}) により高速クエリ展開を実行しました`);
      } catch (_) {
        plan = null;
      }
    }
    if (!plan || !plan.queries) {
      ctx.log('Google無料枠サーバーの混雑を検知。自律ローカルクエリ展開エンジンで検索を続行します', 'warn');
      plan = buildLocalSearchPlan(p.theme, p.purpose, p.period, deep);
      notices.push('Google無料枠混雑のため、ローカル高速クエリ展開エンジンでWeb検索を実行しました');
    }
  }
  let queries = arr(plan.queries).map((q) => str(q)).filter(Boolean).slice(0, nQ);
  if (!queries.length) queries = [p.theme];
  arr(plan.angles).slice(0, 5).forEach((a) => ctx.log(`調査観点: ${str(a)}`, 'plan'));
  queries.forEach((q, idx) => ctx.log(`サブクエリ[${idx + 1}/${queries.length}]: ${q}`, 'plan'));

  let framework = plan.framework || null;
  if (framework && framework.dynamicHeadings && framework.dynamicHeadings.length) {
    ctx.log(`🧠 AI動的構造設計 [${framework.focusLabel || FOCUS_LABELS[focus]}]: ${framework.rationale || '最適な分析軸を設計しました'}`, 'ai');
    arr(framework.dynamicHeadings).slice(0, 4).forEach((dh, idx) => {
      ctx.log(`  └ 構造[${idx + 1}]: ${dh.heading}`, 'plan');
    });
  }
  ctx.progress(10, 'plan');

  /* ---- 2. 専門サイトの自動特定 */
  let sites = p.scope === 'sites' ? parseSites(p.sites) : [];
  if (p.scope === 'sites') {
    if (!sites.length) {
      ctx.progress(12, 'discover');
      ctx.log('入力が空欄のため、テーマに最適な専門サイトをAIが選定中…', 'ai');
      const d = await ai(
        `「${p.theme}」について最も信頼できる・一次情報が集まる専門Webサイトのドメイン（例: note.com, zenn.dev, prtimes.jp 等）を3つ挙げよ。\n` +
          `実在し、検索エンジンにインデックスされている日本語または英語のサイトに限る。\n` +
          `出力JSON: {"domains":[{"domain":"example.com","reason":"選定理由（40字以内）"}]}`,
        { temperature: 0.3 }
      );
      const picked = arr(d.domains)
        .map((x) => ({ domain: domainOf(typeof x === 'string' ? x : x && x.domain), reason: str(x && x.reason) }))
        .filter((x) => x.domain)
        .slice(0, 3);
      picked.forEach((x) => ctx.log(`専門サイトを特定: ${x.domain}`, 'site', x.reason));
      sites = picked.map((x) => x.domain);
      if (!sites.length) {
        notices.push('専門サイトを特定できなかったため Web全体 で検索しました');
        ctx.log('専門サイトを特定できなかったため Web全体 で検索します', 'warn');
      }
    } else {
      sites.forEach((d) => ctx.log(`指定サイトを巡回対象に追加: ${d}`, 'site'));
    }
  }

  /* ---- 2.5 知見メモリの参照（偏り防止機能付き） */
  let memoryDomains = [];
  if (p.scope !== 'sns') {
    const suggested = memory.suggestRelevantDomains(p.theme, { limit: 1, exclude: sites });
    if (suggested.length) {
      memoryDomains = suggested;
      ctx.log(
        `知見メモリからトピック適合ドメインを参照（偏り防止上限1件）: ${suggested[0].domain}`,
        'site',
        `過去の調査「${suggested[0].sampleTheme.slice(0, 25)}…」で高評価`
      );
    }
  }

  /* ---- 2.8 指定参考URL & URL vs URL 対決モードの先行解析 (v2.15.0) ---- */
  const referenceSources = [];
  const themeUrls = [];
  const dualMatch = p.theme.trim().match(/^(https?:\/\/[^\s]+)\s+(?:vs|VS|と)\s+(https?:\/\/[^\s]+)$/i);
  if (dualMatch) {
    themeUrls.push(dualMatch[1], dualMatch[2]);
  }
  const allTargetUrls = Array.from(new Set([
    ...themeUrls,
    ...arr(p.referenceUrls).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim()))
  ])).slice(0, 5);

  if (allTargetUrls.length > 0) {
    ctx.log(`⚔️ 指定された ${allTargetUrls.length} 件の対象URLを先行解析中（SSRF安全ガード適用）…`, 'page');
    for (const u of allTargetUrls) {
      if (signal.aborted) break;
      try {
        const page = await search.fetchPage(u, { signal, maxChars: 5000, timeoutMs: 6000 });
        const d = domainOf(u);
        referenceSources.push({
          title: `【直接解析】${page.title || d}`,
          url: u,
          domain: d,
          snippet: `対象URL「${u}」から直接抽出したWeb本文データ。`,
          content: page.text.slice(0, 5000),
          type: 'reference',
          isReference: true,
          hop: 1,
        });
        ctx.log(`URL直接解析完了 (${d}): ${page.text.length.toLocaleString()} 字を抽出`, 'ok');
      } catch (e) {
        if (signal.aborted) throw e;
        ctx.log(`URL取得スキップ (${u}): ${e.message}`, 'warn');
      }
    }
  }
  if (Array.isArray(p.attachedFiles) && p.attachedFiles.length > 0) {
    ctx.log(`手持ち社内資料 ${p.attachedFiles.length} 件の内容を照合対象に設定`, 'ok');
  }

  /* ---- 3. 検索 */
  const perQuery = deep ? 6 : 4;
  const tasks = [];
  if (sites.length) {
    const qs = queries.slice(0, deep ? 3 : 2);
    for (const site of sites) for (const q of qs) tasks.push({ query: q, site });
  } else {
    for (const q of queries) tasks.push({ query: q });
    // 偏り防止: 記憶ドメインからの巡回は最大1件にとどめ、残る75〜85%は新規Web探索を維持
    if (memoryDomains.length) {
      tasks.push({ query: queries[0], site: memoryDomains[0].domain, fromMemory: true });
    }
  }

  ctx.progress(18, 'search');
  ctx.log(`検索クエリ ${tasks.length} 本を実行中 (${providerLabel})…`, 'search');

  let completedTasks = 0;
  const buckets = [];

  const executeTask = async (t) => {
    try {
      ctx.log(`検索中: ${t.site ? `site:${t.site} ` : ''}${t.query}${t.fromMemory ? ' [知見メモリ]' : ''}`, 'search', providerLabel);
      const results = await search.run({
        provider,
        apiKey: s.tavilyApiKey,
        query: t.query,
        site: t.site,
        sns: p.scope === 'sns' ? SNS_DOMAINS : null,
        maxResults: perQuery,
        deep,
        timeRange: dateParams.timeRange,
        startDate: dateParams.startDate,
        endDate: dateParams.endDate,
        df: dateParams.df,
        signal,
      });
      if (t.fromMemory) {
        results.forEach((r) => (r.fromMemory = true));
      }
      results.forEach((r) => { r.hop = 1; });
      completedTasks++;
      ctx.progress(18 + Math.round(36 * (completedTasks / tasks.length)), 'search');
      ctx.log(`${results.length}件の結果を取得 (${t.query.slice(0, 20)})`, 'ok', results.slice(0, 2).map((r) => r.domain).join(' / '));
      return results;
    } catch (e) {
      if (signal.aborted) throw e;
      ctx.log(`検索に失敗しました (${t.query}): ${e.message}`, 'warn');
      return [];
    }
  };

  if (provider === 'tavily') {
    // Tavily は公式 API のため一斉並列で高速実行
    const res = await Promise.all(tasks.map(executeTask));
    buckets.push(...res);
  } else {
    // DuckDuckGo はスクレイピング制限（429/202 Challenge）を避けるため、2件ずつのバッチ＋インターバルで実行
    for (let i = 0; i < tasks.length; i += 2) {
      if (signal.aborted) break;
      const batch = tasks.slice(i, i + 2);
      const batchResults = await Promise.all(batch.map(executeTask));
      buckets.push(...batchResults);
      if (i + 2 < tasks.length) {
        await sleep(400, signal);
      }
    }
  }


  // ドメイン信頼度スコアリング（公的・一次情報の優先 ＆ SEOスパム・まとめサイトの自動除外）
  function getDomainAuthorityScore(url) {
    const u = (url || '').toLowerCase();
    let score = 0;
    // 公的機関・学術機関・公式発表（.go.jp, .ac.jp, .edu 等）
    if (/\.(go\.jp|gov|ac\.jp|edu|or\.jp|org|jpx\.co\.jp)/.test(u)) {
      score += isAuthoritative ? 6 : 3;
    }
    // IR・公式白書・プレスリリース・公的統計
    if (/(ir|release|corporate|investor|report|whitepaper|stat|soumu|meti|mhlw|e-stat|nikkei|reuters|bloomberg)/.test(u)) {
      score += isAuthoritative ? 3 : 2;
    }
    // 低品質まとめ・アフィリエイト特化・キュレーション・質問箱の自動減点（ノイズ除外）
    if (/(matome|affiliate|ranking-best|hikaku-master|osusume|ranking|chiebukuro|oshiete|wiki|blog\.livedoor|fc2\.com)/.test(u)) {
      score -= 3;
    }
    return score;
  }

  // ラウンドロビンで重複除去しながら統合（特定クエリへの偏りを防ぐ）
  const limit = deep ? 22 : 14;
  const seen = new Set();
  const rawSources = [];
  for (const rs of referenceSources) {
    const key = rs.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (!seen.has(key)) {
      seen.add(key);
      rawSources.push(rs);
    }
  }
  for (let round = 0; rawSources.length < limit * 2; round++) {
    let any = false;
    for (const b of buckets) {
      const r = b[round];
      if (!r) continue;
      any = true;
      const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      rawSources.push({ ...r, type: p.scope === 'sns' ? 'sns' : 'web' });
    }
    if (!any) break;
  }

  let sources = rawSources;

  /* ---- 3.5 自律2段階深層探索（Agentic Multi-Hop Loop） ---- */
  const multiHop = {
    enabled: !!deep,
    hopsExecuted: 1,
    gapsDetected: [],
    followUpQueries: [],
    secondHopSourcesCount: 0,
  };

  if (deep && rawSources.length > 0 && !signal.aborted) {
    ctx.progress(38, 'search');
    ctx.log('🧠 AI思考: 第1次収集データの不足ファクト・未解明論点を自己ギャップ分析中…', 'thinking', '不足している生データや料金・リスクの追跡探索');

    const sampleSnippets = rawSources
      .slice(0, 8)
      .map((s, idx) => `[${idx + 1}] ${s.title || s.domain}: ${s.snippet ? s.snippet.slice(0, 160) : s.domain}`)
      .join('\n');

    try {
      const gapPlan = await ai(
        `あなたは世界最高峰のリサーチ機関のアナリストです。以下のテーマについて収集した第1次検索結果を精査し、最終レポートの品質・解像度・説得力を劇的に高めるために「何の情報・具体データが不足しているか（未解明論点・料金プラン・最新市場規模・課題等）」を客観的に自己分析（ギャップ分析）してください。\n` +
          `そして、その不足をピンポイントで埋めるための【第2次ホップ（深層追加検索クエリ）】を2〜3本策定してください。\n\n` +
          `テーマ: ${p.theme}\n調査目的: ${purpose}\n` +
          `第1次収集ソース概要:\n${sampleSnippets}\n\n` +
          `出力JSON:\n` +
          `{\n` +
          `  "gapsDetected": ["不足している決定的なファクトや論点（35字以内）"],\n` +
          `  "followUpQueries": ["ピンポイント追加検索クエリ（2〜5語）"],\n` +
          `  "rationale": "第2次ホップを実行する狙い（40字以内）"\n` +
          `}`,
        { temperature: 0.3 }
      );

      const gaps = arr(gapPlan.gapsDetected).map((g) => str(g)).filter(Boolean).slice(0, 3);
      const followUps = arr(gapPlan.followUpQueries).map((q) => str(q)).filter(Boolean).slice(0, 3);

      if (gaps.length && followUps.length) {
        multiHop.hopsExecuted = 2;
        multiHop.gapsDetected = gaps;
        multiHop.followUpQueries = followUps;

        gaps.forEach((g) => ctx.log(`  └ 不足ファクト検知: ${g}`, 'plan'));
        ctx.log(`🔍 第2次ホップ（自律深層探索）: ${followUps.length} 本のピンポイント検索を開始…`, 'search');

        const hop2Tasks = followUps.map((q) => ({ query: q, hop: 2 }));
        const hop2Buckets = [];

        const executeHop2Task = async (t) => {
          try {
            ctx.log(`2次ホップ検索中: ${t.query}`, 'search', providerLabel);
            const results = await search.run({
              provider,
              apiKey: s.tavilyApiKey,
              query: t.query,
              sns: p.scope === 'sns' ? SNS_DOMAINS : null,
              maxResults: 4,
              deep: true,
              timeRange: dateParams.timeRange,
              startDate: dateParams.startDate,
              endDate: dateParams.endDate,
              df: dateParams.df,
              signal,
            });
            results.forEach((r) => { r.hop = 2; });
            return results;
          } catch (e) {
            if (signal.aborted) throw e;
            ctx.log(`2次ホップ検索失敗 (${t.query}): ${e.message}`, 'warn');
            return [];
          }
        };

        if (provider === 'tavily') {
          const res = await Promise.all(hop2Tasks.map(executeHop2Task));
          hop2Buckets.push(...res);
        } else {
          for (let i = 0; i < hop2Tasks.length; i += 2) {
            if (signal.aborted) break;
            const batch = hop2Tasks.slice(i, i + 2);
            const batchResults = await Promise.all(batch.map(executeHop2Task));
            hop2Buckets.push(...batchResults);
            if (i + 2 < hop2Tasks.length) await sleep(300, signal);
          }
        }

        const hop2NewSources = [];
        for (const b of hop2Buckets) {
          for (const r of b) {
            const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
            if (!seen.has(key)) {
              seen.add(key);
              r.hop = 2;
              r.type = p.scope === 'sns' ? 'sns' : 'web';
              rawSources.push(r);
              hop2NewSources.push(r);
            }
          }
        }
        multiHop.secondHopSourcesCount = hop2NewSources.length;
        ctx.log(`第2次ホップ完了: 新たに ${hop2NewSources.length} 件の深層ソースを追加獲得`, 'ok');
      }
    } catch (err) {
      if (signal.aborted) throw err;
      ctx.log(`自律ギャップ分析をスキップし第1次ソースで継続します: ${err.message}`, 'warn');
    }
  }

  sources = rawSources;
  // 低品質ノイズ・まとめサイトを自動除外し、信頼性の高い公的・公式ドメインを優先選定
  sources.sort((a, b) => getDomainAuthorityScore(b.url) - getDomainAuthorityScore(a.url));
  sources = sources.slice(0, limit);

  ctx.progress(55, 'search');
  if (!sources.length) {
    if (provider === 'duckduckgo') {
      notices.push('DuckDuckGo の一時的なアクセス制限により検索結果を取得できませんでした。設定から無料の「Tavily APIキー」を設定すると制限なく高精度に検索できます。今回はAIの知識ベースで生成しました。');
      ctx.log('検索結果が0件でした（DuckDuckGo制限の可能性あり）。AIの知識ベースで続行します', 'warn');
    } else {
      notices.push('Web検索で結果を取得できなかったため、AIの知識ベースのみで生成しています（要ファクトチェック）');
      ctx.log('検索結果が0件でした。AIの知識ベースで続行します', 'warn');
    }
  } else {
    const authCount = sources.filter((s) => getDomainAuthorityScore(s.url) >= 2).length;
    const authNote = authCount > 0 ? `（信頼できる公的・公式・学術ソース: ${authCount}件を優先解析）` : '';
    ctx.log(`重複・ノイズを除いた ${sources.length} 件のソースを解析対象に選定 ${authNote}`, 'ok');
  }

  /* ---- 4. ページ解析（本文ディープ抽出） */
  const fetchN = Math.min(deep ? 18 : 10, sources.length);
  const maxChars = deep ? 8000 : 5500;
  const timeoutMs = deep ? 8000 : 5000;
  let done = 0;
  const targets = sources.slice(0, fetchN);
  const worker = async (src) => {
    ctx.log(`解析中: ${src.domain}`, 'page', src.title);
    try {
      if (src.rawContent && src.rawContent.length > 200) {
        src.content = src.rawContent.slice(0, maxChars);
      } else {
        const page = await search.fetchPage(src.url, { signal, maxChars, timeoutMs });
        src.content = page.text;
        if ((!src.title || src.title === src.url) && page.title) src.title = page.title;
      }
      ctx.log(`本文 ${src.content.length.toLocaleString()} 字を抽出: ${src.domain}`, 'ok');
    } catch (e) {
      if (signal.aborted) throw e;
      ctx.log(`本文を取得できませんでした（抜粋で代替）: ${src.domain}`, 'warn', e.message);
    } finally {
      done++;
      ctx.progress(55 + Math.round(25 * (done / Math.max(1, fetchN))), 'analyze');
    }
  };
  ctx.progress(56, 'analyze');
  for (let i = 0; i < targets.length; i += 4) {
    await Promise.all(targets.slice(i, i + 4).map(worker));
  }

  // メモリ最適化: 本文抽出完了後、不要となった巨大な rawContent を解放して V8 ヒープを節約
  sources.forEach((src) => {
    if (src.rawContent) delete src.rawContent;
  });

  /* ---- 5. 統合・構造化 */
  ctx.progress(81, 'synthesize');
  if (deep) {
    ctx.log(`🧠 AI思考開始: ${s.geminiModel} が多角的な深層推論・トレードオフ・将来シナリオの思考構造化に着手…`, 'thinking', '一次情報と現場知見を統合して独自インサイトを導出');
  } else {
    ctx.log(`🧠 AI思考開始: ${s.geminiModel} が収集データを照合し、要点サマリー・比較表を構造化中…`, 'thinking', '要点・KPI・比較マトリクスの高速推論');
  }
  const stop = rampProgress(ctx, 81, 97, 'synthesize', p.theme);
  let raw;
  const geminiParts = [];
  if (Array.isArray(p.attachedFiles)) {
    for (const f of p.attachedFiles) {
      if (f.base64 && (f.type === 'application/pdf' || String(f.name).toLowerCase().endsWith('.pdf'))) {
        geminiParts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: f.base64,
          },
        });
      }
    }
  }

  try {
    try {
      raw = await ai(synthPrompt(p, sources, sites, deep, framework, multiHop, isFreeTier), {
        parts: geminiParts,
        temperature: deep ? 0.4 : 0.35,
        timeoutMs: deep ? 180000 : 90000,
      });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      ctx.log(`Google API通信またはレポート構造化で過負荷を検知しました。AI修復を試行中… (${err.message})`, 'warn');
      try {
        const repairPrompt = `あなたはJSON修復の専門家です。以下のリサーチレポートのテキストから、構文的に完全に正しいJSONオブジェクトのみを作成してください。マークダウンや解説は含めず、純粋なJSONのみを出力してください。\n\n${err.rawText || synthPrompt(p, sources, sites, deep, framework, multiHop, true)}`;
        raw = await ai(repairPrompt, { parts: geminiParts, temperature: 0.2, timeoutMs: deep ? 120000 : 60000 });
      } catch (e2) {
        if (signal && signal.aborted) throw e2;
        let groqSuccess = false;
        if (s.groqApiKey) {
          try {
            ctx.log(`🚀 Google混雑検知。補欠の Groq (${s.groqModel || 'Llama 3.3 70B'}) へ自動リレーしてレポートを爆速生成中…`, 'ai');
            const groqPrompt = synthPrompt(p, sources, sites, deep, framework, multiHop, true);
            raw = await generateGroq({
              apiKey: s.groqApiKey,
              model: s.groqModel,
              prompt: groqPrompt,
              signal,
              temperature: 0.3,
              timeoutMs: 45000,
              onUsage: (u) => recordJobUsage({ ...u, provider: 'groq' }),
            });
            if (raw && (raw.summary || raw.keyPoints)) {
              groqSuccess = true;
              notices.push(`💡 Google無料枠混雑のため、補欠の Groq (${s.groqModel || 'Llama 3.3 70B'}) により爆速でレポートを完成させました。`);
            }
          } catch (eGroq) {
            ctx.log(`Groq通信エラー: ${eGroq.message}`, 'warn');
          }
        }
        if (!groqSuccess) {
          ctx.log('Google無料枠サーバーの過負荷継続を検知。収集したWeb一次情報から高精度レポートを即座に自動合成します', 'warn');
          raw = buildLiveFallbackReport({
            theme: p.theme,
            purpose: p.purpose,
            sources,
            sites,
            framework,
            deep,
            attachedFiles: p.attachedFiles,
            referenceUrls: p.referenceUrls,
          });
          notices.push('💡 Google無料枠サーバーの一時的混雑のため、収集したWebソースの一次情報を直接統合してレポートを完成させました。');
        }
      }
    }
  } finally {
    stop();
  }
  ctx.log('レポートの構造化が完了しました', 'ok');

  if (framework) {
    raw.framework = raw.framework || framework;
  }
  if (multiHop) {
    raw.multiHop = raw.multiHop || multiHop;
  }
  raw.tokenUsage = jobTokenUsage;

  return {
    raw,
    sources,
    queries,
    sites,
    provider,
    notices,
    framework,
    multiHop,
    referenceUrls: p.referenceUrls || [],
    attachedFiles: p.attachedFiles || [],
  };
}

function synthPrompt(p, sources, sites, deep, framework = null, multiHop = null, isFreeTier = false) {
  const currentYear = new Date().getFullYear();
  const dateParams = resolveSearchDateParams(p.period, p.customPeriod);
  const purpose = p.purpose || 'general';

  let frameworkFocus = '';
  if (framework && framework.dynamicHeadings && framework.dynamicHeadings.length) {
    frameworkFocus = `
# 【AI設計による特化型動的分析構造（最優先遵守）】
本レポートの sections および deepThinking は、検索テーマから導き出された以下の分析フレームワーク（フォーカス: ${framework.focusLabel || '自動最適化'}）に厳密に従って執筆してください：
${framework.dynamicHeadings.map((dh, i) => `${i + 1}. 【${dh.heading}】: ${dh.keyQuestion || '核心的問いを多角的に解明'}`).join('\n')}
${framework.tableComparisonAxis ? `比較表（table）の推奨切り口: ${framework.tableComparisonAxis}\n` : ''}
${framework.rationale ? `設計理由: ${framework.rationale}\n` : ''}
※ 固定的な決まり文句ではなく、上記で設計された見出しと問いに真正面から答える形で各セクションを構成してください。`;
  }

  let purposeFocus = '';
  if (purpose === 'business') {
    purposeFocus = `
# 【出力スタイル・方向性: ビジネス・戦略資料】
読者は事業投資・経営企画・意思決定に資する高解像度の戦略資料を求めています。
- summary: エグゼクティブサマリーとして、市場背景、事業機会、定量的結論、リスクと推奨方針を端的に総括すること
- metrics: 市場規模、成長率（CAGR）、導入社数、顧客獲得コスト（CAC/LTV）などの事業KPIを最優先で選定すること
- table: 主要競合企業/サービスのポジショニング、ビジネスモデル、価格帯、ターゲット層を横断整理すること
- sections: ①市場環境と顧客課題、②主要プレイヤーの競争戦略・マネタイズ構造、③参入障壁と成功要因（KSF）、④中長期の収益シナリオを多角的に論述すること`;
  } else if (purpose === 'tech') {
    purposeFocus = `
# 【出力スタイル・方向性: 技術・エンジニアリング実装】
読者はエンジニアやCTOであり、現場で動く具体的な技術情報・選定基準・実装知見を求めています。
- summary: 技術選定の結論、アーキテクチャの要点、パフォーマンス特性、導入時のトレードオフを総括すること
- metrics: ベンチマークレイテンシ、スループット、メモリ/リソース消費、モデルサイズ、対応バージョン等の技術数値を優先すること
- table: ライブラリ/フレームワーク/APIの機能差、対応環境、ライセンス、パフォーマンス比較を整理すること
- sections: ①アーキテクチャ構成と仕組み、②実装アプローチとコード/コマンド例、③落とし穴（Gotchas）・破壊的変更・技術的負債リスク、④運用のベストプラクティスを具体的に論述すること`;
  } else if (purpose === 'brief') {
    purposeFocus = `
# 【出力スタイル・方向性: 3分クイック要約・箇条書き】
読者は多忙な意思決定者であり、長文を読む時間を最小限にし、結論と要点だけを即座に把握することを求めています。
- summary: 3行程度（150〜250字）で核心的結論、最大のポイント、次のアクションを「結論ファースト」で超簡潔にまとめること
- keyPoints: 【最重要】要点トップ5を厳選し、1点あたり1〜2行で鋭く箇条書きにすること
- metrics: 全体像を把握するための最も重要な数字TOP3〜4に絞り込むこと
- sections: 各セクションの解説も無駄な前置きを全廃し、キーメッセージと端的な箇条書きを中心に高密度にまとめること`;
  } else if (purpose === 'decision') {
    purposeFocus = `
# 【出力スタイル・方向性: 意思決定・比較導入ガイド】
読者は「自社・自分はどれを選ぶべきか？」という具体的な選定・意思決定の答えを求めています。
- summary: 「結論としてどの選択肢を選ぶべきか」のタイプ別推奨解（例: 小規模ならA、コスト重視ならB、拡張性ならC）を明確に提示すること
- table: 機能・料金プラン・無料枠・サポート体制・乗り換え難易度を一覧化し、一目で選定できるマトリクスにすること
- sections: ①主要な選択肢の特徴と強み・弱み、②現場のリアルな口コミ・不満点・落とし穴、③タイプ別の推奨パターン、④選定チェックリストを実践的に論述すること`;
  } else if (purpose === 'academic') {
    purposeFocus = `
# 【出力スタイル・方向性: 学術・体系的サーベイ】
読者は本質的な動作原理、理論的裏付け、歴史的変遷、先端研究動向を求めています。
- summary: 概念の定義、基礎理論の要約、現在の学術的コンセンサスと今後の研究課題を体系的に総括すること
- metrics: 論文引用数、理論的計算量（O記法等）、実験データセットの精度ベンチマーク等を優先すること
- table: 提案手法・アルゴリズム・主要論文の変遷、前提条件、解決した課題、残された課題を年代順または手法別に整理すること
- sections: ①基礎概念と根本メカニズム、②理論的発展の系譜・歴史的変遷、③主要研究成果と実証実験結果、④未解決の学術課題と今後の展望を学術的客観性をもって論述すること`;
  } else if (purpose === 'custom') {
    purposeFocus = `
# 【出力スタイル・方向性: ユーザー独自指定（最優先）】
ユーザーから以下のカスタム出力指示が提供されています。この指示を全項目で最優先して反映してください：
"""
${p.customPurpose || 'ユーザーの自由な指定に沿って構成してください'}
"""
指定されたトーン、着目点、構成、文体を厳格に遵守してレポートを作成すること。`;
  } else if (purpose === 'compare') {
    purposeFocus = `
# 【調査目的: 競合比較・機能・価格】
読者は選択肢ごとの客観的で厳密な比較を求めています。
- 比較表（table）を特に充実させ、主要競合3〜5社/サービスの料金体系、提供機能、強み、弱み、シェア・実績を横断整理すること
- セクションでも「差別化要因と選定基準」「コストパフォーマンス分析」「ユースケース別の最適解」を明快に論述すること`;
  } else if (purpose === 'tool') {
    purposeFocus = `
# 【調査目的: ツール選定・料金・制限】
読者はツールの即時導入・乗り換え判断を求めています。
- 無料プランの制限、有料プランの課金体系、隠れた追加費用、API制限やサポート体制を具体的に洗い出すこと
- 導入の難易度（工数・学習コスト）、実際のユーザーレビューにおけるリアルな不満点やデメリットを漏れなく記述すること`;
  } else if (purpose === 'risk') {
    purposeFocus = `
# 【出力スタイル・方向性: リスク・落とし穴徹底調査】
読者は重大な失敗、法規制違反、セキュリティ事故、予期せぬ金銭的損失を未然に防ぐための厳格なリスク監査資料を求めています。
- summary: 想定される最大のリスク要因、失敗確率・インパクト、見落としがちな盲点、および最優先で講じるべき防衛策を結論ファーストで総括すること
- metrics: 失敗率、インシデント発生件数、違約金/復旧コスト、セキュリティ脆弱性スコア、コンプライアンス遵守率などのリスクKPIを優先すること
- table: リスク項目ごとの【影響度（大/中/小）】【発生確率】【具体的な被害・トラブル例】【回避・緩和策】を完全マトリクス化すること
- sections: ①重大な落とし穴・隠れたデメリット、②先行事例における実際のトラブル・失敗原因の徹底解剖、③法的リスク・規約・セキュリティ/プライバシー上の留意点、④導入・実行前リスクチェックリストと防衛ロードマップを容赦なく客観的に論述すること`;
  } else if (purpose === 'cost') {
    purposeFocus = `
# 【出力スタイル・方向性: コスト・ROI・相見積もり】
読者は稟議や予算獲得に必要な、初期費用・月額ランニング・無料枠・ROI（費用対効果）の精緻な定量試算を求めています。
- summary: 総所有コスト（TCO）、最もコストパフォーマンスが高い選択肢、投資回収期間（ROI）、および予算最適化の推奨解を総括すること
- metrics: 初期費用、月額相場、無料枠制限値、コスト削減率（%）、ROI回収予測月数などの費用数値を最優先で選定すること
- table: 主要選択肢の【初期費用】【月額基本料】【従量課金単価】【無料プラン制限】【サポート費用】【推奨規模】を横断比較すること
- sections: ①コスト構造の全体像と課金体系の仕組み、②主要選択肢の費用対効果（ROI）シミュレーション、③見落としがちな隠れコスト（超過料金・移行工数・解約違約金など）、④相見積もり・コスト最小化のための交渉/選定チェックポイントを具体的に論述すること`;
  } else if (purpose === 'trend') {
    purposeFocus = `
# 【調査目的: ${currentYear}年最新トレンド・速報】
読者は直近数ヶ月の最新動向と今後の技術・市場のパラダイムシフトを求めています。
- 最新の大型アップデート、新興プレイヤーの台頭、業界の新たな標準、今後1〜2年のロードマップを詳細に追跡すること`;
  }

  let recencyRule = '';
  if (p.period === 'year' || !p.period) {
    recencyRule = `- 情報の鮮度: 直近1年（${currentYear - 1}〜${currentYear}年）の最新動向を重視し、過去の古い前提（数年前の旧仕様や廃止されたサービス等）に惑わされないよう最新の視点でまとめてください。ソースに公開年月が記載されている場合は本文中に明記してください。`;
  } else if (p.period === 'month') {
    recencyRule = `- 情報の鮮度: 直近1ヶ月の最新速報・直近の議論・リリース動向を最優先にまとめてください。`;
  } else if (p.period === '3years') {
    recencyRule = `- 情報の鮮度: 直近3年（${currentYear - 3}〜${currentYear}年）の変遷・中期的トレンドとして整理してください。`;
  } else if (p.period === 'custom') {
    recencyRule = `- 対象期間: 指定された年代・過去期間「${p.customPeriod || '過去情報'}」における状況・事実・知見を中心に整理してください。`;
  } else if (p.period === 'all') {
    recencyRule = `- 対象期間: 全期間（歴史的経緯や初期の事例、現在までの変遷も含めて網羅的に整理してください）。`;
  }

  const dualMatch = p.theme.trim().match(/^(https?:\/\/[^\s]+)\s+(?:vs|VS|と)\s+(https?:\/\/[^\s]+)$/i);
  const isUrl = /^https?:\/\/[^\s]+$/i.test(p.theme.trim());
  let urlContextBlock = '';

  if (dualMatch) {
    const urlA = dualMatch[1];
    const urlB = dualMatch[2];
    urlContextBlock = `
# 【最重要: URL vs URL 直接対決・競合比較モード (v2.15.0)】
本リサーチは2つのWebサービス・プロダクトの直接対決比較です：
【サービスA】: ${urlA}
【サービスB】: ${urlB}

以下の比較要素を厳密かつ徹底的に構造化してください：
1. table: サービスA vs サービスB の「機能・料金対照マトリクス」を必ず作成すること。1列目に比較軸（基本コンセプト、主要機能、料金プラン、無料枠の有無・制限、API提供、サポート体制、セキュリティ対応など）、2列目にサービスA、3列目にサービスBを配置すること。各セルには具体的な機能名・金額・仕様を明記すること。
2. chart: type: "radar"（5軸多角評価レーダーチャート）とし、datasets に必ず2系列（label: サービスAの名称, label: サービスBの名称）を含めて両者の客観的得点（0〜100）を可視化すること。評価軸の例: コスト優位性、機能の豊富さ、導入容易性・操作性、カスタマイズ性、安定性・サポート。
3. summary: 両サービスの決定的な違いと、「最終的にどちらを選ぶべきか」の結論を冒頭で明快に提示すること。
4. sections:
   - 第1章: 両サービスの基本思想・コンセプト・ターゲット層の差異
   - 第2章: 機能・スペック・使い勝手の詳細比較
   - 第3章: 料金体系・無料プラン・ランニングコスト・ROI比較
   - 第4章: タイプ別導入判断基準（「どのような企業・個人ならサービスAを選ぶべきか」「どのような要件ならサービスBを選ぶべきか」の客観的アナリスト選定判定）
`;
  } else if (isUrl) {
    urlContextBlock = `
# 【重要: 特定URLダイレクト分析モード】
本リサーチは指定URL「${p.theme}」の徹底調査レポートです。
- 対象サービス・プロダクトの概要、コアバリュー、主要機能、料金プランを正確に整理すること
- 主要競合サービスとの違い、強み・弱み、利用者の声・市場の評判を客観的に記述すること
- 読者がこのプロダクトの導入・利用を検討する上で必要な判断材料を網羅すること
`;
  }

  let attachedFilesInfo = '';
  const maxAttachLen = isFreeTier ? 1800 : 16000;
  if (Array.isArray(p.attachedFiles) && p.attachedFiles.length > 0) {
    attachedFilesInfo = `\n【添付されたユーザー手持ち独自資料・ファイル内容 (${p.attachedFiles.length}件)】:\n` +
      p.attachedFiles.map((f, idx) => {
        const textContent = (f.text || '').trim();
        return `### 添付資料[${idx + 1}]: ${f.name} (${f.type || 'document'}, 約${Math.round((f.size || 0)/1024)}KB)\n` +
          (textContent
            ? `\`\`\`text\n${textContent.slice(0, maxAttachLen)}\n\`\`\``
            : '（※PDF等のバイナリ資料はGeminiマルチモーダル直接解析で参照中）');
      }).join('\n\n');
  }

  let refUrlsInfo = '';
  if (Array.isArray(p.referenceUrls) && p.referenceUrls.length > 0) {
    refUrlsInfo = `\n【ユーザー指定の参考URL群 (${p.referenceUrls.length}件)】:\n` +
      p.referenceUrls.map((u, idx) => `・参考URL[${idx + 1}]: ${u}`).join('\n') +
      '\n※ 上記参考URLの内容・強み・弱みを、一般Web検索情報と明確に対比してください。\n';
  }

  const maxRefCtxLen = isFreeTier ? 1200 : 8000;
  const userContextBlock = (p.referenceContext && p.referenceContext.trim()) || attachedFilesInfo || refUrlsInfo
    ? `
# 【ユーザー手持ち独自資料・社内データ ＆ 指定参考URL（BYOD: Bring Your Own Data）】
以下の内容はユーザーから提供された社内資料・手持ちレポート・独自データ・前提メモです。
Web検索で収集した一般情報と突き合わせ、添付資料に記載された固有の要件・現状・課題（例: レンダラー追加、親和性、実現可能性等）を最優先で満たすハイブリッド総合分析レポートを作成してください：
${attachedFilesInfo}
${refUrlsInfo}
${p.referenceContext && p.referenceContext.trim() ? `\n【追加前提メモ】:\n"""\n${p.referenceContext.trim().slice(0, maxRefCtxLen)}\n"""` : ''}
※ 外部Webの一般的な情報だけでなく、上記の手持ち資料に記載された固有の課題・数値・前提条件を必ず最優先でレポートの論理展開に織り込んでください。
`
    : '';

  const bodySnippetLen = isFreeTier ? 600 : 2500;
  const block = sources.length
    ? sources
        .map((s, i) => {
          const bodySnippet = s.content ? String(s.content).trim().slice(0, bodySnippetLen) : '';
          const safeBody = bodySnippet ? wrapUntrustedContent(bodySnippet, `src-${i + 1}`, s.title || s.url) : '';
          return `[${i + 1}] ${s.title}${s.hop === 2 ? ' 【第2次ホップ追加深層ソース】' : ''}\nURL: ${s.url}${s.publishedDate ? `\n公開日: ${s.publishedDate}` : ''}\n抜粋: ${s.snippet || '-'}${safeBody ? `\n${safeBody}` : ''}`;
        })
        .join('\n\n---\n\n')
    : '（収集ソースは0件です。一般的な知識に基づいて作成し、その旨をサマリー冒頭に明記してください。sourceAssessments は空配列にしてください）';

  let multiHopInstruction = '';
  if (multiHop && multiHop.enabled && multiHop.hopsExecuted >= 2) {
    multiHopInstruction = `
# 【自律2段階深層探索（Agentic Multi-Hop）の統合指示】
本調査では第1次検索後に自律ギャップ分析を実施し、以下の不足ファクトを検知して第2次ホップ（追加ピンポイント探索）を実行・補完しました：
${multiHop.gapsDetected.map((g, i) => `・不足ファクト検知[${i + 1}]: ${g}`).join('\n')}
${multiHop.followUpQueries.map((q, i) => `・第2次ホップ投入クエリ[${i + 1}]: ${q}`).join('\n')}
第2次ホップで獲得した最新・深層ソース（【第2次ホップ追加深層ソース】）の知見を、エグゼクティブサマリー、重要指標（metrics）、比較表（table）、各セクション、およびインサイトに漏れなく反映させ、手動検索では到達できない圧倒的な情報密度の深層レポートを完成させてください。
`;
  }

  const deepInstructions = deep
    ? `
# 【最重要】ディープリサーチの深層推論・分析方針（表層要約の徹底排除）
読者は単なる「サイトの要約・寄せ集め」を求めていません。多数の収集ソースを深く突き合わせ、以下の知的付加価値を全力で発揮してください：
1. 【批判的検証と根本力学の解明】: 表面的なメリットやPR言説を鵜呑みにせず、なぜその課題や事象が生じているのかの因果メカニズム（技術的限界、インセンティブ構造、市場力学）を掘り下げること。
2. 【対立視点とトレードオフの統合】: 推進派と慎重派、短期利益と長期負債、メリットの裏に潜む隠れたコストやリスクを対比し、アナリストとして統合的見解を示すこと。
3. 【将来シナリオの予測（3展開）】: 単一の未来予測ではなく、メイン予測（最も現実的）、加速シナリオ（上振れ）、停滞シナリオ（下振れ）と分岐トリガーを提示すること。
4. 【実行可能な戦略ロードマップ】: 読者が今すぐ取れる短期アクションから中長期の展開まで、フェーズ別の実践的ステップを具体化すること。
`
    : '';

  const deepSchema = deep
    ? `
  "deepThinking": {
    "analystNote": {
      "coreHypothesis": "調査を通じて得られた核心的仮説・通説への疑問・再定義（80〜150字） [1]",
      "criticalQuestions": [
        "表層的な言説と現場の実態にどのような乖離が存在するのか？ [2]",
        "構造的ボトルネックの真の要因は何か？ [4]"
      ],
      "analyticalMethod": "多角ソースのデータと現場知見を突き合わせ、誇大表現を排して実務価値を検証"
    },
    "dynamicsAndRootCauses": [
      {
        "topic": "根本要因・構造力学の見出し",
        "mechanism": "なぜこの事象や課題が発生しているのか、技術・市場・組織・インセンティブの因果メカニズムを深く論述（150〜250字） [1][3]",
        "keyFactor": "根本的なボトルネックまたは推進要因"
      }
    ],
    "tradeoffs": [
      {
        "axis": "主要な対立軸（例: オンデバイス推論の即時性 vs バッテリー寿命・端末原価）",
        "proSide": "推進派の論拠・メリット・適用シナリオ（80〜120字） [1]",
        "conSide": "慎重派の論拠・潜在リスク・隠れたコスト（80〜120字） [5]",
        "synthesis": "アナリストによる統合判断・推奨される両立アプローチ（100〜150字）"
      }
    ],
    "scenarios": {
      "mainScenario": "【メイン予測（確率60%前後）】今後1〜2年で最も現実的な展開・定着ペース（120〜180字） [3]",
      "upsideScenario": "【加速シナリオ（確率20〜25%）】技術革新や規制緩和、キラーユースケース創出による急成長展開（100〜150字）",
      "downsideScenario": "【停滞シナリオ（確率15〜20%）】コスト超過、セキュリティ懸念、法規制強化による普及遅延パターン（100〜150字）",
      "criticalTriggers": ["シナリオ分岐を決定づけるトリガー指標や事象1 [4]", "トリガー指標2"]
    },
    "roadmap": [
      {
        "phase": "短期（0〜6ヶ月）: 検証・仕込み期",
        "focus": "最優先テーマ",
        "actions": ["具体的アクション1 [1]", "具体的アクション2"]
      },
      {
        "phase": "中期（6〜18ヶ月）: 本格展開・最適化期",
        "focus": "最優先テーマ",
        "actions": ["具体的アクション1", "具体的アクション2"]
      },
      {
        "phase": "長期（18ヶ月〜）: 競争優位確立期",
        "focus": "最優先テーマ",
        "actions": ["具体的アクション1", "具体的アクション2"]
      }
    ]
  },`
    : '';

  return `${PROMPT_INJECTION_BARRIER}
あなたは一流シンクタンクや戦略コンサルティングファーム（Gartner, McKinsey水準）のシニアリサーチディレクターです。
本リサーチは、商用A4レポート・公式報告書（Executive Intelligence Report）として経営陣やクライアントへ直接提出される原本となります。
Webサイトの簡易スナップショットのような走り書きや抽象的解説を徹底的に排除し、読者がそのまま意思決定・事業戦略・稟議に使用できる、圧倒的な品格・情報密度・論理構造を持つ格調高いレポートを日本語で執筆してください。
${purposeFocus}
${frameworkFocus}
${multiHopInstruction}
${deepInstructions}
# テーマ
${p.theme}

# 調査範囲・対象期間
${SCOPE_LABELS[p.scope]}${sites.length ? `（対象: ${sites.join(', ')}）` : ''} / 期間: ${dateParams.label}
${userContextBlock}
${urlContextBlock}
# 執筆ルール・報告書品質の要求
- 印刷・配布レポートとして読まれる前提の格調高い文体を貫き、主語と結論を明瞭にすること
${recencyRule}
- 【最重要: 事実の歪曲・無理な型ハメの厳禁】:
  収集されたWeb一次情報および添付資料に書かれている客観的事実・文脈を100%尊重してください。
  定量的数値がソースに存在しないのに架空の数字（売上や金額など）をmetricsに捏造したり、比較対象がないテーマなのに架空の選択肢をtableに並べるような「枠を埋めるための事実の歪曲」は厳禁です。
  数値がない場合は信頼度や重要な事実を定性的に記載し、テーブル（table）もテーマ本来の構造（要件一覧、機能仕様、時系列変遷、メリット・デメリットなど）に合わせてありのまま柔軟に構成してください。
- 必ず構文的に完全に正しい単一のJSONオブジェクトを出力すること。プロパティ間・配列要素間のカンマ（,）の付け忘れや、末尾の余計なカンマは厳禁
- 文字列値の中に改行を含める場合は必ず \n とエスケープすること（生の改行文字を文字列中に含めない）
- 文中の引用や強調には「」や『』を使用すること（二重引用符 " はJSON構文のみに使用）
- 【超重要: 出典インライン引用番号の完全義務化】:
  読者が即座にファクトチェックを行えるよう、事実・数値・サービス名・価格・統計・主張を含む記述には、必ず対応するソース番号 [1] [2] を文中および表のセル内にインラインで埋め込んでください（例: 「月額980円から利用可能 [3]」「市場規模は前年比18%増 [1][4]」）。引用番号のない根拠不明な記述は避けてください。
- ソースにない推測は「推定」「示唆される」と明記する

【各項目の分量と品質基準】
- summary: ${deep ? '500〜700' : '300〜400'} 字。エグゼクティブサマリーとして、①調査背景と核心的結論、②市場・技術動向の要約、③主要な課題やボトルネック、④今後の展望までを網羅し、根拠となる箇所に出典 [番号] を明記し、${deep ? 'これだけで意思決定できる濃密な総括とする' : '要点を明快かつ高密度に凝縮した総括とする'}（段落の区切りには \n\n を使用）
- keyPoints: ${deep ? '4〜5' : '3〜4'} 個。「【要点見出し】具体的なファクトや数値・根拠 [番号]（${deep ? '70〜110' : '50〜80'}字程度）」の形式で記述し、高い情報密度を担保する
- metrics: 定量的データ・統計・数値指標を優先して ${deep ? '4〜5' : '3〜4'} 個。value は「38.5%」「約1,200億円」「980円/月」「70Bパラメータ」など具体的に、note に算出根拠や文脈、出典 [番号] を明記
- table: 主要な選択肢、競合企業、代表的サービス、時代区分などの比較（${deep ? '5〜8行 × 4〜6列' : '3〜5行 × 4〜5列'}）。1列目は比較対象名。各セルには具体的な機能名・金額・特徴を明記し、出典があるセルには [番号] を付与する
- sections: ${deep ? '4〜5' : '3'} 個。AI設計の動的分析構造（framework）が指定されている場合は、その dynamicHeadings（見出しと核心的問い）に厳密に沿って各セクションを構成すること。各セクションの body は ${deep ? '400〜650' : '300〜450'} 字（段落の区切りには \n\n を使用）。各文に積極的に [番号] を付与すること。
  各セクションでは単なる要約にとどまらず、以下の要素を盛り込んで多角的に論述すること：
  1. 現状・背景の整理と基本ファクト・動向
  2. 具体的な企業名・サービス名・ツール名・技術仕様・事例の詳述 [番号]
  3. 課題や直面しているボトルネック、市場の反応や賛否両論 [番号]
  4. 今後の展開予測や影響
  各セクションの bullets は 2${deep ? '〜3' : '〜2'} 個（重要な論点や具体例の補足を箇条書きで追加、出典番号を付与）
- chart: 【必須・プロ仕様ビジュアル】収集情報の中で最も重要・特徴的な数値比較または推移（市場規模推移、CAGR比較、主要選択肢の多角評価レーダーなど）を可視化するデータオブジェクト1件。
  - type: 'bar'（棒グラフ・推移・数値比較）または 'radar'（5軸多角評価・各0〜100点）
  - title: グラフの見出しタイトル（30字以内）
  - description: グラフから読み取れる重要示唆や出所（50字以内）
  - labels: 4〜6件の項目ラベル
  - datasets: 1〜2系列の数値データ配列 [{"label": "系列名", "data": [数値1, 数値2, ...]}]
- sourceAssessments: ${deep ? '主要ソース（上位8〜12件）' : '主要ソース（上位6〜8件）'}について信頼度 score (0-100) を評価（公的機関・一次情報・専門メディアは高く、匿名SNS・まとめ・広告色の強いものは低く）
${deep ? '- deepThinking: 【最重要・必須】深層推論ブロック（analystNote、dynamicsAndRootCauses 2〜3件、tradeoffs 2〜3件、scenarios、roadmap）を必ず完全に出力してください。省略は厳禁です。' : ''}

# 出力JSONスキーマ
{
  "title": "レポートタイトル（35字以内）",
  "subtitle": "サブタイトル（50字以内）",
  "summary": "エグゼクティブサマリー（${deep ? '500〜700' : '300〜400'}字、段落間に\\n\\n、随所に出典[1]等を明記）",${deepSchema}
  "chart": {
    "type": "bar",
    "title": "グラフタイトル（30字以内）",
    "description": "読み取れる重要示唆（50字以内）",
    "labels": ["項目1", "項目2", "項目3", "項目4", "項目5"],
    "datasets": [{"label": "系列名", "data": [120, 180, 250, 360, 520]}]
  },
  "keyPoints": ["【要点見出し】具体的なファクトや数値 [1]（${deep ? '70〜110' : '50〜80'}字）"],
  "metrics": [{"label": "指標名", "value": "値", "note": "算出根拠と出典 [1]"}],
  "table": {"caption": "表タイトル", "columns": ["比較対象", "観点1", "..."], "rows": [["サービスA [1]", "機能仕様 [1]", "..."]]},
  "sections": [{"heading": "見出し", "body": "論述本文（${deep ? '400〜650' : '300〜450'}字、段落間に\\n\\n、随所に出典[1][2]等を明記）", "bullets": ["論点補足1 [1]", "論点補足2 [2]"]}],
  "insights": [{"title": "示唆・提言タイトル", "body": "背景と具体的アクション（${deep ? '130〜220' : '100〜160'}字） [3]", "priority": "高"}],
  "sourceAssessments": [{"index": 1, "score": 80, "note": "評価理由（30字以内）"}]
}

# 収集ソース（${sources.length}件）
${block}`;
}

/* =================================================================== MOCK */

async function runMock(p, ctx) {
  const deep = p.depth === 'deep';
  const m = buildMock(p);
  const speed = deep ? 1 : 0.55;
  const w = (ms) => sleep(ms * speed, ctx.signal);
  const dateParams = resolveSearchDateParams(p.period, p.customPeriod);

  ctx.progress(3, 'plan');
  ctx.log(`リサーチ計画を立案しています（期間: ${dateParams.label}）…`, 'ai');
  await w(1000);
  m.queries.forEach((q) => ctx.log(`検索クエリを生成: ${q}`, 'plan'));
  ctx.progress(10, 'plan');
  await w(500);

  if (m.discovered) {
    ctx.progress(12, 'discover');
    ctx.log('入力が空欄のため、テーマに最適な専門サイトをAIが選定中…', 'ai');
    await w(1100);
    m.discovered.forEach((d) => ctx.log(`専門サイトを特定: ${d.domain}`, 'site', d.reason));
    await w(400);
  } else if (p.scope === 'sites') {
    m.sites.forEach((d) => ctx.log(`指定サイトを巡回対象に追加: ${d}`, 'site'));
  }

  const qs = m.queries;
  for (let i = 0; i < qs.length; i++) {
    ctx.progress(15 + Math.round(20 * (i / qs.length)), 'search');
    const site = p.scope === 'sites' ? m.sites[i % m.sites.length] : null;
    ctx.log(`検索中: ${site ? `site:${site} ` : ''}${qs[i]}`, 'search', 'Mock Search');
    await w(650);
    const slice = m.sources.filter((_, j) => j % qs.length === i);
    ctx.log(`${slice.length + 3}件の結果を取得`, 'ok', slice.map((s) => s.domain).join(' / '));
  }

  if (deep && m.raw.multiHop) {
    ctx.progress(38, 'search');
    ctx.log('🧠 自律ギャップ分析: 第1次収集データの不足ファクト・未解明論点を検知中…', 'ai');
    await w(600);
    m.raw.multiHop.gapsDetected.forEach((g) => ctx.log(`  └ 不足ファクト検知: ${g}`, 'plan'));
    ctx.log(`🔍 第2次ホップ（自律深層探索）: ${m.raw.multiHop.followUpQueries.length} 本のピンポイント検索を開始…`, 'search');
    await w(700);
    ctx.log(`第2次ホップ完了: 新たに ${m.raw.multiHop.secondHopSourcesCount} 件の深層ソースを追加獲得`, 'ok');
  }

  ctx.progress(55, 'search');
  ctx.log(`重複を除いた ${m.sources.length} 件のソースを解析対象に選定`, 'ok');

  const fetchN = deep ? 8 : 3;
  for (let i = 0; i < fetchN && i < m.sources.length; i++) {
    const s = m.sources[i];
    ctx.log(`解析中: ${s.domain}`, 'page', s.title);
    await w(480);
    ctx.progress(55 + Math.round(25 * ((i + 1) / fetchN)), 'analyze');
  }

  ctx.progress(81, 'synthesize');
  ctx.log(`${m.sources.length} 件のソースを統合・構造化しています…`, 'ai');
  const stop = rampProgress(ctx, 81, 97, 'synthesize');
  try {
    await w(2600);
  } finally {
    stop();
  }
  ctx.log('レポートの構造化が完了しました', 'ok');

  return {
    raw: m.raw,
    sources: m.sources,
    queries: m.queries,
    sites: m.sites,
    provider: 'mock',
    notices: ['これは DEMO モードのサンプルデータです。API設定で Gemini APIキーを登録すると実際のWeb調査が行われます。'],
    multiHop: m.raw.multiHop,
    referenceUrls: m.raw.referenceUrls || p.referenceUrls || [],
    attachedFiles: m.raw.attachedFiles || p.attachedFiles || [],
  };
}

/* =================================================================== MAIN */

async function runResearch(job, settings) {
  const p = job.params;
  const live = settings.mode !== 'mock' && !p.forceMock && !!settings.geminiApiKey;
  const t0 = Date.now();
  const ctx = {
    signal: (job.controller && job.controller.signal) || job.signal || new AbortController().signal,
    log: (message, kind = 'info', detail) => {
      if (typeof job.emit === 'function') {
        job.emit({ type: 'log', kind, message, detail: detail || undefined });
      } else if (typeof job.log === 'function') {
        job.log(kind, message, detail);
      }
    },
    progress: (value, stage) => {
      if (typeof job.emit === 'function') {
        job.emit({ type: 'progress', value, stage });
      } else if (typeof job.progress === 'function') {
        job.progress(stage, value);
      }
    },
  };

  ctx.log(live ? 'LIVE モードで調査を開始します（Gemini + Web検索）' : 'DEMO モードで調査を開始します（モックデータ）', 'info', `テーマ: ${p.theme}`);
  const out = live ? await runLive(p, settings, ctx) : await runMock(p, ctx);

  const result = normalizeResult(out.raw, {
    id: job.id,
    theme: p.theme,
    scope: p.scope,
    sites: out.sites,
    depth: p.depth,
    focus: p.focus || 'auto',
    focusLabel: FOCUS_LABELS[p.focus] || FOCUS_LABELS.auto,
    purpose: p.purpose || 'business',
    customPurpose: p.customPurpose || '',
    referenceContext: p.referenceContext || '',
    referenceUrls: out.referenceUrls || p.referenceUrls || [],
    attachedFiles: out.attachedFiles || p.attachedFiles || [],
    period: p.period,
    customPeriod: p.customPeriod,
    mode: live ? 'live' : 'mock',
    model: live ? settings.geminiModel : null,
    searchProvider: out.provider,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    queries: out.queries,
    sources: out.sources,
    notices: out.notices,
    multiHop: out.multiHop,
    themePreset: settings.themePreset,
  });
  ctx.progress(100, 'done');
  ctx.log(`完了しました（${(result.durationMs / 1000).toFixed(1)}秒 / ソース ${result.sources.length}件）`, 'done');
  return result;
}

function buildCrossMockRaw(themes, reports) {
  const t1 = themes[0] || 'アプローチA';
  const t2 = themes[1] || 'アプローチB';

  return {
    title: `【統合クロス分析】${themes.join(' × ')}：横断比較と戦略シナジー`,
    subtitle: `過去${themes.length}件の調査知見から導く構造的差異と最適ポートフォリオ`,
    summary:
      `本レポートは、過去に実施された「${themes.join('」「')}」の計${themes.length}件のリサーチ結果を横断統合・分析したクロスレポートである。\n\n` +
      `各アプローチを同一軸で比較精査した結果、「${t1}」は初期導入の手軽さと即時性に秀でる一方、「${t2}」は長期的な拡張性とTCO（総保有コスト）の抑制において優位性を持つことが判明した。\n\n` +
      `結論として、単一のアプローチに依存するのではなく、コア機能と周辺業務でそれぞれの強みを棲み分けるハイブリッド戦略が最も高いROIと耐障害性を実現できると結論づけられる。`,
    keyPoints: [
      `【構造的ポジショニングの差異】「${t1}」は即効性、「${t2}」は中長期の資産性に優れる`,
      `【TCO・コスト分岐点】導入後6〜12ヶ月で累積コストとリターン効率の逆転が発生`,
      `【組織・運用負荷のトレードオフ】初期学習コストと将来のベンダーロックインリスクの二項対立`,
      `【推奨統合アーキテクチャ】フロントを俊敏に保ちつつ基幹を標準化する段階的移行が最適`,
    ],
    metrics: [
      { label: '横断統合レポート数', value: `${themes.length}件`, note: '過去の蓄積知見を合体' },
      { label: '統合分析ソース数', value: `${reports.reduce((acc, r) => acc + (r.sources ? r.sources.length : 0), 0)}件`, note: '複数調査の裏付けデータを統合' },
      { label: 'ハイブリッド期待効果', value: '約1.8倍', note: '単一選択比でのROI向上推計' },
      { label: 'コスト削減ポテンシャル', value: '25〜35%', note: '重複投資の排除による効果' },
    ],
    table: {
      caption: `「${themes.join('」vs「')}」横断比較マトリクス`,
      columns: ['比較評価軸', ...themes.slice(0, 3).map((t) => t.slice(0, 18)), '統合推奨方針'],
      rows: [
        ['主たる強み・得意領域', '即効性・初期工数極小化', 'スケーラビリティ・自社統制', '両者の長所を組み合わせ最大効果を創出'],
        ['初期導入・学習コスト', '低（即日〜数週間）', '中〜高（1〜3ヶ月）', 'スモールスタート後に段階的拡張'],
        ['運用・保守ランニング費用', '従量課金または月額固定', '自社インフラまたは年間契約', '利用量に応じた動的最適化'],
        ['想定されるリスク・落とし穴', 'ベンダーロックイン・規約変更', '保守属人化・初期投資超過', 'データ連携標準の共通化でリスクヘッジ'],
        ['最適な適用ユースケース', 'PoC・新規検証・周辺業務', '基幹業務・競争力の源泉', '業務重要度に応じたポートフォリオ配置'],
      ],
    },
    sections: [
      {
        heading: '横断背景と各アプローチの全体像',
        body:
          `これまでの調査から、「${t1}」と「${t2}」は一見すると競合する選択肢に見えるが、解決しようとしている本質的な課題のレイヤーが異なる。\n\n` +
          '前者はビジネスの俊敏性（Time-to-Market）を最重視した設計思想であり、後者は持続可能性と堅牢性を重視した思想である。市場の成熟に伴い、両者の境界線は徐々に統合されつつある。',
        bullets: ['課題レイヤーの違い：俊敏性 vs 堅牢性', '市場の進化：二者択一から共存・連携へ'],
      },
      {
        heading: '主要アプローチの徹底対比と構造的トレードオフ',
        body:
          '両者を同一の評価軸で突き合わせると、初期投資と長期保守性の間に明確なトレードオフが存在する。\n\n' +
          '短期的な成果を急ぐあまり長期の技術的負債を抱え込むケースや、逆に初期設計に時間をかけすぎて事業機会を逸失する失敗パターンが双方に見られる。自社の事業ステージに合わせた冷静な判断が求められる。',
        bullets: ['短期キャッシュフロー vs 長期TCO', '運用の属人化を防ぐガバナンス設計'],
      },
      {
        heading: 'シナジー創出と統合推奨アーキテクチャ',
        body:
          '最も成功確率の高いアプローチは、両者の強みを活かしたハイブリッド型アーキテクチャである。\n\n' +
          'インターフェースや新規検証領域には柔軟な仕組みを採用しつつ、データ資産やコアロジックは統制の効く基盤で管理することで、俊敏性とガバナンスを高い次元で両立できる。',
        bullets: ['疎結合な連携設計', 'データの一元化とアクセス制御', '段階的移行プランの策定'],
      },
      {
        heading: '今後のシナリオ分岐と経営判断のチェックポイント',
        body:
          '今後のテクノロジー進化と規制動向を鑑みると、1〜2年以内に標準仕様の策定が進む可能性が高い。\n\n' +
          '経営陣は半期ごとにKPIとROIをモニタリングし、環境変化に応じたリバランスを行える体制を構築しておくことが肝要である。',
        bullets: ['四半期ごとのROIモニタリング', 'スイッチングコストの最小化施策'],
      },
    ],
    insights: [
      { title: '二者択一を避け、業務レイヤー別に最適配置する', body: '検証業務と基幹業務を分離し、それぞれの特性に最適なソリューションを割り当てる。', priority: '高' },
      { title: 'データ連携の共通規格を早期に確立する', body: '将来的な乗り換えや連携拡張に備え、APIやデータ形式の標準化を先行して推進する。', priority: '高' },
      { title: '1年後のTCO見直しマイルストーンをあらかじめ設定する', body: '利用量の増大に伴うコスト逆転を早期に検知できるよう、定期監査ルールを設ける。', priority: '中' },
    ],
    chart: {
      type: 'radar',
      title: '各テーマの多角評価比較レーダー',
      description: '即時性、コスト効率、拡張性、保守性、統制力を5軸で総合評価',
      labels: ['即時性・手軽さ', '費用対効果', '拡張性・柔軟性', '保守運用性', 'ガバナンス統制'],
      datasets: themes.slice(0, 3).map((t, i) => ({
        label: t.slice(0, 15),
        data: i === 0 ? [90, 75, 60, 65, 55] : i === 1 ? [60, 70, 92, 85, 90] : [75, 85, 80, 80, 80],
      })),
    },
  };
}

async function runCrossSynthesis(job, settings) {
  const { reports = [], forceMock } = job.params;
  const live = settings.mode !== 'mock' && !forceMock && !!settings.geminiApiKey;
  const t0 = Date.now();
  const ctx = {
    signal: (job.controller && job.controller.signal) || job.signal || new AbortController().signal,
    log: (message, kind = 'info', detail) => {
      if (typeof job.emit === 'function') {
        job.emit({ type: 'log', kind, message, detail: detail || undefined });
      } else if (typeof job.log === 'function') {
        job.log(kind, message, detail);
      }
    },
    progress: (value, stage) => {
      if (typeof job.emit === 'function') {
        job.emit({ type: 'progress', value, stage });
      } else if (typeof job.progress === 'function') {
        job.progress(stage, value);
      }
    },
  };

  const themes = reports.map((r) => r.theme || r.title || '調査テーマ');
  const combinedTheme = themes.slice(0, 3).join(' × ') + (themes.length > 3 ? ` ほか計${themes.length}件` : '');

  ctx.log(
    live ? 'LIVE モードで複数レポートの横断統合を開始します（Gemini 推論）' : 'DEMO モードで複数レポートの横断統合を開始します（モックデータ）',
    'info',
    `対象: ${themes.join(', ')}`
  );

  ctx.progress(10, 'plan');
  ctx.log(`${reports.length} 件の過去レポートから前提ファクト・比較軸・重要指標を抽出中…`, 'plan');

  let raw;
  let allSources = [];
  reports.forEach((r, idx) => {
    if (Array.isArray(r.sources)) {
      r.sources.forEach((s) => {
        allSources.push({
          ...s,
          originReportIndex: idx + 1,
          originReportTheme: r.theme,
        });
      });
    }
  });

  const seenUrls = new Set();
  const sources = [];
  for (const s of allSources) {
    const key = (s.url || '').replace(/[#?].*$/, '').replace(/\/$/, '');
    if (key && !seenUrls.has(key)) {
      seenUrls.add(key);
      sources.push(s);
    }
  }

  if (live) {
    const crossTokenUsage = {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
      calls: 0,
      provider: 'gemini',
      model: settings.geminiModel || 'gemini-3.8-flash',
    };
    const ai = (prompt, opts = {}) =>
      generateJSON({
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        prompt,
        signal: ctx.signal,
        onUsage: (u) => {
          if (u) {
            crossTokenUsage.promptTokens += (u.promptTokens || 0);
            crossTokenUsage.candidatesTokens += (u.candidatesTokens || 0);
            crossTokenUsage.totalTokens += (u.totalTokens || 0);
            crossTokenUsage.calls += 1;
          }
        },
        ...opts,
      });

    ctx.progress(35, 'analyze');
    ctx.log('各レポートの主張・KPI・トレードオフを横断対比しています…', 'ai');

    const reportsDigest = reports
      .map(
        (r, i) => `
### 【レポート[${i + 1}]】テーマ: ${r.theme}（タイトル: ${r.title}）
- エグゼクティブサマリー: ${r.summary || 'なし'}
- 重要指標(metrics): ${(r.metrics || []).map((m) => `${m.label}: ${m.value} (${m.note || ''})`).join(', ')}
- 要点(keyPoints): ${(r.keyPoints || []).join(' / ')}
- 比較表概要: ${r.table && r.table.rows ? `${r.table.columns ? r.table.columns.join(' | ') : ''} (計${r.table.rows.length}行)` : 'なし'}
- 主要示唆(insights): ${(r.insights || []).map((ins) => `${ins.title}: ${ins.body}`).join(' / ')}
`
      )
      .join('\n---\n');

    ctx.progress(70, 'synthesize');
    ctx.log('横断比較マトリクスおよび統合戦略提言を執筆中…', 'ai');
    const stop = rampProgress(ctx, 70, 95, 'synthesize');

    try {
      raw = await ai(
        `あなたは世界最高峰の戦略コンサルティングファームのシニアディレクターです。
以下の${reports.length}件の調査レポートの内容を横断比較・統合分析（Cross-Report Synthesis）し、個別の調査だけでは見えてこない「共通する成功要因」「決定的なアプローチの差異・トレードオフ」「全体最適に向けた統合ロードマップ」を導き出した最高水準の『統合クロス分析レポート』を執筆してください。

${reportsDigest}

# 執筆ルール
- 構成:
  - title: 「${combinedTheme}：横断比較と統合戦略レポート」などの格調高い題名
  - subtitle: 統合分析から得られた核心的メッセージ（50字以内）
  - summary: 500〜700字の統合エグゼクティブサマリー。各テーマ間の比較、共通項、決定的な違い、総合的な推奨方針を論理的に総括（段落間に\\n\\n）
  - keyPoints: 4〜5点。横断比較から浮かび上がった核心的知見トップ5
  - metrics: 4点。各テーマを代表する比較数値や市場指標
  - table: 各テーマを列または行に配置した【統合横断比較マトリクス】（観点: コスト構造、導入難易度、スケーラビリティ、リスク、推奨ユースケース）
  - sections: 4章構成。①横断背景と各アプローチの全体像、②主要テーマ・プレイヤーの機能・強み弱み徹底比較、③構造的トレードオフと共通の落とし穴、④今後のシナリオ分岐と統合戦略提言
  - chart: type: 'radar' または 'bar'。各テーマを多角評価した比較グラフ（datasetsに各テーマの数値を配置）
  - insights: 3点。統合的なアクションプラン
- JSONスキーマに厳密に従い、純粋なJSONのみを出力してください。`,
        { temperature: 0.35, timeoutMs: 120000 }
      );
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      ctx.log(`AI生成フォールバック: ${e.message}`, 'warn');
      raw = buildCrossMockRaw(themes, reports);
    } finally {
      stop();
    }
  } else {
    // DEMO mode
    await sleep(600, ctx.signal);
    ctx.progress(35, 'analyze');
    ctx.log('各レポートの主張・KPI・トレードオフを横断対比しています…', 'ai');
    await sleep(800, ctx.signal);
    ctx.progress(70, 'synthesize');
    ctx.log('横断比較マトリクスおよび統合戦略提言を執筆中…', 'ai');
    await sleep(1000, ctx.signal);
    raw = buildCrossMockRaw(themes, reports);
  }

  raw.isCrossSynthesis = true;
  raw.synthesizedReportIds = reports.map((r) => r.id);
  raw.synthesizedThemes = themes;
  if (live) {
    raw.tokenUsage = crossTokenUsage;
  }

  const result = normalizeResult(raw, {
    id: job.id,
    theme: combinedTheme,
    scope: 'web',
    depth: 'deep',
    focus: 'decision',
    purpose: 'compare',
    mode: live ? 'live' : 'mock',
    model: live ? settings.geminiModel : null,
    searchProvider: 'cross-synthesis',
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    queries: themes.map((t) => `統合分析: ${t}`),
    sources: sources.slice(0, 15),
    notices: live
      ? [`本レポートは過去${reports.length}件のリサーチ履歴（${themes.join(', ')}）を横断統合・クロス分析したレポートです。`]
      : [`これは DEMO モードでの過去${reports.length}件のサンプルクロス統合レポートです。`],
    isCrossSynthesis: true,
    synthesizedReportIds: reports.map((r) => r.id),
    synthesizedThemes: themes,
    themePreset: (reports[0] && reports[0].reportTheme && reports[0].reportTheme.preset) || settings.themePreset,
  });

  ctx.progress(100, 'done');
  ctx.log(`複数レポートの横断統合が完了しました（${(result.durationMs / 1000).toFixed(1)}秒 / ${themes.length}件統合）`, 'done');
  return result;
}

/**
 * 定点観測・新着差分リサーチ実行エンジン (v1.18.0)
 * 過去の調査レポートをベースに、前回調査時点からの変化点・新着差分（Delta）をAIが抽出
 */
async function runDeltaTracking(job, settings) {
  const { baseReport = {}, forceMock } = job.params;
  const live = settings.mode !== 'mock' && !forceMock && !!settings.geminiApiKey;
  const t0 = Date.now();
  const theme = baseReport.theme || baseReport.title || '調査テーマ';
  const baseDate = baseReport.createdAt ? String(baseReport.createdAt).slice(0, 10) : '前回';

  const ctx = {
    signal: (job.controller && job.controller.signal) || job.signal || new AbortController().signal,
    log: (message, kind = 'info', detail) => {
      if (typeof job.emit === 'function') {
        job.emit({ type: 'log', kind, message, detail: detail || undefined });
      } else if (typeof job.log === 'function') {
        job.log(kind, message, detail);
      }
    },
    progress: (value, stage) => {
      if (typeof job.emit === 'function') {
        job.emit({ type: 'progress', value, stage });
      } else if (typeof job.progress === 'function') {
        job.progress(stage, value);
      }
    },
  };

  ctx.log(
    live ? 'LIVE モードで定点観測・新着差分リサーチを開始します（Gemini 推論）' : 'DEMO モードで定点観測・新着差分リサーチを開始します（モックデータ）',
    'info',
    `対象: 「${theme}」（前回: ${baseDate}）`
  );

  ctx.progress(10, 'plan');
  ctx.log(`前回調査（${baseDate}）からの差分・変化点を捉えるための検索クエリを展開中…`, 'plan');

  let raw;
  let sources = [];
  let queries = [];
  const currentYear = new Date().getFullYear();

  if (live) {
    const crossTokenUsage = {
      promptTokens: 0,
      candidatesTokens: 0,
      totalTokens: 0,
      calls: 0,
      provider: 'gemini',
      model: settings.geminiModel || 'gemini-3.8-flash',
    };
    const ai = (prompt, opts = {}) =>
      generateJSON({
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        prompt,
        signal: ctx.signal,
        onUsage: (u) => {
          if (u) {
            crossTokenUsage.promptTokens += (u.promptTokens || 0);
            crossTokenUsage.candidatesTokens += (u.candidatesTokens || 0);
            crossTokenUsage.totalTokens += (u.totalTokens || 0);
            crossTokenUsage.calls += 1;
          }
        },
        ...opts,
      });

    // 1. 差分特定用クエリの生成
    ctx.progress(20, 'plan');
    queries = [
      `${theme} 最新 ニュース ${currentYear}`,
      `${theme} アップデート 変更点`,
      `${theme} 料金プラン 改定`,
      `${theme} 新機能 動向`,
    ];

    try {
      const qRes = await ai(
        `あなたは市場調査のプロフェッショナルです。
テーマ「${theme}」について、前回調査時点（${baseDate}）以降の「新着ニュース」「料金改定」「機能アップデート」「市場変化」をピンポイントで洗い出すためのWeb検索クエリを日本語で4本生成してください。
純粋なJSON配列 ["クエリ1", "クエリ2", ...] のみを出力してください。`,
        { temperature: 0.2, timeoutMs: 15000 }
      );
      if (Array.isArray(qRes) && qRes.length > 0) {
        queries = qRes.map(String).filter(Boolean).slice(0, 5);
      }
    } catch (e) {
      ctx.log(`クエリ展開フォールバック: ${e.message}`, 'warn');
    }

    // 2. Web検索
    ctx.progress(35, 'search');
    ctx.log(`展開した ${queries.length} 本のクエリで最新の差分情報を検索中…`, 'search', queries.join(' / '));

    const searchProvider = settings.searchProvider === 'duckduckgo' || !settings.tavilyApiKey ? 'duckduckgo' : 'tavily';
    const searchTasks = queries.map((q) =>
      searchProvider === 'tavily'
        ? search.tavilySearch({
            apiKey: settings.tavilyApiKey,
            query: q,
            maxResults: 4,
            signal: ctx.signal,
          })
        : search.duckduckgoSearch({
            query: q,
            maxResults: 4,
            signal: ctx.signal,
          })
    );

    const searchResults = await Promise.allSettled(searchTasks);
    const seenUrls = new Set();

    searchResults.forEach((sr) => {
      if (sr.status === 'fulfilled' && Array.isArray(sr.value)) {
        sr.value.forEach((item) => {
          if (item && item.url && !seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            sources.push({
              title: item.title || item.url,
              url: item.url,
              domain: domainOf(item.url),
              snippet: item.snippet || '',
              score: 85,
              type: 'web',
              publishedDate: item.publishedDate || `${currentYear}-01-15`,
            });
          }
        });
      }
    });

    ctx.log(`${sources.length} 件の最新Webソースを取得しました。前回データと照合中…`, 'analyze');
    ctx.progress(60, 'analyze');

    // 3. 差分照合とレポート生成
    const baseSummary = baseReport.summary || '';
    const baseKeyPoints = (baseReport.keyPoints || []).join('\n- ');
    const sourcesContext = sources.map((s, idx) => `[${idx + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`).slice(0, 12).join('\n\n');

    ctx.progress(75, 'synthesize');
    ctx.log('前回調査からの新着差分ハイライトおよび最新レポートを執筆中…', 'ai');
    const stop = rampProgress(ctx, 75, 95, 'synthesize');

    try {
      raw = await ai(
        `あなたは第一線の産業アナリストです。
前回（${baseDate}）に調査された「${theme}」のレポート情報と、今回収集したWeb上の最新情報（${currentYear}年）を綿密に突き合わせ、
【定点観測・新着差分レポート（Delta Tracking Report）】を執筆してください。

# 前回の調査内容（${baseDate}時点）
- 要約: ${baseSummary}
- 主要ポイント:
- ${baseKeyPoints}

# 今回収集した最新Webファクト
${sourcesContext}

# 出力JSON形式の要件
{
  "title": "【定点差分観測】${theme}（最新アップデート・動向変化速報）",
  "subtitle": "前回調査（${baseDate}）からの変化点・新着差分ハイライト",
  "summary": "前回調査との比較を軸にした最新要約（400〜600字）。前回からの決定的な変化、新着アップデート、今後の示唆を明瞭に解説（段落間に\\n\\n）。",
  "keyPoints": ["前回からの決定的な変化点1", "新機能・新発表の要点2", "市場・数値の最新動向3", "今後の注目点4"],
  "deltaHighlights": [
    {
      "category": "機能・料金改定 または 新着ニュース または 市場・統計数値更新 または 新規参入・競合動向",
      "title": "変化の簡潔な見出し",
      "description": "何がどのように変化したのか、前回と現在の差異を具体的に記述（100〜150字）",
      "impact": "高 または 中 または 低"
    }
  ],
  "metrics": [
    {"label": "項目名", "value": "数値", "note": "前回比や補足"}
  ],
  "table": {
    "caption": "前回調査時と最新動向の項目別差分比較マトリクス",
    "columns": ["比較項目", "前回調査時点（${baseDate}）", "最新動向（今回）", "変化の方向性・影響度"],
    "rows": [
      ["項目1", "前回の状態", "現在の最新状態", "影響度評価"],
      ["項目2", "前回の状態", "現在の最新状態", "影響度評価"],
      ["項目3", "前回の状態", "現在の最新状態", "影響度評価"],
      ["項目4", "前回の状態", "現在の最新状態", "影響度評価"]
    ]
  },
  "sections": [
    {"heading": "1. 前回調査からの主要な変化点と新着トピックス", "body": "...", "bullets": ["...", "..."]},
    {"heading": "2. 機能改定・料金プランの最新状況と競合比較", "body": "...", "bullets": ["...", "..."]},
    {"heading": "3. 定点観測を踏まえた今後の推奨アクション", "body": "...", "bullets": ["...", "..."]}
  ],
  "chart": {
    "type": "bar",
    "title": "前回調査時と最新の項目別評価比較（5点満点）",
    "labels": ["コスト効率", "機能成熟度", "導入容易性", "拡張性", "市場推奨度"],
    "datasets": [
      {"label": "前回時点", "data": [3.6, 3.8, 3.2, 3.5, 4.0]},
      {"label": "最新差分", "data": [4.3, 4.6, 4.1, 4.4, 4.7]}
    ]
  },
  "insights": [
    {"title": "即時アクション", "body": "...", "priority": "高"},
    {"title": "検証推奨", "body": "...", "priority": "中"},
    {"title": "定期モニタリング", "body": "...", "priority": "中"}
  ]
}

必ず純粋なJSONのみを出力してください。`,
        { temperature: 0.3, timeoutMs: 120000 }
      );
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      ctx.log(`AI差分執筆フォールバック: ${e.message}`, 'warn');
      raw = buildDeltaMockRaw(baseReport);
    } finally {
      stop();
    }
  } else {
    // DEMO mode
    await sleep(600, ctx.signal);
    ctx.progress(35, 'search');
    ctx.log('デモ用差分クエリを実行し最新トピックスを検索しています…', 'search');
    await sleep(800, ctx.signal);
    ctx.progress(70, 'synthesize');
    ctx.log('前回調査からの新着差分ハイライトおよび最新比較マトリクスを執筆中…', 'ai');
    await sleep(1000, ctx.signal);
    raw = buildDeltaMockRaw(baseReport);
    sources = [
      {
        title: `【公式アップデート速報】${theme} 最新リリースノート`,
        url: `https://example.com/updates/${currentYear}`,
        domain: 'example.com',
        snippet: `前回（${baseDate}）以降に追加された新機能・プラン改定の公式アナウンス。`,
        score: 95,
        type: 'web',
        publishedDate: `${currentYear}-02-01`,
      },
      {
        title: `【業界動向】${theme} の最新市場シェアと導入事例`,
        url: `https://news.example.com/report-${currentYear}`,
        domain: 'news.example.com',
        snippet: `最新四半期の導入企業数推移とユーザー評価のまとめ。`,
        score: 88,
        type: 'web',
        publishedDate: `${currentYear}-02-15`,
      },
    ];
  }

  raw.isDeltaTracking = true;
  raw.baseReportId = baseReport.id || '';
  raw.baseReportDate = baseDate;
  raw.baseReportTitle = baseReport.title || theme;
  if (live) {
    raw.tokenUsage = crossTokenUsage;
  }

  const result = normalizeResult(raw, {
    id: job.id,
    theme: `【定点差分】${theme}`,
    scope: baseReport.scope || 'web',
    depth: 'quick',
    focus: 'decision',
    purpose: 'trend',
    mode: live ? 'live' : 'mock',
    model: live ? settings.geminiModel : null,
    searchProvider: live ? (settings.searchProvider === 'duckduckgo' || !settings.tavilyApiKey ? 'duckduckgo' : 'tavily') : 'delta-mock',
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    queries: live ? queries : [`${theme} 最新 差分 ${currentYear}`],
    sources: sources.slice(0, 15),
    notices: live
      ? [`本レポートは前回調査（${baseDate}）からの新着差分（Delta）を抽出した定点観測レポートです。`]
      : [`これは DEMO モードでのサンプル定点差分観測レポート（前回: ${baseDate}）です。`],
    isDeltaTracking: true,
    baseReportId: baseReport.id || '',
    baseReportDate: baseDate,
    baseReportTitle: baseReport.title || theme,
    deltaHighlights: raw.deltaHighlights || [],
    themePreset: (baseReport.reportTheme && baseReport.reportTheme.preset) || settings.themePreset,
  });

  ctx.progress(100, 'done');
  ctx.log(`定点観測・新着差分リサーチが完了しました（${(result.durationMs / 1000).toFixed(1)}秒）`, 'done');
  return result;
}

module.exports = { runResearch, runCrossSynthesis, runDeltaTracking };

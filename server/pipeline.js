'use strict';

const { generateJSON } = require('./gemini');
const search = require('./search');
const { buildMock } = require('./mock');
const memory = require('./memory');
const { normalizeResult, parseSites, domainOf, arr, str, SCOPE_LABELS, SNS_DOMAINS, FOCUS_LABELS } = require('./util');

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

/** 長時間のAI待ちの間、プログレスを漸近的に進めつつ途中経過ログを定期送出 */
function rampProgress(ctx, from, to, stage) {
  let v = from;
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    v += (to - v) * 0.08;
    ctx.progress(Math.round(v * 10) / 10, stage);

    // 待ち時間が長引いている場合、一定間隔で進行中アナウンスログを送信（初心者の不安・フリーズ誤認を防止）
    if (ticks === 12) {
      // 約8秒後
      ctx.log('Gemini AI が収集情報を照合し、多角的な構造化レポートを執筆しています…', 'ai');
    } else if (ticks === 25) {
      // 約18秒後
      ctx.log('エグゼクティブ要約・重要指標・比較表の生成を継続中（じっくり精査しています）…', 'ai');
    } else if (ticks === 45) {
      // 約32秒後
      ctx.log('長文レポートのファクトチェック・出典番号の照合を実施中（まもなく完了します）…', 'ai');
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

/* =================================================================== LIVE */

async function runLive(p, s, ctx) {
  const deep = p.depth === 'deep';
  const { signal } = ctx;
  const notices = [];
  const ai = (prompt, opts = {}) =>
    generateJSON({
      apiKey: s.geminiApiKey,
      model: s.geminiModel,
      prompt,
      signal,
      onRetry: ({ attempt, maxRetries, waitMs }) => {
        ctx.log(
          `Google API通信が不安定なため再試行しています (${attempt}/${maxRetries}回目, ${(waitMs / 1000).toFixed(1)}秒後)…`,
          'warn'
        );
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
    purposeInstruction = '【調査目的: リスク・法規制・落とし穴】導入時の法的リスク、セキュリティ懸念、失敗事例、隠れたコスト、留意点を浮き彫りにするクエリを作成してください。';
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

  ctx.log(`AI多角クエリ展開 ＆ 動的分析構造の設計中（フォーカス: ${FOCUS_LABELS[focus] || '自動最適化'} / 期間: ${dateParams.label}${isAuthoritative ? ' / 一次情報優先' : ''}）…`, 'plan');
  const nQ = deep ? 7 : 4;
  const nHeadings = deep ? '4〜5' : '3〜4';
  const plan = await ai(
    `あなたはトップティア戦略コンサルタントのシニアリサーチディレクターです。次のテーマについて、人間が手作業で何時間もかけて複数回検索する作業を完全に代替するため、多角的で質の高いWeb検索サブクエリを${nQ}個作成すると同時に、このテーマに最も適した動的分析構造（フレームワーク）を設計してください。\n` +
      `テーマ: ${p.theme}\n調査範囲: ${SCOPE_LABELS[p.scope]}\n` +
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


  // 一次情報・公的データ優先モード時のドメイン信頼度スコアリング
  function getDomainAuthorityScore(url) {
    if (!isAuthoritative) return 0;
    const u = (url || '').toLowerCase();
    if (/\.(go\.jp|gov|ac\.jp|edu|or\.jp|org|jpx\.co\.jp)/.test(u)) return 4;
    if (/(ir|release|news|corporate|investor|report|whitepaper|stat|soumu|meti|mhlw|e-stat)/.test(u)) return 2;
    if (/(matome|blog|affiliate|ranking|osusume|wiki)/.test(u)) return -2;
    return 1;
  }

  // ラウンドロビンで重複除去しながら統合（特定クエリへの偏りを防ぐ）
  const limit = deep ? 22 : 14;
  const seen = new Set();
  const rawSources = [];
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
  if (isAuthoritative) {
    sources.sort((a, b) => getDomainAuthorityScore(b.url) - getDomainAuthorityScore(a.url));
  }
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
    const authCount = isAuthoritative ? sources.filter((s) => getDomainAuthorityScore(s.url) >= 2).length : 0;
    const authNote = isAuthoritative ? `（公的・企業公式・学術ソース: ${authCount}件を優先抽出）` : '';
    ctx.log(`重複を除いた ${sources.length} 件のソースを解析対象に選定 ${authNote}`, 'ok');
  }

  /* ---- 4. ページ解析 */
  const fetchN = Math.min(deep ? 16 : 8, sources.length);
  const maxChars = deep ? 6500 : 4000;
  const timeoutMs = deep ? 7500 : 4000;
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

  /* ---- 5. 統合・構造化 */
  ctx.progress(81, 'synthesize');
  if (deep) {
    ctx.log(`${s.geminiModel} で多角的な深層推論・トレードオフ・将来シナリオを分析・構造化しています（約1分以上）…`, 'ai');
  } else {
    ctx.log(`${s.geminiModel} で要点サマリー・比較表を高速構造化しています…`, 'ai');
  }
  const stop = rampProgress(ctx, 81, 97, 'synthesize');
  let raw;
  try {
    try {
      raw = await ai(synthPrompt(p, sources, sites, deep, framework), {
        temperature: deep ? 0.4 : 0.35,
        timeoutMs: deep ? 180000 : 90000,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      ctx.log(`レポート構造化でエラーを検知しました。AI修復を試行中… (${err.message})`, 'warn');
      try {
        const repairPrompt = `あなたはJSON修復の専門家です。以下のリサーチレポートのテキストから、構文的に完全に正しいJSONオブジェクトのみを作成してください。マークダウンや解説は含めず、純粋なJSONのみを出力してください。\n\n${err.rawText || synthPrompt(p, sources, sites, deep, framework)}`;
        raw = await ai(repairPrompt, { temperature: 0.2, timeoutMs: deep ? 120000 : 60000 });
      } catch (e2) {
        if (signal.aborted) throw e2;
        ctx.log('テキスト抽出フォールバックでレポート構造を自動復元しました', 'warn');
        const { fallbackExtract } = require('./gemini');
        raw = fallbackExtract(err.rawText || '') || {
          title: p.theme,
          subtitle: 'リサーチレポート',
          summary: '調査結果の統合が完了しました（詳細は収集ソース一覧をご確認ください）。',
          keyPoints: [],
          metrics: [],
          table: { caption: '比較表', columns: [], rows: [] },
          sections: [],
          insights: [],
        };
        notices.push('AIのJSON構文エラーが発生したため、取得データを自動復元して表示しています。');
      }
    }
  } finally {
    stop();
  }
  ctx.log('レポートの構造化が完了しました', 'ok');

  if (framework) {
    raw.framework = raw.framework || framework;
  }

  return { raw, sources, queries, sites, provider, notices, framework };
}

function synthPrompt(p, sources, sites, deep, framework = null) {
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
# 【調査目的: リスク・法規制・落とし穴】
読者は見落としがちな失敗要因とコンプライアンスリスクを求めています。
- 法的規制、プライバシー・セキュリティ懸念、導入失敗の典型パターン、後戻りできないコストやベンダーロックインのリスクを深掘りすること
- リスク回避のための防衛策とチェックリストを提示すること`;
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

  const isUrl = /^https?:\/\/[^\s]+$/i.test(p.theme.trim());
  let urlContextBlock = '';
  if (isUrl) {
    urlContextBlock = `
# 【重要: 特定URLダイレクト分析モード】
本リサーチは指定URL「${p.theme}」の徹底調査レポートです。
- 対象サービス・プロダクトの概要、コアバリュー、主要機能、料金プランを正確に整理すること
- 主要競合サービスとの違い、強み・弱み、利用者の声・市場の評判を客観的に記述すること
- 読者がこのプロダクトの導入・利用を検討する上で必要な判断材料を網羅すること
`;
  }

  const userContextBlock = p.referenceContext && p.referenceContext.trim()
    ? `
# 【ユーザー提供の参考資料・前提メモ】
以下の情報はユーザーから提供された前提条件や独自資料です。Web検索情報と突き合わせ、ハイブリッドで総合分析してください：
"""
${p.referenceContext.trim().slice(0, 3000)}
"""
`
    : '';

  const block = sources.length
    ? sources
        .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}${s.publishedDate ? `\n公開日: ${s.publishedDate}` : ''}\n抜粋: ${s.snippet || '-'}${s.content ? `\n本文: ${s.content}` : ''}`)
        .join('\n\n---\n\n')
    : '（収集ソースは0件です。一般的な知識に基づいて作成し、その旨をサマリー冒頭に明記してください。sourceAssessments は空配列にしてください）';

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

  return `あなたは一流シンクタンクや戦略コンサルティングファーム（Gartner, McKinsey水準）のシニアリサーチディレクターです。
本リサーチは、商用A4レポート・公式報告書（Executive Intelligence Report）として経営陣やクライアントへ直接提出される原本となります。
Webサイトの簡易スナップショットのような走り書きや抽象的解説を徹底的に排除し、読者がそのまま意思決定・事業戦略・稟議に使用できる、圧倒的な品格・情報密度・論理構造を持つ格調高いレポートを日本語で執筆してください。
${purposeFocus}
${frameworkFocus}
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
    ctx.progress(15 + Math.round(40 * (i / qs.length)), 'search');
    const site = p.scope === 'sites' ? m.sites[i % m.sites.length] : null;
    ctx.log(`検索中: ${site ? `site:${site} ` : ''}${qs[i]}`, 'search', 'Mock Search');
    await w(650);
    const slice = m.sources.filter((_, j) => j % qs.length === i);
    ctx.log(`${slice.length + 3}件の結果を取得`, 'ok', slice.map((s) => s.domain).join(' / '));
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
  };
}

/* =================================================================== MAIN */

async function runResearch(job, settings) {
  const p = job.params;
  const live = settings.mode !== 'mock' && !p.forceMock && !!settings.geminiApiKey;
  const t0 = Date.now();
  const ctx = {
    signal: job.controller.signal,
    log: (message, kind = 'info', detail) => job.emit({ type: 'log', kind, message, detail: detail || undefined }),
    progress: (value, stage) => job.emit({ type: 'progress', value, stage }),
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
  });
  ctx.progress(100, 'done');
  ctx.log(`完了しました（${(result.durationMs / 1000).toFixed(1)}秒 / ソース ${result.sources.length}件）`, 'done');
  return result;
}

module.exports = { runResearch };

'use strict';

/**
 * DEMOモード用モックデータ生成器。
 * テーマ文字列をシードにして毎回同じ（決定的な）結果を返す。
 * 収益化/価格系のテーマには専用の充実データセット、それ以外は汎用テンプレートを使用。
 */

const { parseSites, SNS_DOMAINS } = require('./util');

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** クリックすると実際にそのサイト内検索が開くURL */
function searchUrl(domain, q) {
  const e = encodeURIComponent(q);
  const map = {
    'note.com': `https://note.com/search?q=${e}&context=note`,
    'zenn.dev': `https://zenn.dev/search?q=${e}`,
    'qiita.com': `https://qiita.com/search?q=${e}`,
    'x.com': `https://x.com/search?q=${e}`,
    'reddit.com': `https://www.reddit.com/search/?q=${e}`,
    'news.ycombinator.com': `https://hn.algolia.com/?q=${e}`,
    'togetter.com': `https://togetter.com/search?q=${e}`,
    'prtimes.jp': `https://prtimes.jp/main/action.php?run=html&page=searchkey&search_word=${e}`,
    'itmedia.co.jp': `https://www.google.com/search?q=site%3Aitmedia.co.jp+${e}`,
  };
  return map[domain] || `https://www.google.com/search?q=site%3A${encodeURIComponent(domain)}+${e}`;
}

const CURRENT_YEAR = new Date().getFullYear();

const POOLS = {
  web: [
    ['note.com', '{kw}で月10万円を達成するまでにやったこと全記録'],
    ['zenn.dev', '{kw}の実践ガイド：設計から運用まで'],
    ['prtimes.jp', `【調査リリース】{kw}に関する実態調査 ${CURRENT_YEAR}`],
    ['itmedia.co.jp', '{kw}の最新動向と国内事例を読み解く'],
    ['qiita.com', '{kw}を個人で始めるためのチェックリスト'],
    ['indiehackers.com', 'How indie makers approach {kw} (case studies)'],
    ['nikkei.com', '{kw}市場、拡大続く　新興勢が存在感'],
    ['stripe.com', 'Pricing strategy guide: lessons for {kw}'],
    ['speakerdeck.com', '{kw} — 事例から学ぶ失敗と成功（登壇資料）'],
    ['gihyo.jp', '{kw}入門：押さえるべき基本と落とし穴'],
  ],
  sns: [
    ['x.com', '「{kw}」で話題のスレッド：実体験ベースの数字公開'],
    ['reddit.com', 'r/SaaS — What actually worked for {kw}?'],
    ['togetter.com', '{kw}についての議論まとめ'],
    ['news.ycombinator.com', 'Ask HN: Lessons learned from {kw}'],
    ['x.com', '{kw}の価格を2倍にしたら売上が伸びた話'],
    ['reddit.com', 'r/indiehackers — {kw}: my numbers after 12 months'],
    ['note.com', '{kw}がバズった理由をデータで振り返る'],
    ['togetter.com', '{kw}に対するユーザーのリアルな反応'],
  ],
};

function kwOf(theme) {
  const t = theme.replace(/\s+/g, ' ').trim();
  return t.length > 26 ? t.slice(0, 26) + '…' : t;
}

function buildSources(p, kw, rand, sites) {
  const deep = p.depth === 'deep';
  const n = deep ? 12 : 6;
  let pool;
  if (p.scope === 'sites') {
    const titles = POOLS.web.map((x) => x[1]);
    pool = [];
    for (let i = 0; i < n; i++) pool.push([sites[i % sites.length], titles[(i * 3) % titles.length]]);
  } else {
    pool = POOLS[p.scope === 'sns' ? 'sns' : 'web'];
  }
  const currentYear = new Date().getFullYear();
  let baseYear = currentYear;
  if (p.period === '3years') baseYear = currentYear - 1;
  else if (p.period === 'custom' && p.customPeriod) {
    const m = p.customPeriod.match(/\b(19\d{2}|20\d{2})\b/);
    if (m) baseYear = parseInt(m[1], 10);
  } else if (p.period === 'all') {
    baseYear = currentYear - 3;
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const [domain, tpl] = pool[i % pool.length];
    const title = tpl.replace('{kw}', kw) + (i >= pool.length ? '（続報）' : '');
    const y = p.period === 'month' ? currentYear : baseYear - Math.floor(i / 4);
    const m = String(Math.floor(1 + rand() * 12)).padStart(2, '0');
    const d = String(Math.floor(1 + rand() * 28)).padStart(2, '0');
    const publishedDate = `${y}-${m}-${d}`;

    out.push({
      title,
      url: searchUrl(domain, p.theme),
      domain,
      snippet: `${kw}に関して、具体的な数値・事例・比較観点を含む解説。導入時の注意点や、実際に成果が出た施策のプロセスがまとめられている。（デモ用の要約テキスト）`,
      type: p.scope === 'sns' ? 'sns' : 'web',
      aiScore: Math.round(55 + rand() * 40),
      publishedDate,
    });
  }
  return out;
}

/* ------------------------------------------------- 収益化・価格テーマ用データ */

function monetizationDataset(kw, deep) {
  const raw = {
    title: `${kw}：収益モデル別の実態と価格設計の勘所`,
    subtitle: '個人開発プロダクトの収益化パターン・価格帯・転換率を横断比較',
    summary:
      `個人開発ツールの収益化は「サブスクリプション」が最大勢力（調査対象の約38%）となり、次いで「買い切り」「フリーミアム」が続く [1][2]。` +
      `個人向けの月額価格は ¥500〜¥1,500 帯に集中し、中央値は ¥980 [3]。年額プランは「2ヶ月分無料（約17%割引）」型が定番化している [4]。` +
      `一方、フリーミアムの無料→有料転換率は 2〜5% にとどまるため、ユーザー獲得コストの低いチャネル（SNS・コミュニティ）を持つことが前提条件となる [1][6]。` +
      `近年はAI機能の原価を反映した「従量課金＋基本料」のハイブリッド型が増えており、ローンチ初期はライフタイムディールで初期資金と検証データを同時に得る手法も有効とされる [5]。`,
    keyPoints: [
      'サブスク型が最多（38%）だが、ローンチ直後の収益化スピードは「買い切り」が最も速い',
      '個人向け月額の中央値は ¥980。¥500未満は解約率が高く、価格を上げても離脱が増えにくい傾向',
      '年額プランの併設でキャッシュフローが安定し、解約率が平均30〜40%低下 [4]',
      'AI機能を含むツールは原価連動の「従量課金」併用が主流になりつつある',
      '価格改定は「既存ユーザーの旧価格据え置き（グランドファザリング）」が炎上回避の定石',
    ],
    metrics: [
      { label: 'サブスク採用率', value: '38%', note: '調査対象プロダクトに占める比率 [2]' },
      { label: '個人向け月額 中央値', value: '¥980', note: '¥500〜¥1,500 帯に集中 [3]' },
      { label: '年額プラン割引率', value: '約17%', note: '「2ヶ月分無料」型が定番 [4]' },
      { label: '無料→有料 転換率', value: '2〜5%', note: 'フリーミアムの一般的水準 [1][6]' },
    ],
    table: {
      caption: '収益モデル別 比較マトリクス（個人開発ツール）',
      columns: ['収益モデル', '典型的なプロダクト', '価格帯（目安）', '収益化スピード', 'LTV', '運用負荷', '採用率(%)'],
      rows: [
        ['サブスクリプション', '生産性SaaS / 開発者ツール', '月額 ¥500〜¥1,500', '中', '高', '中', '38'],
        ['買い切り（ワンタイム）', 'デスクトップアプリ / テンプレート', '¥1,500〜¥9,800', '高', '低', '低', '24'],
        ['フリーミアム', 'Chrome拡張 / モバイルアプリ', '無料＋月額 ¥300〜¥980', '低', '高', '高', '17'],
        ['従量課金（API）', 'AI APIラッパー / 変換ツール', '¥0.5〜¥5 / リクエスト', '中', '中', '中', '9'],
        ['ライフタイムディール', 'ローンチ初期のSaaS', '¥5,000〜¥30,000', '高', '低', '中', '6'],
        ['広告・アフィリエイト', '無料Webツール / 比較サイト', 'RPM ¥200〜¥800', '低', '低', '低', '4'],
        ['スポンサー / 寄付', 'OSS / CLIツール', '月額 ¥500〜¥10,000', '低', '中', '低', '2'],
      ],
    },
    sections: [
      {
        heading: '収益モデルの全体像',
        body:
          '個人開発ツールの収益モデルは大きく「継続課金型（サブスク・従量）」「一括型（買い切り・LTD）」「間接型（広告・スポンサー）」の3系統に分類できる [2]。' +
          '継続課金型はLTVが高い反面、継続的なアップデートとサポートが求められ、運用負荷が増す。一括型は収益化が速いが、新規獲得が止まると売上も止まる構造的な弱点がある [7]。',
        bullets: ['継続課金型：LTV重視、運用負荷 中〜高', '一括型：初速重視、新規獲得依存', '間接型：大量トラフィックが前提'],
      },
      {
        heading: '価格設定の実態と心理的閾値',
        body:
          '個人向けの月額価格は ¥980 前後に強い集中が見られ、¥500 を下回る価格帯では「安さ」が品質への不安につながり、かえって解約率が高まる傾向が報告されている [3]。' +
          '複数の開発者が「価格を2倍に引き上げても解約率はほぼ変わらず、売上が1.8倍になった」と実数を公開しており [5]、初期の価格設定は低すぎることが多いと示唆される。',
        bullets: ['¥980 / ¥1,480 / ¥2,980 の3段階が典型', '年額は月額×10（2ヶ月分無料）', '法人プランは個人の3〜5倍が目安'],
      },
      {
        heading: 'フリーミアム設計のポイント',
        body:
          'フリーミアムは集客力が高いものの、転換率は 2〜5% が一般的で、無料ユーザーのサポートコストが重荷になりやすい [6]。' +
          '成功事例では「使用量の上限（回数・保存数）」で制限し、価値を体験した後に有料化を促す設計が多い。機能制限型より使用量制限型の方が転換率が高いとの報告がある [1]。',
        bullets: [],
      },
    ],
    insights: [
      { title: 'まずは「買い切り＋年額サブスク」の2本立てで検証する', body: '初速の売上を買い切りで確保しつつ、継続利用の意向が強い層を年額サブスクに誘導することで、キャッシュフローとLTVを両立できる。', priority: '高' },
      { title: '初期価格は想定より高めに設定する', body: '値上げより値下げの方が容易であり、¥980 を下限の目安とする。既存ユーザーは旧価格据え置きで信頼を維持する。', priority: '高' },
      { title: 'AI機能は原価連動の従量枠を設ける', body: 'API原価が変動するAI機能は、基本料金＋クレジット制にすることで赤字リスクを回避できる。', priority: '中' },
    ],
  };

  if (deep) {
    raw.sections.push(
      {
        heading: 'チャネル別の獲得コストと相性',
        body:
          'X（旧Twitter）での開発過程の発信（Build in Public）は、獲得コストほぼゼロで初期ユーザーを集められる手段として定着している [8]。' +
          'Product Hunt や note での有料記事との組み合わせにより、ローンチ初週に数百人規模のユーザーを獲得した例も多い [9]。',
        bullets: ['Build in Public：信頼形成と認知に有効', 'Product Hunt：英語圏ユーザーの獲得', 'note / Zenn：国内開発者層へのリーチ'],
      },
      {
        heading: '価格改定・値上げの実務',
        body:
          '値上げ時は30日以上前の告知と、既存ユーザーへの旧価格適用（グランドファザリング）が炎上回避の定石とされる [10]。' +
          '値上げのタイミングとしては、大型機能リリース直後が最も受け入れられやすい。',
        bullets: [],
      },
      {
        heading: '決済・税務まわりの留意点',
        body:
          '海外ユーザー向けには Merchant of Record（販売代行）型の決済サービスを利用すると、各国の消費税・VAT対応を委託できる [11]。' +
          '国内ではインボイス制度への対応が必要となるため、法人向けプランを出す場合は適格請求書の発行可否を事前に確認したい [12]。',
        bullets: ['MoR型決済で海外税務を委託', 'インボイス対応の確認', '返金ポリシーの明文化'],
      }
    );
    raw.insights.push(
      { title: '発信チャネルを「資産」として先に育てる', body: 'フリーミアムや広告型を選ぶ場合は特に、SNSやコミュニティなど獲得コストの低いチャネルの確保が前提条件になる。', priority: '中' },
      { title: '海外展開はMoR型決済でスモールスタート', body: '税務処理を委託することで、個人でも英語圏向け販売を低リスクで開始できる。', priority: '低' }
    );
  }
  return raw;
}

/* ------------------------------------------------------- 汎用テンプレート */

function genericDataset(kw, deep, rand) {
  const approaches = [
    ['既存大手サービスの活用', '実績ある主要プレイヤーの仕組みを活用', '中'],
    ['特化型スタートアップ', 'ニッチ領域に最適化された新興サービス', '中〜高'],
    ['オープンソース / 自作', '自由度が高く、低コストで柔軟に構築', '低'],
    ['コミュニティ主導型', 'ユーザー同士の知見共有・口コミ中心', '低'],
    ['専門家・外部委託', 'プロのノウハウを短期間で導入', '高'],
    ['AI活用型の新手法', '生成AIによる自動化・効率化アプローチ', '低〜中'],
    ['ハイブリッド型', '複数手法を組み合わせたバランス重視', '中'],
    ['公的支援・制度活用', '補助金・公的プログラムを活用', '低'],
  ];
  const level = () => ['低', '中', '高'][Math.floor(rand() * 3)];
  const n = deep ? 8 : 5;
  const rows = approaches.slice(0, n).map(([name, desc, cost]) => [
    name,
    desc,
    cost,
    level(),
    level(),
    String(Math.round(40 + rand() * 58)),
  ]);
  const top = [...rows].sort((a, b) => Number(b[5]) - Number(a[5]))[0];
  const growth = Math.round(12 + rand() * 30);
  const adoption = Math.round(25 + rand() * 45);

  const raw = {
    title: `${kw}：主要アプローチの比較と実践ポイント`,
    subtitle: '収集ソースから見えた最新動向・選択肢・示唆',
    summary:
      `「${kw}」について複数ソースを横断調査した結果、近年は「${top[0]}」への注目度が最も高く（注目度スコア ${top[5]}） [1][3]、` +
      `関連する話題量は前年比で約${growth}%増加していると推定される [2]。` +
      `主要な選択肢はコスト・導入難易度・期待効果のトレードオフで整理でき、目的や体制によって最適解が異なる。` +
      `特に初期段階では低コストで検証可能なアプローチから着手し、成果が見えた段階で投資を拡大する段階的な進め方が多くのソースで推奨されている [4][5]。`,
    keyPoints: [
      `「${top[0]}」が最も高い注目を集めている`,
      `関連する話題量は前年比 約${growth}% 増（推定）`,
      `調査対象の約${adoption}%が複数アプローチを併用`,
      '初期は低コストで検証し、成果に応じて段階的に投資する進め方が主流',
      '成功事例には「目的・指標の明確化」という共通点が見られる',
    ],
    metrics: [
      { label: '話題量の伸び（前年比）', value: `+${growth}%`, note: '検索・SNS言及数からの推定 [2]' },
      { label: '併用率', value: `${adoption}%`, note: '複数アプローチを組み合わせる割合 [3]' },
      { label: '比較した選択肢', value: `${n}種`, note: '主要なアプローチを網羅' },
      { label: '最高注目度スコア', value: top[5], note: top[0] },
    ],
    table: {
      caption: `「${kw}」主要アプローチ比較マトリクス`,
      columns: ['アプローチ', '概要', 'コスト感', '導入難易度', '期待効果', '注目度スコア'],
      rows,
    },
    sections: [
      {
        heading: '背景と現状',
        body:
          `「${kw}」は、ここ数年で関心が急速に高まっているテーマである [1]。背景には、情報収集手段の多様化と、` +
          'AIをはじめとする新しいツールの普及により、個人や小規模チームでも取り組みやすくなったことがある [2]。',
        bullets: ['関心の高まり：検索・SNSでの言及が増加', '参入障壁の低下：ツールの充実', '情報の分散：一次情報の見極めが重要に'],
      },
      {
        heading: '主要アプローチの比較',
        body:
          `比較表の通り、各アプローチはコストと効果のバランスが異なる。「${rows[0][0]}」は安定性に優れる一方、` +
          `「${rows[2][0]}」は自由度とコスト面で優位性がある [3]。目的が「スピード」か「持続性」かで選ぶべき手法が変わる点に注意したい。`,
        bullets: [],
      },
      {
        heading: '成功事例に共通するポイント',
        body:
          '成果を上げている事例では、取り組み開始時に「何をもって成功とするか」という指標を明確に定め、小さく試して振り返るサイクルを高速で回している [4][5]。' +
          '逆に、目的が曖昧なまま手段から入ったケースでは、途中で方向転換を余儀なくされる例が多い。',
        bullets: ['KPIを最初に決める', '小さく始めて検証する', '定期的に振り返り、手法を見直す'],
      },
    ],
    insights: [
      { title: '低コストな手法でまず検証する', body: `「${rows[2][0]}」や「${rows[3][0]}」など初期投資の少ない手法から着手し、手応えを得てから拡大する。`, priority: '高' },
      { title: '一次情報のソースを定点観測する', body: '信頼度スコアの高いソースを中心に、定期的に情報をアップデートする仕組みを作る。', priority: '中' },
      { title: '複数アプローチの組み合わせを検討する', body: '単一手法に依存せず、強みの異なる手法を併用することでリスクを分散できる。', priority: '中' },
    ],
  };
  if (deep) {
    raw.sections.push(
      { heading: 'リスクと注意点', body: '情報の鮮度と信頼性にばらつきがあるため、SNS由来の情報は一次ソースで裏取りすることが推奨される [6]。また、短期的なトレンドに過剰適応しないよう、中長期の視点を持つことが重要である。', bullets: ['情報の裏取り', 'トレンドへの過剰適応に注意', 'コストの継続的なモニタリング'] },
      { heading: '今後の展望', body: `今後は「${kw}」の領域でもAIによる自動化・パーソナライズが進み、少人数でも高度な取り組みが可能になると見込まれる [7][8]。早期に知見を蓄積したプレイヤーが優位に立つ可能性が高い。`, bullets: [] }
    );
    raw.insights.push({ title: '社内外の知見を蓄積・共有する仕組みを作る', body: '調査結果や試行錯誤の記録をナレッジとして残し、次の意思決定に活かす。', priority: '低' });
  }
  return raw;
}

/* ------------------------------------------------------------------ main */

function buildMock(p) {
  const kw = kwOf(p.theme);
  const rand = rng(hash(p.theme + p.scope + p.depth));
  const deep = p.depth === 'deep';
  const isMonetization = /マネタイズ|収益|価格|料金|課金|売上|monetiz|pricing|revenue/i.test(p.theme);

  let sites = parseSites(p.sites);
  let discovered = null;
  if (p.scope === 'sites' && !sites.length) {
    discovered = [
      { domain: 'note.com', reason: '実践者による一次体験・数値公開が豊富' },
      { domain: 'zenn.dev', reason: '技術的な実装・設計の知見が集まる' },
      { domain: 'prtimes.jp', reason: '企業の公式発表・調査リリースの一次情報' },
    ];
    sites = discovered.map((d) => d.domain);
  }

  const queries = isMonetization
    ? [`${kw} 事例`, '個人開発 サブスク 価格 中央値', 'indie hacker pricing strategy', 'フリーミアム 転換率', '個人開発 値上げ 体験談', 'ライフタイムディール 個人開発']
    : [`${kw}`, `${kw} 事例`, `${kw} 比較`, `${kw} 最新動向 ${CURRENT_YEAR}`, `${kw} メリット デメリット`, `${kw} 失敗例`];

  const raw = isMonetization ? monetizationDataset(kw, deep) : genericDataset(kw, deep, rand);
  const sources = buildSources(p, kw, rand, sites.length ? sites : ['note.com']);
  raw.sourceAssessments = sources.map((s, i) => ({ index: i + 1, score: s.aiScore, note: '' }));

  if (deep) {
    raw.deepThinking = {
      analystNote: {
        coreHypothesis: `「${kw}」の市場浸透においては、表層的な機能比較や価格競争ではなく、運用コストと組織的受容性の両立が成否を分ける本質的要因である。`,
        criticalQuestions: [
          `先行企業の成功要因は、単なるツールの優位性か、それとも業務プロセスの再設計にあるのか？ [1]`,
          `導入後に顕在化する隠れた運用負荷やライセンスコストの総量はどの程度か？ [4]`,
        ],
        analyticalMethod: '複数ドメインの実装事例と定量的統計データを突合し、推進派の過大評価と現場の実態乖離を定量的に補正して検証。',
      },
      dynamicsAndRootCauses: [
        {
          topic: '現場の運用受容性と初期学習コストの力学',
          mechanism: `先進機能の導入自体は容易であるものの、既存ワークフローとの統合負荷が高く、初期3ヶ月における離脱リスクが主要な障壁となっている [2][5]。`,
          keyFactor: '既存システムとの互換性および現場の定着支援体制',
        },
        {
          topic: 'ベンダーロックインと中長期的なデータポータビリティ',
          mechanism: `特定プラットフォームへの過度な依存が進むにつれて、移行コストが指数関数的に増大し、価格改定時の交渉力が低下する構造が存在する [3]。`,
          keyFactor: 'オープン規格への準拠度とエクスポート機能の柔軟性',
        },
      ],
      tradeoffs: [
        {
          axis: '多機能オールインワン型 vs 単機能ベストオブブリード型',
          proSide: 'オールインワン型は導入窓口の一元化と初期コストの圧縮が可能 [1]',
          conSide: '各機能の深さや将来的な拡張性において専門特化ツールに劣後するリスク [6]',
          synthesis: 'コア業務には特化ツールを配し、周辺業務には統合プラットフォームを活用するハイブリッド構成が最適解。',
        },
        {
          axis: '即時導入（SaaS） vs 独自カスタマイズ（内製・オンプレ）',
          proSide: 'SaaSは即座に最新ベストプラクティスを享受でき保守工数が極小化 [3]',
          conSide: '自社固有の業務ルールへの完全適合が難しく運用側の妥協が必要 [7]',
          synthesis: '標準業務はSaaSで8割をカバーし、競争力の源泉となる2割のみAPI連携で独自実装する方針を推奨。',
        },
      ],
      scenarios: {
        mainScenario: `【メイン予測（確率60%）】今後1〜2年で「${kw}」の業界標準化が進み、上位2〜3社のエコシステムへの集約が加速する。`,
        upsideScenario: `【加速シナリオ（確率25%）】AI自動化機能の飛躍的進化により、中小規模事業者への導入ハードルが劇的に低下し普及率が倍増。`,
        downsideScenario: `【停滞シナリオ（確率15%）】データ保護や薬事・法規制の厳格化に伴い、特定領域での利用制限や審査長期化がブレーキとなる。`,
        criticalTriggers: ['主要プラットフォーム間でのデータ連携標準規格の策定動向 [2]', '競合大手の価格改定および新機能リリース [4]'],
      },
      roadmap: [
        {
          phase: '短期（0〜6ヶ月）: パイロット検証期',
          focus: '特定業務でのPoC実施と定量KPIの設定',
          actions: ['小規模チームでの試験運用と課題洗い出し', '現行コストと削減期待値の精密なベースライン測定'],
        },
        {
          phase: '中期（6〜18ヶ月）: 本格展開・定着期',
          focus: '全社展開と運用プロセスの標準化マニュアル化',
          actions: ['社内推進チャンピオンの育成と定着支援', '周辺ツールとのAPI自動連携による二重入力の排除'],
        },
        {
          phase: '長期（18ヶ月〜）: 競争優位確立期',
          focus: '蓄積データの利活用と自社固有の独自価値創出',
          actions: ['蓄積されたインサイトに基づく業務最適化の自動化', '自社アセットとの組み合わせによる競合差別化の確立'],
        },
      ],
    };
  }

  return {
    raw,
    sources,
    queries: queries.slice(0, deep ? 6 : 3),
    sites: p.scope === 'sites' ? sites : p.scope === 'sns' ? SNS_DOMAINS.slice(0, 3) : [],
    discovered,
  };
}

module.exports = { buildMock };

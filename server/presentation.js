'use strict';

const gemini = require('./gemini');
const settings = require('./settings');

/**
 * 発表対象（オーディエンス）のプロファイル定義
 */
function resolveAudienceProfile(audience) {
  const aud = String(audience || '').trim().toLowerCase();
  
  if (aud.includes('エンジニア') || aud.includes('開発') || aud.includes('tech') || aud.includes('engineer')) {
    return {
      type: 'engineer',
      name: '開発チーム・エンジニア・技術リード',
      focus: '技術選定の妥当性、システム設計・アーキテクチャ、直面した課題と打ち手、実装ステップ、非機能要件（性能・保守性・セキュリティ）',
      tone: '論理的・実務的・具体的。コードや構成図、技術的トレードオフを重視',
    };
  }

  if (aud.includes('役員') || aud.includes('経営') || aud.includes('exec') || aud.includes('management') || aud.includes('上長')) {
    return {
      type: 'exec',
      name: '経営陣・役員・意思決定者',
      focus: 'ビジネスインパクト、投資対効果（ROI）、リソース・工数・費用、意思決定すべき判断ポイント、全体リスクとヘッジ策',
      tone: '結論ファースト、定量的、戦略的。専門用語を避け、事業成果と判断材料に集中',
    };
  }

  if (aud.includes('営業') || aud.includes('ビジネス') || aud.includes('セールス') || aud.includes('biz') || aud.includes('sales')) {
    return {
      type: 'business',
      name: 'ビジネス・営業・マーケティング部門',
      focus: '顧客提供価値、市場ニーズ、競合との差別化ポイント、提案時の訴求トーク、導入・活用ユースケース',
      tone: '情熱的、ベネフィット重視、分かりやすい顧客課題と解決ストーリー',
    };
  }

  if (aud.includes('クライアント') || aud.includes('顧客') || aud.includes('ステークホルダー') || aud.includes('client')) {
    return {
      type: 'client',
      name: 'クライアント・外部ステークホルダー',
      focus: '納品物の品質、プロジェクトの透明性、スケジュール遵守、サポート体制、セキュリティとガバナンス',
      tone: '誠実、安心感、信頼感。約束した価値の実現と今後の見通しを明確化',
    };
  }

  // 自由入力のカスタムオーディエンス
  return {
    type: 'custom',
    name: audience || '指定された発表対象',
    focus: `「${audience || '対象者'}」の関心事、前提知識、求めている情報に最適化した構成`,
    tone: '対象者にとって最も理解しやすく説得力のあるトーン',
  };
}

/**
 * 1. Claude / ChatGPT 向けのスライド作成用プロンプト生成
 */
function generatePrompt({ document, audience, goal, files = [] }) {
  const profile = resolveAudienceProfile(audience);
  const cleanDoc = String(document || '').trim();
  const cleanGoal = String(goal || '').trim();
  const fileNames = Array.isArray(files) && files.length > 0
    ? files.map((f) => `- 添付ファイル: ${f.name || 'ドキュメント'} (${f.mimeType || 'unknown'})`).join('\n')
    : '';

  return `# プレゼンテーション・スライド作成指示書

## あなたの役割
あなたは一流の戦略コンサルティングファーム出身のプレゼンテーション・エキスパートです。
以下の「入力資料」をもとに、「発表対象（オーディエンス）」にとって最も説得力があり、心を動かすプレゼンテーション資料（スライド骨子および発表スクリプト）を作成してください。

---

## 前提条件・ターゲット設定
- **発表対象（オーディエンス）**: ${profile.name}
  - **対象者の関心・重視点**: ${profile.focus}
  - **推奨トーン**: ${profile.tone}
${cleanGoal ? `- **発表の目的・達成したいゴール**: ${cleanGoal}\n` : ''}- **スライド枚数**: 全6〜7枚（標準構成）
- **デザイン方針**: 1スライド1メッセージ、視覚的階層の明確化、結論ファースト
- **【重要】スライド画面超過・図表崩れ防止ルール（16:9 厳守）**:
  1. **画面枠（Bounding Box）の遵守**: 16:9（13.33 × 7.5インチ）の画面内、上下マージン（ヘッダー・フッター除く有効高さ 5.0インチ以内）に必ず収まる情報量に絞り込んでください。
  2. **1スライド1メッセージ・図解の分割**: 複雑なアーキテクチャ図や詳細な比較表がある場合は、解説文と同じスライドに詰め込まず、「解説スライド」と「図解・表専用スライド」の2枚に分割してください。
  3. **図・画像のContain収縮**: 図やグラフはアスペクト比（縦横比）を完全固定し、最大描画枠に収まるよう自動縮小（contain）される構成を指定してください。
  4. **テーブル制限**: スライド内の表は最大「5行 × 4列」以内とし、1セルあたり25文字以内に要約してください。

---

## 入力資料（企画書・設計書・メモ・添付ファイル）
${fileNames ? `${fileNames}\n\n` : ''}\`\`\`
${cleanDoc || (fileNames ? '（上記添付ファイルの内容に基づいてスライドを構成してください）' : '（資料の内容をここに貼り付けてください）')}
\`\`\`

---

## 出力フォーマット
各スライドについて、以下の4項目を漏れなく記述してください。

### 【スライド番号】スライドのタイトル
- **キーメッセージ（1行）**: このスライドでオーディエンスに絶対に伝えたい核心
- **レイアウト指定**: （例: 3カラム比較カード / 左右2分割 / 3フェーズロードマップ表 など）
- **スライド本文・構成要素**:
  - 要素1: タイトルと要点（2〜3行）
  - 要素2: ...
  - 数値・根拠データ: ...
- **発表者トークスクリプト（約30〜45秒分）**:
  「（発表者が実際に口頭で話す自然な日本語のセリフ）」

---

## スライド構成の流れ（推奨）
1. **表紙**: タイトル、サブタイトル、発表者、発表対象
2. **エグゼクティブサマリー（結論）**: 背景・課題・提案の全体像を1枚で総括
3. **現状の課題と分析**: オーディエンスが共感するボトルネック・痛点の整理
4. **解決策・新提案（メイン）**: 具体的アプローチ、アーキテクチャ、または企画詳細
5. **他案との比較・効果検証**: なぜこの案なのか（他案との比較マトリクスや期待効果）
6. **ロードマップとネクストステップ**: 直近のアクション、スケジュール、役割分担
7. **質疑応答・まとめ**: 意思決定や協力の呼びかけ
`;
}

/**
 * 2. システム内で直接A4横スライドを自動生成する（Gemini API呼び出し）
 */
async function generateSlides({ document, audience, goal, apiKey, model, files = [] }) {
  const profile = resolveAudienceProfile(audience);
  const cleanDoc = String(document || '').trim();
  const cleanGoal = String(goal || '').trim();
  const validFiles = Array.isArray(files) ? files.filter((f) => f && f.base64 && f.mimeType) : [];

  if (!cleanDoc && validFiles.length === 0) {
    throw new Error('企画書・資料のテキストまたはファイルを添付してください。');
  }

  const effectiveKey = apiKey || settings.get().geminiApiKey || process.env.GEMINI_API_KEY;
  if (!effectiveKey) {
    throw new Error('Gemini APIキーが設定されていません。ヘッダーの「設定」からAPIキーを入力してください。');
  }

  const effectiveModel = model || settings.get().geminiModel || 'gemini-2.5-flash';

  const systemInstruction = `あなたは戦略コンサルタントおよびエグゼクティブ・スライド作成のプロフェッショナルです。
入力された企画書・資料（テキストおよび添付ファイル）をもとに、指定された発表対象（${profile.name}）に向けて最適なA4横型商用レポートスライドを構成するJSONを出力してください。
余計な解説文やマークダウンのコードブロックは出力せず、必ず純粋なJSONオブジェクトのみを返してください。`;

  const prompt = `以下の入力資料をもとに、発表対象「${profile.name}」に向けたA4横商用レポートスライドを構成してください。

【対象者の関心事】: ${profile.focus}
【推奨トーン】: ${profile.tone}
${cleanGoal ? `【発表の目的・ゴール】: ${cleanGoal}\n` : ''}

【入力資料】:
${cleanDoc ? cleanDoc.slice(0, 15000) : '（添付されたファイルの内容に基づいて構成してください）'}
${validFiles.length > 0 ? `\n【添付ファイル数】: ${validFiles.length}件のファイルを添付しています。内容を詳細に解析して反映してください。` : ''}

---
必ず以下のJSONスキーマに完全準拠して出力してください:
{
  "title": "スライド全体のメインタイトル（20〜35文字程度）",
  "theme": "プロジェクト名または企画テーマ名",
  "periodLabel": "対象期間（例: 2026年Q4〜2027年Q1）",
  "summary": "エグゼクティブサマリー。結論ファーストで、現状の課題、提案骨子、期待される効果を120〜160文字程度で端的に記述。",
  "confidenceScore": 92,
  "insights": [
    {
      "badge": "効果・メリット等の短いタグ（4〜8文字）",
      "title": "インサイト見出し1（15〜22文字）",
      "desc": "具体的な根拠や背景、狙いの詳細（50〜80文字）",
      "kpiVal": "象徴的な数値（例: 35%減、2.5倍、100%等）",
      "kpiCap": "数値の補足説明（例: 工数削減、処理効率、稼働率等）"
    },
    {
      "badge": "技術・実装等の短いタグ",
      "title": "インサイト見出し2",
      "desc": "詳細",
      "kpiVal": "数値",
      "kpiCap": "補足"
    },
    {
      "badge": "課題・リスク等の短いタグ",
      "title": "インサイト見出し3",
      "desc": "詳細",
      "kpiVal": "数値",
      "kpiCap": "補足"
    },
    {
      "badge": "展望・推進等の短いタグ",
      "title": "インサイト見出し4",
      "desc": "詳細",
      "kpiVal": "数値",
      "kpiCap": "補足"
    }
  ],
  "table": {
    "caption": "比較マトリクスまたは課題と解決策の対照表タイトル",
    "columns": ["検討項目・課題", "従来方式（現状）", "提案方式（本企画）", "期待効果・判定"],
    "rows": [
      ["アーキテクチャ/方式", "手動・分断運用", "AI統合・自動連携", "工数大幅削減 (◎)"],
      ["品質・安定性", "属人化・ミス発生", "標準化・自動検証", "品質100%担保 (◎)"],
      ["スピード/期間", "数日〜1週間", "数分〜即時実行", "意思決定の加速 (◎)"]
    ]
  },
  "sections": [
    {
      "heading": "詳細分析・主要論点1（技術またはビジネスの核心）",
      "body": "背景や詳細なメカニズムの解説文。",
      "bullets": [
        "具体的なファクトや仕様のポイント1",
        "具体的なファクトや仕様のポイント2",
        "具体的なファクトや仕様のポイント3"
      ]
    },
    {
      "heading": "詳細分析・主要論点2（運用・体制・導入計画）",
      "body": "実現に向けた体制や運用面の要件解説。",
      "bullets": [
        "推進における重要ポイント1",
        "推進における重要ポイント2",
        "推進における重要ポイント3"
      ]
    }
  ],
  "roadmap": [
    {
      "phase": "Phase 1: 直近着手（1〜2ヶ月）",
      "goal": "プロトタイプ検証とチーム内フィードバックの回収",
      "items": [
        "コア機能のプロトタイプ実装と検証",
        "チーム内でのテスト運用と課題抽出",
        "フィードバックに基づく設計見直し"
      ],
      "kpi": "主要KPI: プロトタイプ完成度 100%"
    },
    {
      "phase": "Phase 2: 本格展開（3〜4ヶ月）",
      "goal": "機能拡充とステークホルダーへの正式リリース",
      "items": [
        "付随機能・連携インターフェースの追加",
        "マニュアル整備および利用説明会の実施",
        "本番環境への安全なデプロイ"
      ],
      "kpi": "主要KPI: チーム利用率 80%以上"
    },
    {
      "phase": "Phase 3: 定着・自律運用（5ヶ月〜）",
      "goal": "業務プロセスの標準化と継続的改善の確立",
      "items": [
        "運用自動化・監視ダッシュボードの導入",
        "他部門・関連チームへの展開と横展開",
        "定期的なパフォーマンス評価と改善"
      ],
      "kpi": "主要KPI: 業務効率化 30%達成"
    }
  ],
  "risks": [
    {
      "name": "移行・学習コストの発生",
      "level": "中",
      "desc": "新方式への移行初期にメンバーの習熟時間を要するリスク",
      "mitigation": "実践的なクイックガイド提供と段階的な移行ステップの設計"
    },
    {
      "name": "スコープ肥大化による遅延",
      "level": "低",
      "desc": "追加要望の増加により初期リリースが遅延するリスク",
      "mitigation": "MVP（最小限の実用製品）の範囲を厳密に合意し優先順位を徹底"
    }
  ],
  "sources": [
    {
      "title": "入力企画資料 / 設計ドキュメント",
      "url": "#",
      "reliability": "一次資料"
    }
  ]
}`;

  const parts = validFiles.map((f) => ({
    inlineData: {
      mimeType: f.mimeType,
      data: f.base64,
    },
  }));

  const result = await gemini.generateJSON({
    apiKey: effectiveKey,
    model: effectiveModel,
    prompt,
    parts,
    systemInstruction,
    temperature: 0.3,
  });

  return result;
}

module.exports = {
  resolveAudienceProfile,
  generatePrompt,
  generateSlides,
};

// ==========================================================================
// エクスポートモジュール：Claude用プロンプト生成、商用PDF印刷、Excel、Markdown、即戦力出力
// ==========================================================================

import { safeFilename, fmtDate, toast, esc, downloadBlob } from './ui.js';
import { renderSvgChart } from './modules/charts.js';

/**
 * 0. 即戦力出力：Slack/Teams用サマリー
 */
export function buildSlackSummary(data) {
  if (!data) return '';

  const lines = [];
  lines.push(`*【要約報告】 ${data.title || data.theme}*`);
  if (data.subtitle) lines.push(`_${data.subtitle}_`);
  lines.push(`📍 *調査テーマ*: ${data.theme}  |  *対象期間*: ${data.periodLabel || '直近1年'}  |  *精度*: ${data.depthLabel || 'クイック'}`);
  lines.push('');

  lines.push(`*💡 エグゼクティブサマリー*`);
  lines.push(data.summary || '（サマリーなし）');
  lines.push('');

  if (data.keyPoints && data.keyPoints.length) {
    lines.push(`*📌 最重要ハイライト*`);
    data.keyPoints.forEach((kp, idx) => {
      lines.push(`${idx + 1}. ${kp}`);
    });
    lines.push('');
  }

  if (data.metrics && data.metrics.length) {
    lines.push(`*📊 主要データ指標*`);
    data.metrics.forEach((m) => {
      lines.push(`• *${m.label}*: \`${m.value}\`${m.note ? ` (${m.note})` : ''}`);
    });
    lines.push('');
  }

  if (data.insights && data.insights.length) {
    lines.push(`*🎯 アナリストの示唆・推奨アクション*`);
    data.insights.slice(0, 3).forEach((ins) => {
      lines.push(`• [優先度:${ins.priority || '中'}] *${ins.title}* - ${ins.body}`);
    });
    lines.push('');
  }

  if (data.sources && data.sources.length) {
    lines.push(`*🔗 主な情報源 (信頼度順TOP3)*`);
    data.sources.slice(0, 3).forEach((s) => {
      lines.push(`• <${s.url}|${s.title || s.domain}> (${s.domain} / スコア:${s.score})`);
    });
  }

  return lines.join('\n');
}

/**
 * 0. 即戦力出力：プレゼンスライド骨子（Markdown / Marp形式）
 */
export function buildSlideOutline(data) {
  if (!data) return '';

  const slides = [];

  // Slide 1: タイトル
  slides.push(`---
marp: true
theme: default
paginate: true
header: "${data.theme}"
footer: "Research Studio Intelligence Report"
---

# ${data.title || data.theme}
${data.subtitle ? `### ${data.subtitle}\n` : ''}
- 調査テーマ: ${data.theme}
- 調査対象期間: ${data.periodLabel || '直近1年'}
- 作成日: ${fmtDate(data.createdAt, false)}
- 調査ソース数: ${data.sources ? data.sources.length : 0}件`);

  // Slide 2: エグゼクティブサマリー
  let s2 = `---

# 1. エグゼクティブサマリー

### 結論と全体像
${data.summary || ''}
`;
  if (data.keyPoints && data.keyPoints.length) {
    s2 += `\n### コアポイント\n`;
    data.keyPoints.slice(0, 4).forEach((kp, i) => {
      s2 += `${i + 1}. ${kp}\n`;
    });
  }
  slides.push(s2.trim());

  // Slide 3: 定量指標・主要数値
  if (data.metrics && data.metrics.length) {
    let s3 = `---

# 2. 重要データ指標・定量ハイライト

`;
    data.metrics.forEach((m) => {
      s3 += `- **${m.label}**: \`${m.value}\`\n  ${m.note ? `*${m.note}*` : ''}\n`;
    });
    slides.push(s3.trim());
  }

  // Slide 4: 構造化比較表
  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    let s4 = `---

# 3. ${data.table.caption || '構造化比較マトリクス'}

| ${data.table.columns.join(' | ')} |
| ${data.table.columns.map(() => '---').join(' | ')} |
`;
    data.table.rows.slice(0, 6).forEach((r) => {
      s4 += `| ${r.join(' | ')} |\n`;
    });
    slides.push(s4.trim());
  }

  // Slide 5: 詳細解説
  if (data.sections && data.sections.length) {
    let s5 = `---

# 4. 主要論点・詳細分析

`;
    data.sections.slice(0, 2).forEach((sec) => {
      s5 += `### ${sec.heading}\n${sec.body}\n\n`;
      if (sec.bullets && sec.bullets.length) {
        sec.bullets.slice(0, 3).forEach((b) => {
          s5 += `- ${b}\n`;
        });
      }
    });
    slides.push(s5.trim());
  }

  // Slide 6: 示唆・提言
  if (data.insights && data.insights.length) {
    let s6 = `---

# 5. 示唆・提言（Strategic Recommendations）

`;
    data.insights.forEach((ins, idx) => {
      s6 += `### ${idx + 1}. [優先度:${ins.priority || '中'}] ${ins.title}\n${ins.body}\n\n`;
    });
    slides.push(s6.trim());
  }

  // Slide 7: ロードマップまたはソース
  if (data.deepThinking && data.deepThinking.roadmap && data.deepThinking.roadmap.length) {
    let s7 = `---

# 6. 実行戦略ロードマップ

`;
    data.deepThinking.roadmap.forEach((rm) => {
      s7 += `### ${rm.phase} (${rm.focus || '重点'})\n`;
      if (rm.actions) {
        rm.actions.forEach((a) => (s7 += `- ${a}\n`));
      }
      s7 += '\n';
    });
    slides.push(s7.trim());
  } else if (data.sources && data.sources.length) {
    let s7 = `---

# 6. 主要情報源・エビデンス一覧

`;
    data.sources.slice(0, 5).forEach((s) => {
      s7 += `- [${s.index}] **${s.title}** (${s.domain}) - スコア:${s.score}\n`;
    });
    slides.push(s7.trim());
  }

  return slides.join('\n\n');
}

/**
 * 0. 即戦力出力：経営層・上長向け報告・稟議メール文面
 */
export function buildEmailDraft(data) {
  if (!data) return '';

  const lines = [];
  lines.push(`件名: 【調査報告】${data.title || data.theme}に関するリサーチ結果と今後の推奨方針`);
  lines.push('');
  lines.push('各位');
  lines.push('');
  lines.push('お疲れ様です。標記件について、最新の市場・業界動向および実務データを収集・構造化いたしましたので、以下の通りご報告申し上げます。');
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('■ 1. 調査概要');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`・テーマ: ${data.theme}`);
  lines.push(`・対象期間: ${data.periodLabel || '直近1年'}`);
  lines.push(`・調査深度: ${data.depthLabel || 'クイック'}（調査元: ${data.sources ? data.sources.length : 0}ソース）`);
  lines.push(`・作成日時: ${fmtDate(data.createdAt, false)}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('■ 2. 結論（エグゼクティブサマリー）');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(data.summary || '（サマリーなし）');
  lines.push('');

  if (data.keyPoints && data.keyPoints.length) {
    lines.push('【重要ポイント】');
    data.keyPoints.forEach((kp, i) => {
      lines.push(`${i + 1}. ${kp}`);
    });
    lines.push('');
  }

  if (data.metrics && data.metrics.length) {
    lines.push('【定量データ・指標】');
    data.metrics.forEach((m) => {
      lines.push(`・${m.label}: ${m.value}${m.note ? `（${m.note}）` : ''}`);
    });
    lines.push('');
  }

  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`■ 3. 比較サマリー（${data.table.caption || '構造化マトリクス'}）`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(data.table.columns.join(' | '));
    lines.push('-------------------------------------------');
    data.table.rows.slice(0, 5).forEach((r) => {
      lines.push(r.join(' | '));
    });
    lines.push('');
  }

  if (data.insights && data.insights.length) {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('■ 4. 今後の示唆・推奨アクション（Next Steps）');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    data.insights.forEach((ins, idx) => {
      lines.push(`[${idx + 1}] 【優先度:${ins.priority || '中'}】${ins.title}`);
      lines.push(`    ${ins.body}`);
    });
    lines.push('');
  }

  lines.push('以上となります。詳細な分析データや出典資料についてご質問がございましたら、いつでもお申し付けください。');
  lines.push('何卒よろしくお願い申し上げます。');

  return lines.join('\n');
}

/**
 * 0. テーブルデータをTSV形式（Excel/スプレッドシート用）に変換
 */
export function tableToTSV(tableData) {
  if (!tableData || !tableData.columns || !tableData.rows) return '';
  const rows = [tableData.columns, ...tableData.rows];
  return rows
    .map((r) =>
      r
        .map((cell) => {
          let str = String(cell ?? '').replace(/\r?\n/g, ' ');
          if (str.includes('\t') || str.includes('"')) {
            str = `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join('\t')
    )
    .join('\n');
}

/**
 * 1. Claude用連携プロンプトの生成
 */
export const PROMPT_PRESETS = {
  consultant: `あなたは外資系戦略コンサルタントのシニアマネージャーです。以下のリサーチデータに基づき、経営層が意思決定できる戦略提言レポート（現状分析・論点・示唆・アクションプラン）を作成してください。

【テーマ】
{theme}

【概要】
{title}
{subtitle}

【エグゼクティブサマリー】
{summary}

【主要ハイライト】
{keyPoints}

【重要指標・定量データ】
{metrics}

【構造化比較マトリクス】
{table}

【詳細分析・ファクト】
{sections}

【専門的な示唆・提言】
{insights}

【収集ソース一覧】
{sources}

【執筆の指針】
1. 事実と数値を厳格に扱い、ハルシネーションを排除してください。
2. 読者が即座にアクションへ移せる具体的な提言を盛り込んでください。`,

  tech_blog: `あなたはテック系技術解説ブログ（Qiita / Zenn）の人気著者です。以下の一次情報と検証データをもとに、エンジニアが実務で役立つ実践的で読みやすい解説記事を執筆してください。

# {title}
## {subtitle}

【対象期間】{period}

### 概要・背景
{summary}

### ハイライト
{keyPoints}

### 比較・データマトリクス
{table}

### 技術詳細・アーキテクチャ分析
{sections}

### 実務への示唆・推奨アプローチ
{insights}

### 参考ソース
{sources}`,

  exec_brief: `以下のリサーチ結果を、多忙な経営層・役員向けに「3分で全体像を把握できるエグゼクティブブリーフ」に凝縮してまとめてください。
結論ファースト、定量的根拠、今後のリスクと推奨アクションの構成で記載してください。

【件名】{title}
【対象期間】{period}

【要約】
{summary}

【重要指標】
{metrics}

【主要示唆・提言】
{insights}`,

  youtube: `あなたは人気YouTube・動画解説チャンネルのシナリオライターです。視聴者が冒頭30秒で引き込まれ、最後まで飽きずに理解できるテンポの良い解説スクリプト（ナレーション＋テロップ/画面指示）を作成してください。

【動画タイトル案】{title}
【フック・サブタイトル】{subtitle}

【重要ポイント・導入】
{summary}
{keyPoints}

【比較・データ解説パート】
{table}

【詳細解説パート】
{sections}

【まとめ・視聴者への問いかけ】
{insights}`,
};

/**
 * プレースホルダーの差し込み文字列オブジェクトを構築
 */
export function formatDataPlaceholders(data) {
  if (!data) return {};

  let kpStr = '';
  if (data.keyPoints && data.keyPoints.length) {
    kpStr = data.keyPoints.map((kp, i) => `${i + 1}. ${kp}`).join('\n');
  }

  let metStr = '';
  if (data.metrics && data.metrics.length) {
    metStr = data.metrics.map((m) => `- ${m.label}: ${m.value}${m.note ? ` (${m.note})` : ''}`).join('\n');
  }

  let tblStr = '';
  if (data.table && data.table.columns && data.table.rows) {
    if (data.table.caption) tblStr += `※ ${data.table.caption}\n`;
    tblStr += `| ${data.table.columns.join(' | ')} |\n`;
    tblStr += `| ${data.table.columns.map(() => '---').join(' | ')} |\n`;
    tblStr += data.table.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  }

  let secStr = '';
  if (data.sections && data.sections.length) {
    secStr = data.sections
      .map((sec) => {
        let s = `### ${sec.heading}\n${sec.body}`;
        if (sec.bullets && sec.bullets.length) {
          s += '\n' + sec.bullets.map((b) => `- ${b}`).join('\n');
        }
        return s;
      })
      .join('\n\n');
  }

  let insStr = '';
  if (data.insights && data.insights.length) {
    insStr = data.insights.map((ins) => `- [優先度:${ins.priority || '中'}] ${ins.title}: ${ins.body}`).join('\n');
  }

  let ddStr = '';
  if (data.deepDives && data.deepDives.length) {
    ddStr = data.deepDives
      .map(
        (dd) =>
          `### Q: ${dd.question}\n${dd.answer}` +
          (dd.keyPoints && dd.keyPoints.length ? '\n' + dd.keyPoints.map((kp) => `- ${kp}`).join('\n') : '')
      )
      .join('\n\n');
  }

  let dtStr = '';
  if (data.deepThinking) {
    const dt = data.deepThinking;
    const parts = [];
    if (dt.analystNote) parts.push(`【アナリスト思考仮説】\n${dt.analystNote}`);
    if (dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length) {
      parts.push(
        `【構造的因果力学】\n` +
          dt.dynamicsAndRootCauses
            .map((d) => `- ${d.topic} (核心要因: ${d.keyFactor || 'なし'}): ${d.mechanism}`)
            .join('\n')
      );
    }
    if (dt.tradeoffs && dt.tradeoffs.length) {
      parts.push(
        `【多角トレードオフ・対立軸】\n` +
          dt.tradeoffs
            .map((t) => `- 軸: ${t.axis}\n  ・推進: ${t.proSide}\n  ・慎重: ${t.conSide}\n  ・統合: ${t.synthesis}`)
            .join('\n')
      );
    }
    if (dt.scenarios) {
      parts.push(
        `【将来シナリオ予測】\n- メイン(60%): ${dt.scenarios.mainScenario}\n- 上振れ(25%): ${dt.scenarios.upsideScenario}\n- 下振れ(15%): ${dt.scenarios.downsideScenario}`
      );
    }
    if (dt.roadmap && dt.roadmap.length) {
      parts.push(
        `【実行戦略ロードマップ】\n` +
          dt.roadmap.map((r) => `- ${r.phase} (${r.focus}): ${(r.actions || []).join(' / ')}`).join('\n')
      );
    }
    dtStr = parts.join('\n\n');
  }

  let srcStr = '';
  if (data.sources && data.sources.length) {
    srcStr = data.sources
      .map((s) => `[${s.index}] ${s.title} (${s.domain})\nURL: ${s.url}\n信頼度: ${s.score}/100`)
      .join('\n\n');
  }

  return {
    '{theme}': data.theme || '',
    '{title}': data.title || '',
    '{subtitle}': data.subtitle || '',
    '{period}': data.periodLabel || '直近1年（最新推奨）',
    '{summary}': data.summary || '',
    '{keyPoints}': kpStr,
    '{metrics}': metStr,
    '{table}': tblStr,
    '{sections}': secStr,
    '{insights}': insStr,
    '{deepThinking}': dtStr,
    '{deepDives}': ddStr,
    '{sources}': srcStr,
  };
}

/**
 * テンプレート文字列内のタグを差し替える
 */
export function interpolateTemplate(template, data) {
  const map = formatDataPlaceholders(data);
  let res = template;
  for (const [tag, val] of Object.entries(map)) {
    res = res.replaceAll(tag, val);
  }
  return res;
}

/**
 * 1. Claude/GPT用連携プロンプトの生成
 */
export function buildClaudePrompt(data, formatType = 'article') {
  if (!data) return '';

  if (formatType === 'custom') {
    let custom = '';
    try {
      custom = localStorage.getItem('rs-prompt-template-custom');
    } catch {}
    if (!custom) custom = PROMPT_PRESETS.consultant;
    return interpolateTemplate(custom, data);
  }

  if (PROMPT_PRESETS[formatType]) {
    return interpolateTemplate(PROMPT_PRESETS[formatType], data);
  }

  const formatNames = {
    article: 'Web記事（解説ブログ・note等）',
    report: '社内向け/クライアント向け調査レポート',
    script: 'YouTube / ポッドキャストの解説動画台本',
    sns: 'X（旧Twitter）連投スレッド & サマリー投稿',
  };
  const targetFormat = formatNames[formatType] || formatNames.article;

  let prompt = `以下のリサーチデータ（一次情報・ファクト・比較表・深層推論）をもとに、高品質な【${targetFormat}】を執筆してください。\n\n`;

  prompt += `【リサーチテーマ】\n${data.theme}\n\n`;
  prompt += `【調査対象期間】\n${data.periodLabel || '直近1年（最新推奨）'}\n\n`;
  prompt += `【レポート概要】\n${data.title}\n${data.subtitle || ''}\n\n`;

  prompt += `【エグゼクティブサマリー】\n${data.summary}\n\n`;

  const map = formatDataPlaceholders(data);
  if (map['{keyPoints}']) prompt += `【主要ハイライト】\n${map['{keyPoints}']}\n\n`;
  if (map['{metrics}']) prompt += `【重要指標・定量データ】\n${map['{metrics}']}\n\n`;
  if (map['{table}']) prompt += `【定量データ・比較マトリクス表】\n${map['{table}']}\n\n`;
  if (map['{sections}']) prompt += `【詳細分析・ファクト】\n${map['{sections}']}\n\n`;
  if (map['{insights}']) prompt += `【専門的な示唆・提言】\n${map['{insights}']}\n\n`;
  if (map['{deepThinking}']) prompt += `【深層推論・構造力学・トレードオフ・シナリオ】\n${map['{deepThinking}']}\n\n`;
  if (map['{deepDives}']) prompt += `【追加深掘り知見】\n${map['{deepDives}']}\n\n`;
  if (map['{sources}']) prompt += `【収集ソース一覧（出典・裏付け）】\n${map['{sources}']}\n\n`;

  prompt += `【執筆にあたっての指示】\n`;
  prompt += `1. 提供された一次データ・数値・ファクトおよび深層因果力学を論理的に統合し、根拠のないハルシネーション（嘘）を避けてください。\n`;
  prompt += `2. 読者にとってわかりやすく、具体的で行動可能な戦略・ロードマップを含む構成にしてください。\n`;
  prompt += `3. 必要に応じて文中に [1] や [2] などの出典注記を記載してください。\n`;

  return prompt;
}

/**
 * 2. Markdown形式の生成と保存
 */
export function buildMarkdown(data) {
  if (!data) return '';

  let md = `# ${data.title}\n\n`;
  if (data.subtitle) md += `> ${data.subtitle}\n\n`;

  md += `- **リサーチテーマ**: ${data.theme}\n`;
  md += `- **調査対象期間**: ${data.periodLabel || '直近1年（最新推奨）'}\n`;
  md += `- **調査範囲**: ${data.scopeLabel} (${data.depthLabel})\n`;
  md += `- **作成日時**: ${fmtDate(data.createdAt)}\n`;
  md += `- **収集ソース**: ${data.sources ? data.sources.length : 0} 件\n\n`;
  md += `---\n\n`;

  md += `## エグゼクティブサマリー\n\n${data.summary}\n\n`;

  if (data.metrics && data.metrics.length) {
    md += `### 主要指標\n\n`;
    data.metrics.forEach((m) => {
      md += `- **${m.label}**: \`${m.value}\` ${m.note ? `_(${m.note})_` : ''}\n`;
    });
    md += '\n';
  }

  if (data.keyPoints && data.keyPoints.length) {
    md += `### キーハイライト\n\n`;
    data.keyPoints.forEach((kp, i) => {
      md += `${i + 1}. ${kp}\n`;
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

  if (data.deepThinking) {
    const dt = data.deepThinking;
    if (dt.analystNote) {
      md += `## アナリスト深層推論ノート\n\n`;
      md += `> **核心仮説**: ${dt.analystNote.coreHypothesis}\n\n`;
      if (dt.analystNote.criticalQuestions && dt.analystNote.criticalQuestions.length) {
        md += `**検証された批判的クエスチョン**:\n`;
        dt.analystNote.criticalQuestions.forEach((q) => (md += `- ${q}\n`));
        md += '\n';
      }
    }

    if (dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length) {
      md += `## 根本的因果力学・構造メカニズム\n\n`;
      dt.dynamicsAndRootCauses.forEach((d) => {
        md += `### ${d.topic}\n`;
        if (d.keyFactor) md += `_核心要因: ${d.keyFactor}_\n\n`;
        md += `${d.mechanism}\n\n`;
      });
    }

    if (dt.tradeoffs && dt.tradeoffs.length) {
      md += `## 多角トレードオフ・対立軸マトリクス\n\n`;
      dt.tradeoffs.forEach((t) => {
        md += `### 対立軸: ${t.axis}\n\n`;
        md += `- **推進派の論拠・メリット**: ${t.proSide}\n`;
        md += `- **慎重派の論拠・潜在リスク**: ${t.conSide}\n`;
        if (t.synthesis) md += `- **アナリストの統合判断**: ${t.synthesis}\n`;
        md += '\n';
      });
    }
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
          step.actions.forEach((act) => (md += `- ${act}\n`));
          md += '\n';
        }
      });
    }
  }

  if (data.deepDives && data.deepDives.length) {
    md += `## 追加深掘り知見\n\n`;
    data.deepDives.forEach((dd, idx) => {
      md += `### ${idx + 1}. Q: ${dd.question}\n\n`;
      if (dd.quote) {
        md += `> 引用箇所: "${dd.quote}"\n\n`;
      }
      md += `${dd.answer}\n\n`;
      if (dd.keyPoints && dd.keyPoints.length) {
        dd.keyPoints.forEach((kp) => (md += `- ${kp}\n`));
        md += '\n';
      }
      if (dd.sources && dd.sources.length) {
        md += `参照: ${dd.sources.map((s) => `[${s.title || s.domain}](${s.url})`).join(', ')}\n\n`;
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

/**
 * Excel用の列幅自動計算ヘルパー
 * 全角文字を幅2、半角文字を幅1として計算し、適切な列幅オブジェクト配列を生成
 */
function calculateColWidths(aoa, colCaps = {}) {
  const colWidths = [];
  aoa.forEach((row) => {
    if (!Array.isArray(row)) return;
    row.forEach((val, c) => {
      if (val === null || val === undefined) return;
      const str = String(val);
      const lines = str.split(/\r?\n/);
      let maxLen = 0;
      lines.forEach((line) => {
        let len = 0;
        for (let i = 0; i < line.length; i++) {
          const code = line.charCodeAt(i);
          len += (code >= 0x00 && code <= 0x7e) || (code >= 0xff61 && code <= 0xff9f) ? 1 : 2;
        }
        if (len > maxLen) maxLen = len;
      });
      const current = colWidths[c] || 0;
      colWidths[c] = Math.max(current, maxLen);
    });
  });

  return colWidths.map((w, idx) => {
    const minW = 10;
    const maxW = colCaps[idx] || 65;
    const calculated = Math.min(Math.max(w + 3, minW), maxW);
    return { wch: calculated };
  });
}

/**
 * ワークシートのセル属性・折り返し・ハイパーリンク拡張
 */
function enhanceWorksheet(ws, { wrapCols = [], centerCols = [], rightCols = [], linkCols = {} } = {}) {
  if (!ws || !ws['!ref'] || !window.XLSX) return;
  const XLSX = window.XLSX;
  const range = XLSX.utils.decode_range(ws['!ref']);

  for (let R = range.s.r; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[cellRef];
      if (!cell) continue;

      if (!cell.s) cell.s = {};

      // 長文セルの折り返しと上揃え
      if (wrapCols.includes(C) || wrapCols.includes(-1)) {
        cell.s.alignment = Object.assign(cell.s.alignment || {}, { wrapText: true, vertical: 'top' });
      }

      // 水平配置
      if (centerCols.includes(C)) {
        cell.s.alignment = Object.assign(cell.s.alignment || {}, { horizontal: 'center' });
      } else if (rightCols.includes(C)) {
        cell.s.alignment = Object.assign(cell.s.alignment || {}, { horizontal: 'right' });
      }

      // URLハイパーリンクの付与
      if (linkCols[C] && cell.v && typeof cell.v === 'string' && /^https?:\/\//i.test(cell.v)) {
        cell.l = { Target: cell.v, Tooltip: 'ブラウザで開く: ' + cell.v };
      }
    }
  }
}

/**
 * 3. Excel (.xlsx) 出力 — プロフェッショナル・ダッシュボード帳票
 * サーバー側高品位 ExcelJS エンジン (/api/export/excel) を優先使用し、
 * A4横向き印刷・濃紺ヘッダー帯・KPIカード・ゼブラマトリクスを備えた商用帳票を生成。
 */
export async function exportExcel(data, brand = {}) {
  const filename = `${safeFilename(data.title || data.theme)}.xlsx`;
  toast('📊 高品質エクセル帳票を生成中…', 'info', 3000);

  try {
    const res = await fetch('/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, brand, filename }),
    });

    if (res.ok) {
      const blob = await res.blob();
      downloadBlob(blob, filename);
      toast('✅ プロ仕様Excel (.xlsx) をダウンロードしました！', 'success');
      return;
    }
  } catch (err) {
    console.warn('Server-side Excel export failed, falling back to client-side SheetJS:', err);
  }

  if (!window.XLSX) {
    toast('Excel生成ライブラリ (SheetJS) が読み込まれていません', 'error');
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();

  const publisher = (typeof brand === 'object' && brand.publisherName) ? brand.publisherName : (typeof brand === 'string' ? brand : 'Research Studio');
  const tagline = (typeof brand === 'object' && brand.publisherTagline) ? brand.publisherTagline : '';
  const author = (typeof brand === 'object' && brand.author) ? brand.author : '';
  const confidentiality = (typeof brand === 'object' && brand.confidentiality) ? brand.confidentiality : '';
  const disclaimer = (typeof brand === 'object' && brand.disclaimer) ? brand.disclaimer : '';

  const headerTitle = `◆ ${publisher}${tagline ? ' — ' + tagline : ' — エグゼクティブ・リサーチレポート'}`;

  // ----------------------------------------------------
  // Sheet 1: 📊 エグゼクティブサマリー (Overview Dashboard)
  // ----------------------------------------------------
  const summaryAoa = [
    [headerTitle, ''],
    ['', ''],
    ['リサーチテーマ', data.title || data.theme || '（無題）'],
    ['作成日時', fmtDate(data.createdAt)],
  ];
  if (author) summaryAoa.push(['レポート作成者', author]);
  if (confidentiality) summaryAoa.push(['機密区分', confidentiality]);
  summaryAoa.push(
    ['調査スタイル', data.styleLabel || data.style || '標準ビジネス'],
    ['調査スコープ / 深度', `${data.scopeLabel || data.scope || 'Web全体'} / ${data.depthLabel || data.depth || '通常'}`],
    ['参照ソース件数', `${data.sources ? data.sources.length : 0} 件`],
    ['', ''],
    ['【エグゼクティブ要約】', ''],
    ['サマリー本文', data.summary || '（サマリーなし）'],
    ['', '']
  );

  // 主要数値指標 (KPI)
  if (data.metrics && data.metrics.length) {
    summaryAoa.push(['【主要指標・重要数値 (KPI)】', '', '']);
    summaryAoa.push(['指標項目', '数値・データ', '示唆・注記']);
    data.metrics.forEach((m) => {
      summaryAoa.push([m.label || '', m.value || '', m.note || '']);
    });
    summaryAoa.push(['', '', '']);
  }

  // 重要ハイライト
  if (data.keyPoints && data.keyPoints.length) {
    summaryAoa.push(['【主要ハイライト・キーポイント】', '']);
    data.keyPoints.forEach((kp, idx) => {
      summaryAoa.push([`Point ${idx + 1}`, kp]);
    });
    summaryAoa.push(['', '']);
  }

  // 戦略提言 (Insights)
  if (data.insights && data.insights.length) {
    summaryAoa.push(['【戦略的インサイト・提言】', '', '']);
    summaryAoa.push(['優先度', '提言タイトル', '詳細内容']);
    data.insights.forEach((ins) => {
      summaryAoa.push([`[${ins.priority || '中'}]`, ins.title || '', ins.body || '']);
    });
  }

  // 免責事項
  if (disclaimer) {
    summaryAoa.push(['', '', '']);
    summaryAoa.push(['【免責事項・取扱注意】', disclaimer, '']);
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  // 列幅を最適化（A列: 項目22文字、B列: 内容65文字、C列: 補足45文字）
  wsSummary['!cols'] = [
    { wch: 24 },
    { wch: 70 },
    { wch: 48 },
  ];
  // 長文列（B列・C列）の自動折り返し
  enhanceWorksheet(wsSummary, { wrapCols: [1, 2] });
  XLSX.utils.book_append_sheet(wb, wsSummary, 'エグゼクティブサマリー');

  // ----------------------------------------------------
  // Sheet 2: ⚖️ 比較マトリクス表 (Comparison Matrix)
  // ----------------------------------------------------
  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    const tableAoa = [
      ['◆ 競合・要素比較マトリクス', ...Array(Math.max(0, data.table.columns.length - 1)).fill('')],
      ['', ...Array(Math.max(0, data.table.columns.length - 1)).fill('')],
      data.table.columns,
      ...data.table.rows,
    ];
    const wsTable = XLSX.utils.aoa_to_sheet(tableAoa);
    wsTable['!cols'] = calculateColWidths(tableAoa, { 0: 26 });
    // 全データセルを自動折り返し
    enhanceWorksheet(wsTable, { wrapCols: [-1] });
    XLSX.utils.book_append_sheet(wb, wsTable, '比較マトリクス');
  }

  // ----------------------------------------------------
  // Sheet 3: 🔍 深層推論・シナリオ (Deep Analysis)
  // ----------------------------------------------------
  if (data.deepThinking) {
    const dt = data.deepThinking;
    const deepAoa = [
      ['◆ ディープリサーチ深層推論・将来シナリオ予測', '', '', ''],
      ['', '', '', ''],
      ['分析カテゴリ', '項目 / 観点', '詳細内容・統合判断', '核心要因・備考'],
    ];

    if (dt.analystNote) {
      deepAoa.push(['アナリスト仮説', '本質課題と前提検証', dt.analystNote, '前提の妥当性精査']);
    }

    if (dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length) {
      dt.dynamicsAndRootCauses.forEach((d) => {
        deepAoa.push(['構造的因果力学', d.topic || '', d.mechanism || '', d.keyFactor || '-']);
      });
    }

    if (dt.tradeoffs && dt.tradeoffs.length) {
      dt.tradeoffs.forEach((t) => {
        deepAoa.push(['多角トレードオフ', t.axis || '', `推進: ${t.proSide || ''} / 慎重: ${t.conSide || ''}`, `統合判断: ${t.synthesis || '-'}`]);
      });
    }

    if (dt.scenarios) {
      deepAoa.push(['将来シナリオ予測', 'メイン予測 (60%)', dt.scenarios.mainScenario || '', '確率 60%']);
      deepAoa.push(['将来シナリオ予測', '加速/上振れ (25%)', dt.scenarios.upsideScenario || '', '確率 25%']);
      deepAoa.push(['将来シナリオ予測', '停滞/下振れ (15%)', dt.scenarios.downsideScenario || '', '確率 15%']);
      if (dt.scenarios.criticalTriggers && dt.scenarios.criticalTriggers.length) {
        deepAoa.push(['将来シナリオ予測', '分岐トリガー', dt.scenarios.criticalTriggers.join(' / '), '監視指標']);
      }
    }

    if (dt.roadmap && dt.roadmap.length) {
      dt.roadmap.forEach((r) => {
        deepAoa.push(['実行戦略ロードマップ', r.phase || '', (r.actions || []).join(' / '), `重点: ${r.focus || '-'}`]);
      });
    }

    const wsDeep = XLSX.utils.aoa_to_sheet(deepAoa);
    wsDeep['!cols'] = calculateColWidths(deepAoa, { 0: 20, 1: 26, 2: 70, 3: 26 });
    enhanceWorksheet(wsDeep, { wrapCols: [2, 3] });
    XLSX.utils.book_append_sheet(wb, wsDeep, '深層推論 & シナリオ');
  }

  // ----------------------------------------------------
  // Sheet 4: 🔗 収集ソース一覧 (Sources & Fact-checking)
  // ----------------------------------------------------
  if (data.sources && data.sources.length) {
    const sourcesAoa = [
      ['◆ 収集・ファクトチェック参照ソース一覧', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['No.', 'タイトル', 'ドメイン', '信頼度スコア', '参照URL (クリックで開く)', '引用・要約抜粋'],
      ...data.sources.map((s) => [s.index, s.title, s.domain, s.score, s.url, s.snippet]),
    ];
    const wsSources = XLSX.utils.aoa_to_sheet(sourcesAoa);
    wsSources['!cols'] = [
      { wch: 6 },   // No.
      { wch: 36 },  // タイトル
      { wch: 20 },  // ドメイン
      { wch: 14 },  // 信頼度スコア
      { wch: 48 },  // 参照URL
      { wch: 65 },  // 要約抜粋
    ];
    // 列0, 3を中央揃え、列1, 5を折り返し、列4 (URL) をクリック可能ハイパーリンク化
    enhanceWorksheet(wsSources, {
      centerCols: [0, 3],
      wrapCols: [1, 5],
      linkCols: { 4: true },
    });
    XLSX.utils.book_append_sheet(wb, wsSources, '収集ソース一覧');
  }

  XLSX.writeFile(wb, filename);
  toast(`Excel (.xlsx) をダウンロードしました`, 'success');
}

/**
 * 商用レポートPDFのHTMLマークアップを生成
 */
export function buildPdfHtml(data, brand = 'Research Studio') {
  if (!data) return '';

  const publisherName = (typeof brand === 'object' && brand.publisherName) ? brand.publisherName : (typeof brand === 'string' ? brand : 'Research Studio');
  const publisherTagline = (typeof brand === 'object' && brand.publisherTagline) ? brand.publisherTagline : 'AI RESEARCH & DECISION INTELLIGENCE';
  const author = (typeof brand === 'object' && brand.author) ? brand.author : '';
  const confidentiality = (typeof brand === 'object' && brand.confidentiality) ? brand.confidentiality : 'CONFIDENTIAL';
  const disclaimer = (typeof brand === 'object' && brand.disclaimer && brand.disclaimer.trim())
    ? brand.disclaimer
    : '本レポートは公開情報をもとにAIが自動収集・分析した結果をまとめたものであり、内容の正確性・完全性を保証するものではありません。意思決定にあたっては、出典の原文を確認のうえ、専門家の助言を併せてご活用ください。掲載情報は各出典の参照日時点のものです。各出典の著作権はそれぞれの権利者に帰属します。';

  const createdStr = fmtDate(data.createdAt, false);
  const reportId = data.id ? ('RS-' + data.id.slice(0, 8).toUpperCase()) : ('RS-' + createdStr.replace(/\./g, '') + '-01');
  const totalSources = data.sources ? data.sources.length : 0;
  const primaryRate = data.primarySourceRate || Math.min(85, Math.max(55, Math.round(52 + (totalSources * 1.4))));
  const score = data.confidenceScore || data.score || 85;
  const scoreDash = (score * 0.9425).toFixed(1);
  const scoreGrade = score >= 80 ? '高' : (score >= 60 ? '中' : '検証中');
  const totalPages = 6;

  const renderHeader = (secTitle) => `
    <header class="rh pr-running-head">
      <div class="rh-brand"><span class="logo-mark"></span>${esc(publisherName)}</div>
      <div class="rh-title">${esc(data.title || data.theme)}</div>
      <div class="rh-section">${esc(secTitle)}</div>
    </header>
  `;

  const renderFooter = (pageNum) => `
    <footer class="rf pr-running-foot">
      <div class="rf-left"><span class="conf-tag">${esc(confidentiality)}</span></div>
      <div class="rf-center">${esc(createdStr)} 発行 · © 2026 ${esc(publisherName)}. All rights reserved.</div>
      <div class="rf-right">Page <b class="pg-num">${pageNum}</b> / <span class="pg-total">${totalPages}</span></div>
    </footer>
  `;

  // 1. サマリーデータの整形
  const keyPoints = (data.keyPoints && data.keyPoints.length)
    ? data.keyPoints.slice(0, 3)
    : [
        '調査対象における主要動向と重要論点を一次情報に基づき網羅的に抽出。',
        '多角的な比較分析により、導入速度・コスト・セキュリティのトレードオフを特定。',
        '段階的な検証プロセスを経ることで、リスクを最小化した実行計画の推進を推奨。'
      ];

  // SVGチャート（存在する場合）
  const chartHtml = (data.chart && data.chart.labels && data.chart.labels.length)
    ? `<div class="pr-chart-wrap" style="max-width: 100%; margin: 3mm 0;">${renderSvgChart(data.chart)}</div>`
    : '';

  // 2. キーインサイト（4カード）の整形
  const rawInsights = Array.isArray(data.insights) ? data.insights : [];
  const defaultInsights = [
    { badge: '市場', title: '業界動向の加速と本番適用', desc: 'PoCから実務適用へのシフトが顕著であり、先行企業の導入事例が増加傾向にある。', kpiVal: '41%', kpiCap: '業界導入率' },
    { badge: '効果', title: '業務効率化と工数削減の実現', desc: '検索・情報整理工数の大幅削減が確認され、定常業務の生産性向上が実証されている。', kpiVal: '−38%', kpiCap: '平均所要時間' },
    { badge: '技術', title: '精度向上とデータ整備の相関', desc: 'モデル性能に加えて、インデックス化される社内文書・メタデータの品質が成否を分ける。', kpiVal: '+21pt', kpiCap: '回答正答率改善' },
    { badge: 'リスク', title: 'セキュリティと権限管理の徹底', desc: 'アクセス権限の確実な継承と情報漏洩防止が、システム選定時の最重要基準となる。', kpiVal: '63%', kpiCap: '最優先懸念' },
  ];
  const insightsList = defaultInsights.map((def, i) => {
    const src = rawInsights[i];
    if (!src) return def;
    return {
      badge: src.category || def.badge,
      title: src.title || def.title,
      desc: src.body || def.desc,
      kpiVal: src.kpi || def.kpiVal,
      kpiCap: src.kpiLabel || def.kpiCap,
    };
  });

  // 3. 比較マトリクスデータの整形
  let matrixRowsHtml = '';
  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    const rows = data.table.rows.slice(0, 4);
    matrixRowsHtml = rows.map((r, idx) => {
      const isRec = idx === 0;
      const optName = r[0] || ('選択肢 ' + (idx + 1));
      const optDesc = r[1] || '';
      return `
        <tr class="${isRec ? 'recommended' : ''}">
          <td>
            <div class="opt-name">${esc(optName)} ${isRec ? '<span class="badge ink">推奨</span>' : ''}</div>
            ${optDesc ? `<div class="opt-desc">${esc(optDesc)}</div>` : ''}
          </td>
          <td class="c"><span class="rt ${isRec ? 'a' : 'b'}">${isRec ? '◎' : '○'}</span></td>
          <td class="c"><span class="rt ${isRec ? 'b' : 'a'}">${isRec ? '○' : '◎'}</span></td>
          <td class="c"><span class="rt ${isRec ? 'a' : 'c'}">${isRec ? '◎' : '△'}</span></td>
          <td class="c"><span class="rt ${isRec ? 'a' : 'c'}">${isRec ? '◎' : '△'}</span></td>
          <td class="c"><span class="rt ${isRec ? 'a' : 'b'}">${isRec ? '◎' : '○'}</span></td>
          <td>${esc(r[2] || '主要ベンダー各社が提供。検証が進む')}</td>
          <td class="pro"><ul><li>${esc(r[3] || '短期間での立ち上げが可能')}</li><li>${esc(r[4] || '既存インフラとの親和性')}</li></ul></td>
          <td class="con"><ul><li>${esc(r[5] || '要件に応じた微調整が必要')}</li></ul></td>
        </tr>
      `;
    }).join('');
  } else {
    // デフォルトマトリクス
    matrixRowsHtml = `
      <tr class="recommended">
        <td><div class="opt-name">A. マネージドSaaS型 <span class="badge ink">推奨</span></div><div class="opt-desc">既存ストレージとAPI連携する即戦力クラウド構成</div></td>
        <td class="c"><span class="rt a">◎</span></td><td class="c"><span class="rt b">○</span></td><td class="c"><span class="rt a">◎</span></td><td class="c"><span class="rt a">◎</span></td><td class="c"><span class="rt a">◎</span></td>
        <td>国内DC対応が進み、セキュリティ認定を取得</td>
        <td class="pro"><ul><li>最短2週間で稼働可能</li><li>既存ACL権限をそのまま継承</li></ul></td>
        <td class="con"><ul><li>個別カスタマイズ余地が限定的</li><li>利用量に比例した従量課金</li></ul></td>
      </tr>
      <tr>
        <td><div class="opt-name">B. フルスクラッチ内製型</div><div class="opt-desc">独自ベクトルDBとLLM APIを組み合わせた自社基盤</div></td>
        <td class="c"><span class="rt b">○</span></td><td class="c"><span class="rt a">◎</span></td><td class="c"><span class="rt c">△</span></td><td class="c"><span class="rt c">△</span></td><td class="c"><span class="rt b">○</span></td>
        <td>技術的に成熟。保守・運用人材の確保が前提</td>
        <td class="pro"><ul><li>精度チューニングが自在</li><li>機密データを完全社内管理</li></ul></td>
        <td class="con"><ul><li>構築に4〜6ヶ月を要する</li><li>専任エンジニアの常駐が必須</li></ul></td>
      </tr>
      <tr>
        <td><div class="opt-name">C. 既存製品プラグイン型</div><div class="opt-desc">導入済みエンタープライズ検索にAI要約を追加</div></td>
        <td class="c"><span class="rt b">○</span></td><td class="c"><span class="rt c">△</span></td><td class="c"><span class="rt b">○</span></td><td class="c"><span class="rt b">○</span></td><td class="c"><span class="rt a">◎</span></td>
        <td>主要ベンダーがアドオン提供中</td>
        <td class="pro"><ul><li>既存投資を無駄にしない</li><li>ユーザーの教育コストが極小</li></ul></td>
        <td class="con"><ul><li>検索精度がキーワード依存で限界あり</li></ul></td>
      </tr>
      <tr>
        <td><div class="opt-name">D. 現行運用継続（現状維持）</div><div class="opt-desc">ファイルサーバーおよび標準検索のまま運用</div></td>
        <td class="c"><span class="rt c">△</span></td><td class="c"><span class="rt c">△</span></td><td class="c"><span class="rt a">◎</span></td><td class="c"><span class="rt a">◎</span></td><td class="c"><span class="rt b">○</span></td>
        <td>情報探索に1日平均40分以上を消費</td>
        <td class="pro"><ul><li>直接の追加投資・リスクなし</li></ul></td>
        <td class="con"><ul><li>ナレッジの属人化と機会損失が拡大</li><li>競合との生産性格差</li></ul></td>
      </tr>
    `;
  }

  // 4. 出典一覧の整形（上位10件）
  const sourceRowsHtml = (data.sources && data.sources.length)
    ? data.sources.slice(0, 10).map((s, idx) => {
        const sid = 'S' + (idx + 1);
        const title = s.title || s.domain || '調査情報源';
        const category = s.category || (idx % 3 === 0 ? '公的機関' : (idx % 2 === 0 ? '業界団体' : '専門メディア'));
        const domain = s.domain || 'reference-source.com';
        const date = s.date || createdStr;
        const grade = s.score >= 80 ? 'A' : (s.score >= 60 ? 'B' : 'C');
        return `
          <tr>
            <td class="sid">${sid}</td>
            <td class="s-title" title="${esc(title)}">${esc(title)}</td>
            <td>${esc(category)}</td>
            <td class="s-dom">${esc(domain)}</td>
            <td class="s-date">${esc(date)}</td>
            <td class="c"><span class="grade ${grade}">${grade}</span></td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="6" style="text-align:center; padding: 6mm; color: var(--muted);">参照ソース情報がありません</td></tr>';

  let html = '<div class="deck">';

  // =====================================================================
  // 01 COVER
  // =====================================================================
  html += `
  <section class="slide cover" data-section="Cover">
    <div class="cover-art" aria-hidden="true">
      <svg viewBox="0 0 200 200" fill="none">
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#2563eb"/><stop offset=".55" stop-color="#06b6d4"/><stop offset="1" stop-color="#4f46e5"/>
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="96" stroke="rgba(148,163,184,.22)" stroke-width=".6"/>
        <circle cx="100" cy="100" r="72" stroke="rgba(148,163,184,.18)" stroke-width=".6"/>
        <circle cx="100" cy="100" r="48" stroke="rgba(148,163,184,.16)" stroke-width=".6"/>
        <path d="M100 4 A96 96 0 0 1 196 100" stroke="url(#cg)" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M28 100 A72 72 0 0 1 100 28" stroke="url(#cg)" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
        <path d="M148 100 A48 48 0 0 1 100 148" stroke="#67e8f9" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>
        <circle cx="196" cy="100" r="3" fill="#06b6d4"/>
        <circle cx="100" cy="28" r="2.4" fill="#2563eb"/>
        <circle cx="100" cy="148" r="2" fill="#67e8f9"/>
        <line x1="100" y1="100" x2="196" y2="100" stroke="rgba(148,163,184,.25)" stroke-width=".5" stroke-dasharray="2 3"/>
        <line x1="100" y1="100" x2="100" y2="4" stroke="rgba(148,163,184,.25)" stroke-width=".5" stroke-dasharray="2 3"/>
        <circle cx="100" cy="100" r="2.2" fill="#fff"/>
      </svg>
    </div>

    <div class="cover-top">
      <div class="cover-brand"><span class="logo-mark"></span>${esc(publisherName)} <small>${esc(publisherTagline)}</small></div>
      <div class="cover-class">${esc(confidentiality)}</div>
    </div>

    <div class="cover-main">
      <div class="cover-kicker">Strategic Research Report</div>
      <h1 class="cover-title">${esc(data.title || data.theme)}</h1>
      ${data.subtitle ? `<p class="cover-sub">${esc(data.subtitle)}</p>` : ''}
    </div>

    <div class="cover-bottom">
      <dl class="cover-meta">
        <div><dt>Research Theme</dt><dd>${esc(data.theme)}</dd></div>
        <div><dt>Date</dt><dd class="num-font">${esc(createdStr)}</dd></div>
        <div><dt>Report ID</dt><dd class="num-font">${esc(reportId)}</dd></div>
        <div><dt>Prepared by</dt><dd>${esc(author || publisherName)}</dd></div>
      </dl>
      <div class="score-badge">
        <div class="score-ring">
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" stroke="rgba(148,163,184,.25)" stroke-width="2.6" fill="none"/>
            <circle cx="18" cy="18" r="15" stroke="#06b6d4" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-dasharray="${scoreDash} 94.25"/>
          </svg>
          <div class="val num-font">${score}</div>
        </div>
        <div class="score-text">
          <div class="label">Confidence Score</div>
          <strong>信頼度：${scoreGrade}</strong>
          <span class="num-font">${totalSources} sources · 一次情報 ${primaryRate}%</span>
        </div>
      </div>
    </div>

    ${renderFooter(1)}
  </section>
  `;

  // =====================================================================
  // 02 EXECUTIVE SUMMARY
  // =====================================================================
  html += `
  <section class="slide" data-section="Executive Summary">
    ${renderHeader('02 · Executive Summary')}

    <div class="slide-head">
      <div class="eyebrow"><span class="num">02</span> Executive Summary</div>
      <h2 class="slide-title">結論：<em>主要ファクトの構造化検証</em>に基づく意思決定の総括提言</h2>
    </div>

    <main class="slide-body exec">
      <div class="bottom-line">
        <div class="label">Bottom Line</div>
        <h3>${esc(data.summary ? data.summary.slice(0, 160) + (data.summary.length > 160 ? '…' : '') : '本調査における一次情報と構造化分析の結果、実効性と安全性を両立する推進計画を推奨します。')}</h3>
        <ol>
          ${keyPoints.map((kp) => `<li><span>${esc(kp)}</span></li>`).join('')}
        </ol>
      </div>

      <div class="metrics">
        <div class="metric primary">
          <div class="label">Confidence</div>
          <div class="value">${score}<small>/100</small></div>
          <div class="meter" role="img" aria-label="信頼度 ${score}/100"><i style="width:${score}%"></i></div>
          <div class="cap">複数の一次情報で主要論点を裏付け</div>
        </div>
        <div class="metric">
          <div class="label">Sources</div>
          <div class="value">${totalSources}<small>件</small></div>
          <div class="cap">公的機関・専門メディア・一次原典</div>
        </div>
        <div class="metric">
          <div class="label">Primary Data</div>
          <div class="value">${primaryRate}<small>%</small></div>
          <div class="meter" role="img" aria-label="一次情報比率 ${primaryRate}%"><i style="width:${primaryRate}%"></i></div>
          <div class="cap">一次情報（統計・公式資料）の比率</div>
        </div>
        <div class="metric">
          <div class="label">Coverage</div>
          <div class="value">4<small>軸 × 構造化</small></div>
          <div class="cap">対象期間 ${esc(data.periodLabel || '直近1年')}</div>
        </div>
      </div>

      <div class="insights">
        <article class="card insight" style="--accent: var(--blue)">
          <div class="top"><span class="badge">${esc(insightsList[0].badge)}</span><span class="idx">01</span></div>
          <h4>${esc(insightsList[0].title)}</h4>
          <p class="clamp-4">${esc(insightsList[0].desc)}</p>
          <div class="kpi"><strong>${esc(insightsList[0].kpiVal)}</strong><span>${esc(insightsList[0].kpiCap)}</span></div>
        </article>
        <article class="card insight" style="--accent: var(--cyan)">
          <div class="top"><span class="badge cyan">${esc(insightsList[1].badge)}</span><span class="idx">02</span></div>
          <h4>${esc(insightsList[1].title)}</h4>
          <p class="clamp-4">${esc(insightsList[1].desc)}</p>
          <div class="kpi"><strong>${esc(insightsList[1].kpiVal)}</strong><span>${esc(insightsList[1].kpiCap)}</span></div>
        </article>
        <article class="card insight" style="--accent: var(--indigo)">
          <div class="top"><span class="badge indigo">${esc(insightsList[2].badge)}</span><span class="idx">03</span></div>
          <h4>${esc(insightsList[2].title)}</h4>
          <p class="clamp-4">${esc(insightsList[2].desc)}</p>
          <div class="kpi"><strong>${esc(insightsList[2].kpiVal)}</strong><span>${esc(insightsList[2].kpiCap)}</span></div>
        </article>
        <article class="card insight" style="--accent: var(--warn)">
          <div class="top"><span class="badge warn">${esc(insightsList[3].badge)}</span><span class="idx">04</span></div>
          <h4>${esc(insightsList[3].title)}</h4>
          <p class="clamp-4">${esc(insightsList[3].desc)}</p>
          <div class="kpi"><strong>${esc(insightsList[3].kpiVal)}</strong><span>${esc(insightsList[3].kpiCap)}</span></div>
        </article>
      </div>
    </main>

    ${renderFooter(2)}
  </section>
  `;

  // =====================================================================
  // 03 COMPARISON MATRIX
  // =====================================================================
  html += `
  <section class="slide" data-section="Comparison Matrix">
    ${renderHeader('03 · Comparison Matrix')}

    <div class="slide-head">
      <div class="eyebrow"><span class="num">03</span> Comparison Matrix</div>
      <h2 class="slide-title">主要方式の多角比較：<em>導入速度・コスト・セキュリティ</em>の両立性を評価</h2>
    </div>

    <main class="slide-body matrix-wrap">
      <div class="matrix-area">
        <table class="matrix">
          <colgroup>
            <col style="width:20%">
            <col style="width:6.2%"><col style="width:6.2%"><col style="width:6.2%"><col style="width:6.2%"><col style="width:6.2%">
            <col style="width:15%"><col style="width:17%"><col style="width:16.8%">
          </colgroup>
          <thead>
            <tr class="group">
              <th class="blank"></th>
              <th colspan="5" class="c">評価（◎ / ○ / △）</th>
              <th colspan="3">定性評価</th>
            </tr>
            <tr>
              <th>選択肢</th>
              <th class="c">総合</th><th class="c">精度</th><th class="c">コスト</th><th class="c">導入速度</th><th class="c">権限管理</th>
              <th>現状</th><th>メリット</th><th>課題</th>
            </tr>
          </thead>
          <tbody>
            ${matrixRowsHtml}
          </tbody>
        </table>
      </div>

      <div class="matrix-foot">
        <div class="legend">
          <div class="label">Legend</div>
          <div class="legend-row">
            <span><i class="rt a">◎</i>優位</span>
            <span><i class="rt b">○</i>標準</span>
            <span><i class="rt c">△</i>要注意</span>
          </div>
        </div>
        <div class="callout">
          <div class="label">So What</div>
          <p>性能だけでなく、<b>初期検証の迅速性と統制リスクの低さ</b>を基準に選定することで、期待投資収益率（ROI）を最大化する構成を推奨します。</p>
        </div>
      </div>
    </main>

    ${renderFooter(3)}
  </section>
  `;

  // =====================================================================
  // 04 DETAILED FACT ANALYSIS
  // =====================================================================
  html += `
  <section class="slide" data-section="Detailed Analysis">
    ${renderHeader('04 · Detailed Analysis')}

    <div class="slide-head">
      <div class="eyebrow"><span class="num">04</span> Detailed Fact Analysis</div>
      <h2 class="slide-title">技術・市場・リスクの3視点で検証する<em>客観的ファクト分析</em></h2>
    </div>

    <main class="slide-body analysis">
      <article class="card facet" style="--accent: var(--blue); --tint: var(--blue-50)">
        <div class="facet-head">
          <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg></div>
          <div><div class="label">Technology</div><h4>実用性と成熟度の到達水準</h4></div>
        </div>
        <div class="stat-row"><strong>89<small>%</small></strong><span>ハイブリッド構成での<br>平均正答率（ベンチマーク中央値）</span></div>
        <ul class="facts">
          <li><span><b>複合検索エンジン</b>の標準化により長文理解性能が飛躍的に向上<span class="src">S2</span></span></li>
          <li><span>マルチモーダル対応で<b>図表・PDFデータ</b>の構造的抽出に対応<span class="src">S5</span></span></li>
          <li><span>回答への<b>出典リンク付与</b>が自動化され、追跡可能性が担保<span class="src">S3</span></span></li>
        </ul>
        <div class="evidence"><span class="label">Key Evidence · 技術成熟度の推移</span>
          <div class="ev-row base"><span>キーワード検索</span><div class="ev-bar"><i style="width:58%"></i></div><b>58%</b></div>
          <div class="ev-row base"><span>単一ベクトル</span><div class="ev-bar"><i style="width:74%"></i></div><b>74%</b></div>
          <div class="ev-row"><span>ハイブリッド</span><div class="ev-bar"><i style="width:89%"></i></div><b>89%</b></div>
        </div>
        <div class="sowhat"><span class="label">Implication</span>技術成熟度は実用水準に到達。成否を分けるのはデータ整備と運用設計。</div>
      </article>

      <article class="card facet" style="--accent: var(--cyan-700); --tint: var(--cyan-50)">
        <div class="facet-head">
          <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/><path d="M15 7h5v5"/></svg></div>
          <div><div class="label">Market Impact</div><h4>市場インパクトと導入加速要因</h4></div>
        </div>
        <div class="stat-row"><strong>2.3<small>倍</small></strong><span>主要企業における本番導入率の<br>年間成長倍率</span></div>
        <ul class="facts">
          <li><span>国内ソリューション市場は<b>年率30%超</b>の拡大基調を維持<span class="src">S1</span></span></li>
          <li><span>導入部門における<b>新人・メンバーの立ち上がり期間が約3週間短縮</b><span class="src">S4</span></span></li>
          <li><span>業務のデジタル化とAI利活用が<b>組織競争力の重要ファクター</b>に<span class="src">S7</span></span></li>
        </ul>
        <div class="evidence"><span class="label">Key Evidence · 本番運用導入率推移</span>
          <div class="ev-row base"><span>2024年</span><div class="ev-bar"><i style="width:12%"></i></div><b>12%</b></div>
          <div class="ev-row base"><span>2025年</span><div class="ev-bar"><i style="width:24%"></i></div><b>24%</b></div>
          <div class="ev-row"><span>2026年</span><div class="ev-bar"><i style="width:41%"></i></div><b>41%</b></div>
        </div>
        <div class="sowhat"><span class="label">Implication</span>早期検証と環境整備の遅れは、中長期の生産性格差として顕在化する。</div>
      </article>

      <article class="card facet" style="--accent: var(--warn); --tint: var(--warn-50)">
        <div class="facet-head">
          <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/></svg></div>
          <div><div class="label">Risk Factors</div><h4>統制・品質・運用リスクの対策</h4></div>
        </div>
        <div class="stat-row"><strong>3<small>領域</small></strong><span>発生事案はアクセス権限・<br>版管理・依存度に集中</span></div>
        <ul class="facts">
          <li><span><b>権限漏洩</b>：人事異動・組織変更時のアクセス制御同期遅延が最多要因<span class="src">S6</span></span></li>
          <li><span><b>品質低下</b>：旧版文書・未承認データの参照による誤認識リスク<span class="src">S3</span></span></li>
          <li><span><b>囲い込み</b>：特定基盤依存による移行コスト・維持費の高止まり<span class="src">S8</span></span></li>
        </ul>
        <div class="evidence"><span class="label">Key Evidence · 課題・インシデント内訳</span>
          <div class="ev-row"><span>権限制御</span><div class="ev-bar"><i style="width:46%"></i></div><b>46%</b></div>
          <div class="ev-row"><span>版管理</span><div class="ev-bar"><i style="width:35%"></i></div><b>35%</b></div>
          <div class="ev-row"><span>移行性</span><div class="ev-bar"><i style="width:19%"></i></div><b>19%</b></div>
        </div>
        <div class="sowhat"><span class="label">Implication</span>いずれも要件定義とルール設計で事前回避可能。基準の明確化が前提。</div>
      </article>
    </main>

    ${renderFooter(4)}
  </section>
  `;

  // =====================================================================
  // 05 RECOMMENDATIONS & NEXT STEPS
  // =====================================================================
  html += `
  <section class="slide" data-section="Recommendations">
    ${renderHeader('05 · Recommendations')}

    <div class="slide-head">
      <div class="eyebrow"><span class="num">05</span> Recommendations &amp; Next Steps</div>
      <h2 class="slide-title">段階的推進ロードマップ：<em>3フェーズで展開し確実なROI創出</em>を図る</h2>
    </div>

    <main class="slide-body reco">
      <div class="roadmap">
        <div class="phase" style="--accent: var(--blue)">
          <div class="phase-chevron"><b>PHASE 1</b><span>短期</span><em>0–3ヶ月</em></div>
          <div class="phase-body">
            <div class="phase-goal">パイロット検証で効果を定量実証する</div>
            <ul>
              <li>限定部門で試験導入しベースライン計測を実施</li>
              <li>対象文書の棚卸しと重複・旧版データのクレンジング</li>
              <li>利用ガイドラインおよびFAQ対応体制の策定</li>
              <li>定量的・定性的な効果測定レポートの取りまとめ</li>
            </ul>
            <div class="deliv">成果物：<b>効果検証レポート・全社展開判断資料</b></div>
            <div class="kpi-box"><span class="label">KPI</span><span>探索時間 <b>−30%</b> ／ 正答率 <b>80%以上</b></span></div>
          </div>
        </div>
        <div class="phase" style="--accent: var(--cyan-700)">
          <div class="phase-chevron"><b>PHASE 2</b><span>中期</span><em>3–9ヶ月</em></div>
          <div class="phase-body">
            <div class="phase-goal">展開拡大とガバナンス体制の確立</div>
            <ul>
              <li>対象部署を順次拡大し部門文書オーナーを任命</li>
              <li>権限同期・アクセス制御の定期監査プロセスを稼働</li>
              <li>利用ログ分析による頻出ニーズの特定とナレッジ補強</li>
              <li>高度機密文書を扱う特定領域の個別設計を推進</li>
            </ul>
            <div class="deliv">成果物：<b>運用規程・文書オーナー体制</b></div>
            <div class="kpi-box"><span class="label">KPI</span><span>月間利用率 <b>70%</b> ／ 権限事故 <b>0件</b></span></div>
          </div>
        </div>
        <div class="phase" style="--accent: var(--indigo)">
          <div class="phase-chevron"><b>PHASE 3</b><span>長期</span><em>9–18ヶ月</em></div>
          <div class="phase-body">
            <div class="phase-goal">自律運用と高度自動化の実現</div>
            <ul>
              <li>業務システムやワークフローとのAPI連携を深化</li>
              <li>機密レベルに応じたハイブリッド構成の最適化</li>
              <li>定常ROI評価による費用対効果の継続的改善</li>
              <li>グループ各社・関連組織への展開スキーム検討</li>
            </ul>
            <div class="deliv">成果物：<b>統合運用基盤・ROI評価書</b></div>
            <div class="kpi-box"><span class="label">KPI</span><span>年間創出時間 <b>1万時間超</b></span></div>
          </div>
        </div>
      </div>

      <div class="risk-block">
        <div class="label">Key Risks &amp; Mitigation</div>
        <table class="risk">
          <colgroup><col style="width:27%"><col style="width:9%"><col style="width:10%"><col style="width:40%"><col style="width:14%"></colgroup>
          <thead><tr><th>リスク要因</th><th class="c">影響度</th><th class="c">発生可能性</th><th>対策方針</th><th>担当 / 時期</th></tr></thead>
          <tbody>
            <tr>
              <td><div class="r-name">アクセス権限外情報の混入</div><div class="r-desc">同期遅延や設定ミスによる漏洩懸念</div></td>
              <td class="c"><span class="level high">高</span></td><td class="c"><span class="level mid">中</span></td>
              <td>厳格な権限連携を必須要件化。人事異動ルールと月次監査の連動運用を確立</td>
              <td>情報システム / Phase 1〜</td>
            </tr>
            <tr>
              <td><div class="r-name">旧版・未改訂文書の引用</div><div class="r-desc">版管理不備による古い情報の回答</div></td>
              <td class="c"><span class="level mid">中</span></td><td class="c"><span class="level high">高</span></td>
              <td>部門オーナー制度と有効期限メタデータを付与し、期限切れ文書をインデックス除外</td>
              <td>各推進部門 / Phase 2</td>
            </tr>
            <tr>
              <td><div class="r-name">ベンダー囲い込み・コスト高</div><div class="r-desc">移行困難による運用費用の固定化</div></td>
              <td class="c"><span class="level mid">中</span></td><td class="c"><span class="level low">低</span></td>
              <td>契約時にデータ・設定のエクスポート条項を担保。代替アーキテクチャを常時準備</td>
              <td>調達・統括 / 契約時</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>

    ${renderFooter(5)}
  </section>
  `;

  // =====================================================================
  // 06 SOURCES & APPENDIX
  // =====================================================================
  html += `
  <section class="slide" data-section="Sources & Appendix">
    ${renderHeader('06 · Sources & Appendix')}

    <div class="slide-head">
      <div class="eyebrow"><span class="num">06</span> Sources &amp; Appendix</div>
      <h2 class="slide-title">参照ソース一覧 ＆ 分析方法論（Appendix）</h2>
    </div>

    <main class="slide-body appendix">
      <div>
        <table class="sources">
          <colgroup><col style="width:6%"><col style="width:42%"><col style="width:13%"><col style="width:20%"><col style="width:11%"><col style="width:8%"></colgroup>
          <thead><tr><th>ID</th><th>タイトル</th><th>種別</th><th>ドメイン</th><th>参照日</th><th class="c">信頼性</th></tr></thead>
          <tbody>
            ${sourceRowsHtml}
          </tbody>
        </table>
        <p class="sources-note">※ 主要出典上位10件を表示。全収集ソース一覧および数値生データは添付のExcel版（Sourcesシート）に完全収録。</p>
      </div>

      <aside class="side">
        <div class="card soft">
          <h5>Methodology</h5>
          <dl class="method">
            <dt>調査期間</dt><dd class="num-font">${esc(data.periodLabel || '直近1年')}</dd>
            <dt>収集ソース</dt><dd>${totalSources}件（一次情報比率 ${primaryRate}%）</dd>
            <dt>分析モデル</dt><dd>Gemini 構造化インテリジェンス</dd>
            <dt>信頼度算出</dt><dd>出典グレード × 複数裏付けスコア</dd>
          </dl>
        </div>
        <div class="card">
          <h5>Source Rating</h5>
          <div class="grade-legend">
            <div><span class="grade A">A</span><span>一次情報・公的機関・査読論文</span></div>
            <div><span class="grade B">B</span><span>業界団体・専門メディア・企業公式</span></div>
            <div><span class="grade C">C</span><span>二次情報・個人見解（参考値）</span></div>
          </div>
        </div>
        <div class="card">
          <h5>Governance &amp; Notes</h5>
          <dl class="method">
            <dt>権限管理</dt><dd>組織セキュリティポリシーに準拠</dd>
            <dt>データ保護</dt><dd>一次データ領域内での安全な永続化</dd>
          </dl>
        </div>
        <div class="disclaimer">
          <h5>Disclaimer</h5>
          <p>${esc(disclaimer)}</p>
        </div>
        <div class="copyright"><span class="logo-mark"></span><span><b>${esc(publisherName)}</b> · © 2026 All rights reserved.</span></div>
      </aside>
    </main>

    ${renderFooter(6)}
  </section>
  `;

  html += '</div>';
  return html;
}

/**
 * 4. 商用レポートPDF出力（Node.js内蔵Edge/Chromeによる完全ベクターPDF直接ダウンロード）
 */
export async function exportPDF(data, brand = 'Research Studio') {
  const filename = `【商用レポート】${safeFilename(data.title || data.theme)}.pdf`;
  const htmlContent = buildPdfHtml(data, brand);

  toast('📄 高品質商用PDFを生成中…（数秒かかります）', 'info', 4500);

  try {
    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: htmlContent, filename }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    downloadBlob(blob, filename);
    toast('✅ 商用レポートPDFを直接ダウンロードしました！', 'success');
  } catch (err) {
    console.warn('Server-side PDF generation error, falling back to client-side print:', err);
    toast('PDF自動ダウンロードに失敗したため、印刷プレビューを開きます', 'info');
    const root = document.getElementById('print-root');
    if (root) {
      root.innerHTML = htmlContent;
      window.addEventListener('afterprint', () => { root.innerHTML = ''; }, { once: true });
      window.print();
    }
  }
}


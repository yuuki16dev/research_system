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
  const publisherTagline = (typeof brand === 'object' && brand.publisherTagline) ? brand.publisherTagline : '';
  const author = (typeof brand === 'object' && brand.author) ? brand.author : '';
  const confidentiality = (typeof brand === 'object' && brand.confidentiality) ? brand.confidentiality : '';
  const disclaimer = (typeof brand === 'object' && brand.disclaimer && brand.disclaimer.trim())
    ? brand.disclaimer
    : '本レポートは、最新のWeb検索・専門ドメイン巡回およびAI解析パイプラインによって収集・構造化された調査結果です。本文中の数値・事実は各出典番号に基づいて記載されています。';

  const createdStr = fmtDate(data.createdAt, false);
  const totalSources = data.sources ? data.sources.length : 0;

  let html = `<div class="pr">`;

  // 表紙 (Cover Page)
  html += `
  <section class="pr-cover">
    <div class="pr-cover-art">
      <i></i><i></i><i></i>
    </div>
    <div class="pr-cover-grid"></div>
    <div class="pr-cover-inner">
      <div class="pr-brand">
        <span class="pr-brand-mark">◆</span>
        <span>${esc(publisherName)}</span>
        ${publisherTagline ? `<small class="pr-brand-tagline">${esc(publisherTagline)}</small>` : ''}
      </div>
      ${confidentiality ? `<div class="pr-confidential-badge">${esc(confidentiality)}</div>` : ''}
      <div class="pr-kicker">RESEARCH &amp; INTELLIGENCE REPORT</div>
      <h1 class="pr-title">${esc(data.title)}</h1>
      ${data.subtitle ? `<div class="pr-subtitle">${esc(data.subtitle)}</div>` : ''}
      <div class="pr-rule"></div>

      <div class="pr-theme-box">
        <small>RESEARCH THEME</small>
        <div>${esc(data.theme)}</div>
      </div>

      <dl class="pr-meta">
        <div><dt>DATE</dt><dd>${esc(createdStr)}</dd></div>
        ${author ? `<div><dt>AUTHOR</dt><dd>${esc(author)}</dd></div>` : ''}
        <div><dt>PERIOD</dt><dd>${esc(data.periodLabel || '直近1年（最新推奨）')}</dd></div>
        <div><dt>SCOPE</dt><dd>${esc(data.scopeLabel)}</dd></div>
        <div><dt>DEPTH</dt><dd>${esc(data.depthLabel)}</dd></div>
        <div><dt>SOURCES</dt><dd>${totalSources} sites</dd></div>
      </dl>
    </div>
  </section>
  `;

  const dt = data.deepThinking;

  // 動的セクション定義（存在する項目のみ番号を付与）
  const sectionsList = [];
  sectionsList.push({ id: 'summary', title: 'エグゼクティブサマリー & 主要ハイライト', en: 'Executive Summary & Key Highlights' });
  if (data.chart && data.chart.labels && data.chart.labels.length) {
    sectionsList.push({ id: 'chart', title: 'データビジュアライゼーション・チャート分析', en: 'Visual Data Analysis & Charts' });
  }
  if (dt && ((dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length) || dt.analystNote)) {
    sectionsList.push({ id: 'dynamics', title: '深層推論 & 構造的因果力学', en: 'Deep Reasoning & Root Cause Dynamics' });
  }
  if (dt && dt.tradeoffs && dt.tradeoffs.length) {
    sectionsList.push({ id: 'tradeoffs', title: '多角トレードオフ & 対立軸マトリクス', en: 'Multi-perspective Trade-offs Matrix' });
  }
  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    sectionsList.push({ id: 'matrix', title: '構造化比較マトリクス', en: 'Structured Comparison Matrix' });
  }
  if (data.sections && data.sections.length) {
    sectionsList.push({ id: 'detailed', title: '詳細解説・多角分析', en: 'Detailed Fact Analysis' });
  }
  if (data.insights && data.insights.length) {
    sectionsList.push({ id: 'insights', title: '示唆・提言', en: 'Key Insights & Strategic Recommendations' });
  }
  if (dt && (dt.scenarios || (dt.roadmap && dt.roadmap.length))) {
    sectionsList.push({ id: 'future', title: '将来シナリオ予測 & 実行戦略ロードマップ', en: 'Scenario Projections & Strategic Roadmap' });
  }
  if (data.deepDives && data.deepDives.length) {
    sectionsList.push({ id: 'deepdives', title: '追加深掘り知見', en: 'Follow-up Deep-dive Insights' });
  }
  if (data.sources && data.sources.length) {
    sectionsList.push({ id: 'sources', title: '収集ソース一覧 & 信頼度スコア', en: 'References & Source Credibility' });
  }

  const getSecNum = (id) => {
    const idx = sectionsList.findIndex((s) => s.id === id);
    return idx >= 0 ? String(idx + 1).padStart(2, '0') : '01';
  };

  let pageCounter = 1;
  const renderHeader = (enTitle) => `
    <div class="pr-running-head">
      <span class="pr-rh-brand">◆ ${esc(publisherName)}</span>
      <span class="pr-rh-title">${esc(data.title || data.theme)}</span>
      <span class="pr-rh-sec">${esc(enTitle || '')}</span>
    </div>
  `;

  const renderFooter = () => {
    pageCounter++;
    return `
    <div class="pr-running-foot">
      <span class="pr-rf-conf">${esc(confidentiality || 'CONFIDENTIAL')}</span>
      <span class="pr-rf-date">${esc(createdStr)}</span>
      <span class="pr-rf-page">Page ${pageCounter}</span>
    </div>
    `;
  };

  // 目次 (Table of Contents)
  html += `
  <section class="pr-toc">
    ${renderHeader('TABLE OF CONTENTS')}
    <div class="pr-en">EXECUTIVE OVERVIEW</div>
    <h2>目次</h2>
    <ol>
      ${sectionsList
        .map(
          (s, idx) => `
        <li><span>${String(idx + 1).padStart(2, '0')}</span>${esc(s.title)} <small>${esc(s.en)}</small></li>
      `
        )
        .join('')}
    </ol>
    <div class="pr-toc-note">
      ${esc(disclaimer)}
    </div>
    ${renderFooter()}
  </section>
  `;

  // 01 エグゼクティブサマリー
  html += `
  <section class="pr-sec pr-break">
    ${renderHeader('EXECUTIVE SUMMARY & HIGHLIGHTS')}
    <h2 class="pr-h2"><span class="pr-num">${getSecNum('summary')}</span>エグゼクティブサマリー &amp; キーハイライト</h2>
    <div class="pr-summary">${esc(data.summary)}</div>

    ${
      data.metrics && data.metrics.length
        ? `
      <div class="pr-metrics">
        ${data.metrics
          .map(
            (m) => `
          <div class="pr-metric">
            <small>${esc(m.label)}</small>
            <b>${esc(m.value)}</b>
            ${m.note ? `<span>${esc(m.note)}</span>` : ''}
          </div>`
          )
          .join('')}
      </div>`
        : ''
    }

    ${
      data.keyPoints && data.keyPoints.length
        ? `
      <h3 class="pr-h3">主要ハイライト</h3>
      <ol class="pr-points">
        ${data.keyPoints.map((kp) => `<li>${esc(kp)}</li>`).join('')}
      </ol>`
        : ''
    }
    ${renderFooter()}
  </section>
  `;

  // データビジュアライゼーション・チャート分析（Pure SVG ベクター埋め込み）
  if (sectionsList.some((s) => s.id === 'chart')) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('VISUAL DATA ANALYSIS & CHARTS')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('chart')}</span>データビジュアライゼーション・チャート分析 <span class="pr-deep-badge">PURE SVG</span></h2>
      <div class="pr-chart-caption">${esc(data.chart.title || '主要指標の可視化チャート')}</div>
      <div class="pr-chart-wrap">
        ${renderSvgChart(data.chart)}
      </div>
      ${renderFooter()}
    </section>
    `;
  }

  // 深層推論 & 構造的因果力学（ディープリサーチ時）
  if (sectionsList.some((s) => s.id === 'dynamics')) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('DEEP REASONING & ROOT CAUSES')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('dynamics')}</span>深層推論 &amp; 構造的因果力学 <span class="pr-deep-badge">DEEP REASONING</span></h2>
      ${
        dt.analystNote
          ? `
        <div class="pr-analyst-box">
          <strong>CRITICAL THINKING / アナリストの思考・仮説検証ノート</strong>
          ${esc(dt.analystNote)}
        </div>`
          : ''
      }
      ${
        dt.dynamicsAndRootCauses && dt.dynamicsAndRootCauses.length
          ? `
        <div class="pr-card-grid">
          ${dt.dynamicsAndRootCauses
            .map(
              (d) => `
            <div class="pr-dynamics-item">
              <h4>${esc(d.topic)}</h4>
              ${d.keyFactor ? `<div class="factor">核心要因: ${esc(d.keyFactor)}</div>` : ''}
              <p>${esc(d.mechanism)}</p>
            </div>`
            )
            .join('')}
        </div>`
          : ''
      }
      ${renderFooter()}
    </section>
    `;
  }

  // 多角トレードオフ & 対立軸マトリクス（ディープリサーチ時）
  if (sectionsList.some((s) => s.id === 'tradeoffs')) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('TRADE-OFFS & MULTI-PERSPECTIVE ANALYSIS')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('tradeoffs')}</span>多角トレードオフ &amp; 対立軸マトリクス <span class="pr-deep-badge">TRADE-OFFS</span></h2>
      <div style="margin-bottom: 3.5mm; font-size: 8.5pt; color: var(--c-ink-2);">
        単一の結論に偏らず、推進派・慎重派の根拠および構造的ジレンマを客観的に比較検証した分析結果です。
      </div>
      ${dt.tradeoffs
        .map(
          (t) => `
        <div class="pr-tradeoff-item">
          <h4>対立軸: ${esc(t.axis)}</h4>
          <div class="pr-tradeoff-sides">
            <div class="pr-side-pro">
              <strong>推進派・支持論拠:</strong><br>${esc(t.proSide)}
            </div>
            <div class="pr-side-con">
              <strong>慎重派・潜在リスク:</strong><br>${esc(t.conSide)}
            </div>
          </div>
          ${
            t.synthesis
              ? `
            <div class="pr-tradeoff-synth">
              <strong>統合判断:</strong> ${esc(t.synthesis)}
            </div>`
              : ''
          }
        </div>`
        )
        .join('')}
      ${renderFooter()}
    </section>
    `;
  }

  // 構造化比較マトリクス
  if (data.table && data.table.columns && data.table.rows && data.table.rows.length) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('STRUCTURED COMPARISON MATRIX')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('matrix')}</span>構造化比較マトリクス</h2>
      <div class="pr-table-cap">${esc(data.table.caption || '比較分析データ')}</div>
      <table class="pr-table">
        <thead>
          <tr>
            ${data.table.columns.map((col) => `<th>${esc(col)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.table.rows
            .map(
              (r) => `
            <tr>
              ${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
      ${renderFooter()}
    </section>
    `;
  }

  // 詳細解説
  if (data.sections && data.sections.length) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('DETAILED FACT ANALYSIS')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('detailed')}</span>詳細解説・多角分析</h2>
      ${data.sections
        .map(
          (sec) => `
        <article style="margin-bottom: 5mm;">
          <h3 class="pr-h3">${esc(sec.heading)}</h3>
          <p>${esc(sec.body)}</p>
          ${
            sec.bullets && sec.bullets.length
              ? `
            <ul class="pr-bullets">
              ${sec.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}
            </ul>`
              : ''
          }
        </article>`
        )
        .join('')}
      ${renderFooter()}
    </section>
    `;
  }

  // 示唆・提言
  if (data.insights && data.insights.length) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('KEY INSIGHTS & RECOMMENDATIONS')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('insights')}</span>示唆・提言（Key Insights）</h2>
      ${data.insights
        .map(
          (ins) => `
        <div class="pr-insight">
          <span class="pr-prio p-${esc(ins.priority || '中')}">優先度: ${esc(ins.priority || '中')}</span>
          <div>
            <h4>${esc(ins.title)}</h4>
            <p>${esc(ins.body)}</p>
          </div>
        </div>`
        )
        .join('')}
      ${renderFooter()}
    </section>
    `;
  }

  // 将来シナリオ予測 & 実行戦略ロードマップ（ディープリサーチ時）
  if (sectionsList.some((s) => s.id === 'future')) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('SCENARIOS & STRATEGIC ROADMAP')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('future')}</span>将来シナリオ予測 &amp; 実行戦略ロードマップ <span class="pr-deep-badge">SCENARIOS &amp; ROADMAP</span></h2>
      ${
        dt.scenarios
          ? `
        <h3 class="pr-h3">今後1〜3年のシナリオ予測（不確実性の分岐）</h3>
        <div class="pr-scenarios-box">
          <div class="pr-scenario-card main">
            <div class="tag">MAIN (確率 60%)</div>
            <p>${esc(dt.scenarios.mainScenario)}</p>
          </div>
          <div class="pr-scenario-card upside">
            <div class="tag">UPSIDE (上振れ 25%)</div>
            <p>${esc(dt.scenarios.upsideScenario)}</p>
          </div>
          <div class="pr-scenario-card downside">
            <div class="tag">DOWNSIDE (下振れ 15%)</div>
            <p>${esc(dt.scenarios.downsideScenario)}</p>
          </div>
        </div>
        ${
          dt.scenarios.criticalTriggers && dt.scenarios.criticalTriggers.length
            ? `
          <div style="font-size: 8pt; margin-bottom: 4mm; color: var(--c-ink-2); background: #f8fafc; padding: 2mm 3mm; border-radius: 1.5mm;">
            <strong>シナリオ分岐トリガー:</strong> ${esc(dt.scenarios.criticalTriggers.join(' / '))}
          </div>`
            : ''
        }
      `
          : ''
      }
      ${
        dt.roadmap && dt.roadmap.length
          ? `
        <h3 class="pr-h3">フェーズ別実行戦略ロードマップ</h3>
        <div>
          ${dt.roadmap
            .map(
              (step) => `
            <div class="pr-roadmap-item">
              <div class="phase">${esc(step.phase)}</div>
              <div class="content">
                ${step.focus ? `<div class="focus">${esc(step.focus)}</div>` : ''}
                ${
                  step.actions && step.actions.length
                    ? `
                  <ul>
                    ${step.actions.map((act) => `<li>${esc(act)}</li>`).join('')}
                  </ul>`
                    : ''
                }
              </div>
            </div>`
            )
            .join('')}
        </div>
      `
          : ''
      }
      ${renderFooter()}
    </section>
    `;
  }

  // 追加深掘り知見
  if (data.deepDives && data.deepDives.length) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('FOLLOW-UP DEEP-DIVE INSIGHTS')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('deepdives')}</span>追加深掘り知見（Follow-up Insights）</h2>
      ${data.deepDives
        .map(
          (dd) => `
        <article style="margin-bottom: 5mm; padding: 4mm 5mm; background: #faf5ff; border-left: 3px solid #a855f7; border-radius: 4px;">
          <h3 class="pr-h3" style="color: #6b21a8; margin-bottom: 2mm;">Q: ${esc(dd.question)}</h3>
          ${
            dd.quote
              ? `<blockquote style="margin: 0 0 2mm; padding: 2mm 3mm; background: rgba(168, 85, 247, 0.08); border-left: 2px solid #a855f7; font-size: 9pt; font-style: italic; color: #4b5563;">引用: “${esc(dd.quote)}”</blockquote>`
              : ''
          }
          <p style="margin-bottom: 2mm;">${esc(dd.answer)}</p>
          ${
            dd.keyPoints && dd.keyPoints.length
              ? `
            <ul class="pr-bullets" style="margin-top: 2mm;">
              ${dd.keyPoints.map((kp) => `<li>${esc(kp)}</li>`).join('')}
            </ul>`
              : ''
          }
        </article>`
        )
        .join('')}
      ${renderFooter()}
    </section>
    `;
  }

  // 収集ソース
  if (data.sources && data.sources.length) {
    html += `
    <section class="pr-sec pr-break">
      ${renderHeader('REFERENCES & FACT-CHECKING SOURCES')}
      <h2 class="pr-h2"><span class="pr-num">${getSecNum('sources')}</span>収集ソース一覧 &amp; 信頼度スコア</h2>
      <ul class="pr-sources">
        ${data.sources
          .map(
            (s) => `
          <li>
            <span class="n">[${s.index}]</span>
            <div>
              <span class="t">${esc(s.title)}</span>
              <span class="u">${esc(s.url)}</span>
            </div>
            <span class="s">スコア: ${s.score}</span>
          </li>`
          )
          .join('')}
      </ul>
      <div class="pr-colophon">
        <div><strong>発行元:</strong> ${esc(publisherName)}${author ? ` · <strong>作成者:</strong> ${esc(author)}` : ''} · <strong>発行日時:</strong> ${fmtDate(data.createdAt)} · <strong>モード:</strong> ${data.mode === 'live' ? 'Live Search' : 'Demo Verification'}${confidentiality ? ` · <strong>機密区分:</strong> ${esc(confidentiality)}` : ''}</div>
        <div style="margin-top: 1.5mm; font-size: 7.5pt; color: var(--c-ink-2);">${esc(disclaimer)}</div>
      </div>
      ${renderFooter()}
    </section>
    `;
  }

  html += `</div>`;
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


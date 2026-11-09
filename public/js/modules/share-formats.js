// ==========================================================================
// Research Studio — 社内共有用フォーマット生成モジュール (v2.14.0)
// ==========================================================================

'use strict';

/**
 * Slack / Teams 用の短縮・高インパクト要約テキストを生成
 * @param {Object} result
 * @returns {string}
 */
export function buildSlackFormat(result) {
  if (!result) return '';
  const title = result.title || result.theme;
  const summary = result.summary || '';
  const keyPoints = Array.isArray(result.keyPoints) ? result.keyPoints.slice(0, 3) : [];
  const metrics = Array.isArray(result.metrics) ? result.metrics.slice(0, 3) : [];
  const rec =
    (result.deepThinking && result.deepThinking.analystNote && result.deepThinking.analystNote.coreHypothesis) ||
    (result.insights && result.insights[0] && result.insights[0].body) ||
    '';

  let text = `📢 *【AIリサーチ速報】${title}*\n\n`;
  text += `📝 *エグゼクティブ要約:*\n${summary}\n\n`;

  if (keyPoints.length) {
    text += `💡 *主要ポイント:*\n`;
    keyPoints.forEach((kp) => {
      text += `• ${kp}\n`;
    });
    text += `\n`;
  }

  if (metrics.length) {
    text += `📊 *重要指標:*\n`;
    metrics.forEach((m) => {
      text += `• *${m.label}*: ${m.value} ${m.note ? `(${m.note})` : ''}\n`;
    });
    text += `\n`;
  }

  if (rec) {
    text += `🎯 *推奨アクション・示唆:*\n${rec}\n\n`;
  }

  text += `🔗 _Research Studio 自動生成レポート (全ソース ${result.sources ? result.sources.length : 0}件検証済)_`;
  return text.trim();
}

/**
 * 上長向け稟議・報告メール文面を生成
 * @param {Object} result
 * @returns {string}
 */
export function buildEmailFormat(result) {
  if (!result) return '';
  const title = result.title || result.theme;
  const summary = result.summary || '';
  const keyPoints = Array.isArray(result.keyPoints) ? result.keyPoints : [];
  const metrics = Array.isArray(result.metrics) ? result.metrics : [];
  const rec =
    (result.deepThinking && result.deepThinking.analystNote && result.deepThinking.analystNote.coreHypothesis) ||
    (result.insights && result.insights[0] && result.insights[0].body) ||
    '';
  const ymd = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  let text = `件名: 【調査報告】${title}に関するリサーチ結果と今後の推奨方針\n\n`;
  text += `関係者各位\n\nお疲れ様です。標記の件につきまして、Webおよび専門ソースから網羅的な調査・分析を実施いたしましたので、要点を報告いたします。\n\n`;
  text += `────────────────────────────────────\n`;
  text += `■ 1. 調査結論・エグゼクティブサマリー\n`;
  text += `────────────────────────────────────\n`;
  text += `${summary}\n\n`;

  if (keyPoints.length) {
    text += `────────────────────────────────────\n`;
    text += `■ 2. 主要ファクト・判明した重要ポイント\n`;
    text += `────────────────────────────────────\n`;
    keyPoints.forEach((kp, idx) => {
      text += `${idx + 1}. ${kp}\n`;
    });
    text += `\n`;
  }

  if (metrics.length) {
    text += `────────────────────────────────────\n`;
    text += `■ 3. 重要数値・比較指標\n`;
    text += `────────────────────────────────────\n`;
    metrics.forEach((m) => {
      text += `・${m.label}: ${m.value} ${m.note ? `(${m.note})` : ''}\n`;
    });
    text += `\n`;
  }

  if (rec) {
    text += `────────────────────────────────────\n`;
    text += `■ 4. 今後の推奨方針・ネクストアクション\n`;
    text += `────────────────────────────────────\n`;
    text += `${rec}\n\n`;
  }

  text += `※ 詳細な比較表・グラフ・一次情報ソース一覧は添付のレポート資料をご参照ください。\n`;
  text += `作成日: ${ymd}\n作成システム: Research Studio AI Automation`;
  return text.trim();
}


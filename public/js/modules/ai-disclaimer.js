// ==========================================================================
// AI生成であることの注記 — 単一ソース定数 (D-1)
// 文言は仮定義。最終決定時はこの定数のみ更新すれば、画面および全出力形式
// （PDF・Excel・Markdown・テキスト・PPTX）へ一括反映されます。
// ==========================================================================

export const AI_GENERATED_DISCLAIMER =
  '本レポートはAIが公開情報をもとに自動生成したもので、誤りを含む場合があります。重要な判断の前に出典をご確認ください。';

/**
 * ブランド設定の追加免責文言がある場合も、必須の AI 生成注記を必ず含めて返す
 * @param {string} [customDisclaimer]
 * @returns {string}
 */
export function resolveAiDisclaimer(customDisclaimer) {
  const extra = typeof customDisclaimer === 'string' ? customDisclaimer.trim() : '';
  if (!extra || extra === AI_GENERATED_DISCLAIMER) {
    return AI_GENERATED_DISCLAIMER;
  }
  if (extra.includes(AI_GENERATED_DISCLAIMER)) {
    return extra;
  }
  return `${AI_GENERATED_DISCLAIMER} ${extra}`;
}

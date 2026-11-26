'use strict';

/**
 * AI生成であることの注記 — サーバー側ブリッジ (D-1)
 * 文言の唯一の定義元である public/js/modules/ai-disclaimer.js から直接読み込む。
 */

const fs = require('fs');
const path = require('path');

const SOURCE_FILE = path.join(__dirname, '..', 'public', 'js', 'modules', 'ai-disclaimer.js');

function loadDisclaimerFromSingleSource() {
  const raw = fs.readFileSync(SOURCE_FILE, 'utf8');
  const match = raw.match(/export\s+const\s+AI_GENERATED_DISCLAIMER\s*=\s*(['"`])([\s\S]*?)\1\s*;/);
  if (!match || !match[2] || !match[2].trim()) {
    throw new Error(`AI_GENERATED_DISCLAIMER could not be loaded from ${SOURCE_FILE}`);
  }
  return match[2];
}

const AI_GENERATED_DISCLAIMER = loadDisclaimerFromSingleSource();

/**
 * ブランド設定の追加免責文言がある場合も、必須の AI 生成注記を必ず含めて返す
 * @param {string} [customDisclaimer]
 * @returns {string}
 */
function resolveAiDisclaimer(customDisclaimer) {
  const extra = typeof customDisclaimer === 'string' ? customDisclaimer.trim() : '';
  if (!extra || extra === AI_GENERATED_DISCLAIMER) {
    return AI_GENERATED_DISCLAIMER;
  }
  if (extra.includes(AI_GENERATED_DISCLAIMER)) {
    return extra;
  }
  return `${AI_GENERATED_DISCLAIMER} ${extra}`;
}

module.exports = {
  AI_GENERATED_DISCLAIMER,
  resolveAiDisclaimer,
};

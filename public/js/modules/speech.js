// ==========================================================================
// Research Studio — 1分間エグゼクティブ音声サマリー モジュール (v2.14.0)
// ==========================================================================

'use strict';

let currentUtterance = null;
let isPlaying = false;
let isPaused = false;
let currentRate = 1.0;

/**
 * レポートから音声読み上げ用スクリプトを自動抽出・生成
 * @param {Object} result
 * @returns {string}
 */
export function getAudioSummaryScript(result) {
  if (!result) return '';
  const title = result.title || result.theme;
  const summary = result.summary || '';
  const keyPoints = Array.isArray(result.keyPoints) ? result.keyPoints.slice(0, 3) : [];
  const rec =
    (result.deepThinking && result.deepThinking.analystNote && result.deepThinking.analystNote.coreHypothesis) ||
    (result.insights && result.insights[0] && result.insights[0].body) ||
    '';

  let script = `${title}についてのリサーチ結果サマリーをお伝えします。`;
  if (summary) {
    script += `結論として、${summary}。`;
  }
  if (keyPoints.length) {
    script += `重要なポイントは${keyPoints.length}点あります。`;
    keyPoints.forEach((kp, i) => {
      script += `${i + 1}点目、${kp}。`;
    });
  }
  if (rec) {
    script += `今後の推奨方針として、${rec}。`;
  }
  script += `以上、リサーチスタジオによる1分間要約でした。`;
  return script.replace(/[[\]#*`_]/g, '');
}

/**
 * 音声読み上げの開始
 * @param {string} text
 * @param {Object} options
 */
export function playAudioSummary(text, options = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    throw new Error('お使いのブラウザは音声読み上げ（SpeechSynthesis）に対応していません');
  }

  stopAudioSummary();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = options.rate || currentRate;
  utter.pitch = 1.0;
  utter.lang = 'ja-JP';

  // 日本語ボイスを優先選定
  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find((v) => v.lang === 'ja-JP' || v.lang.startsWith('ja'));
  if (jaVoice) utter.voice = jaVoice;

  utter.onstart = () => {
    isPlaying = true;
    isPaused = false;
    options.onStart && options.onStart();
  };

  utter.onend = () => {
    isPlaying = false;
    isPaused = false;
    options.onEnd && options.onEnd();
  };

  utter.onerror = (e) => {
    isPlaying = false;
    isPaused = false;
    options.onError && options.onError(e);
  };

  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

/**
 * 一時停止
 */
export function pauseAudioSummary() {
  if (typeof window !== 'undefined' && window.speechSynthesis && isPlaying) {
    window.speechSynthesis.pause();
    isPaused = true;
  }
}

/**
 * 再開
 */
export function resumeAudioSummary() {
  if (typeof window !== 'undefined' && window.speechSynthesis && isPaused) {
    window.speechSynthesis.resume();
    isPaused = false;
  }
}

/**
 * 停止
 */
export function stopAudioSummary() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    isPlaying = false;
    isPaused = false;
  }
}

/**
 * 再生速度の変更
 * @param {number} rate
 */
export function setPlaybackRate(rate) {
  currentRate = rate;
}

/**
 * 再生中かどうか
 * @returns {boolean}
 */
export function isAudioPlaying() {
  return isPlaying;
}

/**
 * 一時停止中かどうか
 * @returns {boolean}
 */
export function isAudioPaused() {
  return isPaused;
}

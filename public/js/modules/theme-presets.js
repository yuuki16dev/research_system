// @ts-check
'use strict';

/**
 * Research Studio — 商用ブランドテーマ ＆ スタイル定義 (v1.19.0)
 * クライアント側（Web画面、PDF/PPTX/Excelプレビュー）用定義
 */

export const THEME_PRESETS = {
  'corporate-blue': {
    id: 'corporate-blue',
    name: 'コーポレート・ネイビー (標準)',
    description: '信頼・金融・大手企業・コンサルティング',
    primary: '#2563eb', // Royal Blue
    accent: '#06b6d4',  // Cyan
    dark: '#0f172a',    // Slate Dark
    gradient: 'linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)',
    chart: ['#2563eb', '#06b6d4', '#10b981', '#f59e0b', '#ec4899'],
  },
  'tech-emerald': {
    id: 'tech-emerald',
    name: 'テック・エメラルド',
    description: 'テクノロジー・AI・DX・サステナビリティ・ESG',
    primary: '#059669', // Emerald Green
    accent: '#10b981',  // Mint
    dark: '#064e3b',    // Deep Emerald
    gradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    chart: ['#059669', '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6'],
  },
  'executive-slate': {
    id: 'executive-slate',
    name: 'エグゼクティブ・スレート',
    description: '役員会提出・法務・重厚感・監査',
    primary: '#334155', // Charcoal Slate
    accent: '#64748b',  // Steel
    dark: '#0f172a',    // Deep Navy
    gradient: 'linear-gradient(135deg, #334155 0%, #64748b 100%)',
    chart: ['#334155', '#64748b', '#0284c7', '#059669', '#d97706'],
  },
  'vibrant-violet': {
    id: 'vibrant-violet',
    name: 'ロイヤル・バイオレット',
    description: 'イノベーション・デザイン・新事業・クリエイティブ',
    primary: '#7c3aed', // Violet
    accent: '#c084fc',  // Lavender
    dark: '#2e1065',    // Midnight Violet
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
    chart: ['#7c3aed', '#c084fc', '#06b6d4', '#f43f5e', '#10b981'],
  },
  'warm-amber': {
    id: 'warm-amber',
    name: 'アンバー・サンライズ',
    description: 'スタートアップ・マーケティング・活力',
    primary: '#d97706', // Warm Amber
    accent: '#f59e0b',  // Gold
    dark: '#451a03',    // Dark Amber
    gradient: 'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)',
    chart: ['#d97706', '#f59e0b', '#2563eb', '#10b981', '#ec4899'],
  },
  'crimson-burgundy': {
    id: 'crimson-burgundy',
    name: 'クリムゾン・バーガンディ',
    description: 'プレミアム・ヘルスケア・伝統・ラグジュアリー',
    primary: '#be123c', // Crimson
    accent: '#f43f5e',  // Rose
    dark: '#4c0519',    // Deep Wine
    gradient: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)',
    chart: ['#be123c', '#f43f5e', '#0284c7', '#d97706', '#10b981'],
  },
};

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * カラー設定を検証・正規化してテーマオブジェクトを解決する
 * @param {Object|string} [themeConfig] - プリセットIDまたは設定オブジェクト
 * @returns {Object} 完全なテーマ定義オブジェクト
 */
export function resolveTheme(themeConfig) {
  let presetId = 'corporate-blue';
  let customPrimary = '';
  let customAccent = '';

  if (typeof themeConfig === 'string') {
    presetId = themeConfig;
  } else if (themeConfig && typeof themeConfig === 'object') {
    presetId = themeConfig.preset || themeConfig.id || 'corporate-blue';
    if (themeConfig.primary && HEX_COLOR_REGEX.test(themeConfig.primary)) {
      customPrimary = themeConfig.primary;
    }
    if (themeConfig.accent && HEX_COLOR_REGEX.test(themeConfig.accent)) {
      customAccent = themeConfig.accent;
    }
  }

  if (presetId === 'custom' && customPrimary) {
    const primary = customPrimary;
    const accent = customAccent || customPrimary;
    return {
      id: 'custom',
      preset: 'custom',
      name: 'カスタム・ブランド',
      description: 'ユーザー指定のコーポレートカラー',
      primary,
      accent,
      dark: '#0f172a',
      gradient: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
      chart: [primary, accent, '#10b981', '#f59e0b', '#ec4899'],
    };
  }

  const base = THEME_PRESETS[presetId] || THEME_PRESETS['corporate-blue'];
  return {
    ...base,
    preset: base.id,
  };
}


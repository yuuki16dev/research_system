// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  if (process.env.RESEARCH_DATA_DIR) {
    return path.resolve(process.env.RESEARCH_DATA_DIR);
  }
  // テスト実行時や明示的ポータブル指定時はプロジェクトルート直下の data ディレクトリを使用
  if (process.env.NODE_ENV === 'test' || process.env.PORTABLE_MODE === '1') {
    const base = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
    return path.join(base, 'data');
  }
  // 商用・日常実行時: Windows では %APPDATA%\ResearchStudio, その他 OS は ~/.research_studio
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'ResearchStudio');
  }
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, '.research_studio');
}

const BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = resolveDataDir();
const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  geminiApiKey: '',
  tavilyApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  searchProvider: 'auto', // auto | tavily | duckduckgo
  mode: 'auto', // auto（キーがあればLIVE） | mock（常にデモ）
  publisher: 'Research Studio',
  publisherTagline: 'RESEARCH & INTELLIGENCE REPORT',
  author: '',
  confidentiality: 'CONFIDENTIAL', // CONFIDENTIAL | INTERNAL | PUBLIC | NONE
  disclaimer: '本レポートはAIによる自動リサーチ集計結果であり、意思決定の参考情報としてご活用ください。',
};

const ALLOWED = Object.keys(DEFAULTS);
const ENUMS = {
  searchProvider: ['auto', 'tavily', 'duckduckgo'],
  mode: ['auto', 'mock'],
  confidentiality: ['CONFIDENTIAL', 'INTERNAL', 'PUBLIC', 'NONE'],
};

function migrateOldDataIfNeeded() {
  const oldDir = path.join(BASE_DIR, 'data');
  if (path.resolve(oldDir) === path.resolve(DATA_DIR)) return;
  if (!fs.existsSync(oldDir)) return;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const oldSettings = path.join(oldDir, 'settings.json');
    const newSettings = path.join(DATA_DIR, 'settings.json');
    if (fs.existsSync(oldSettings) && !fs.existsSync(newSettings)) {
      fs.copyFileSync(oldSettings, newSettings);
    }
    const oldHist = path.join(oldDir, 'history');
    const newHist = path.join(DATA_DIR, 'history');
    if (fs.existsSync(oldHist) && !fs.existsSync(newHist)) {
      if (typeof fs.cpSync === 'function') {
        fs.cpSync(oldHist, newHist, { recursive: true });
      }
    }
  } catch {
    // 移行エラーがあっても起動はブロックしない
  }
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  migrateOldDataIfNeeded();
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** 保存値 + 環境変数フォールバックを合成した実効設定 */
function load() {
  const s = { ...DEFAULTS, ...readFile() };
  if (!s.geminiApiKey && process.env.GEMINI_API_KEY) s.geminiApiKey = process.env.GEMINI_API_KEY;
  if (!s.tavilyApiKey && process.env.TAVILY_API_KEY) s.tavilyApiKey = process.env.TAVILY_API_KEY;
  return s;
}

/**
 * 部分更新。undefined のキーは維持、空文字はクリア。
 */
function save(patch = {}) {
  ensureDir();
  const cur = { ...DEFAULTS, ...readFile() };
  for (const key of ALLOWED) {
    if (typeof patch[key] !== 'string') continue;
    const v = patch[key].trim();
    if (ENUMS[key] && !ENUMS[key].includes(v)) continue;
    if (key === 'geminiModel' && !/^[\w.\-]+$/.test(v)) continue;
    cur[key] = v;
  }
  fs.writeFileSync(FILE, JSON.stringify(cur, null, 2), 'utf8');
  return load();
}

function mask(k) {
  if (!k) return '';
  if (k.length <= 10) return '••••' + k.slice(-2);
  return k.slice(0, 4) + '••••••' + k.slice(-4);
}

function effectiveMode(s = load()) {
  return s.mode === 'mock' || !s.geminiApiKey ? 'mock' : 'live';
}

function effectiveSearch(s = load()) {
  if (s.searchProvider === 'duckduckgo') return 'duckduckgo';
  if (s.tavilyApiKey) return 'tavily';
  return 'duckduckgo';
}

/** クライアントに返す安全なビュー（キーはマスク） */
function publicView(s = load()) {
  return {
    geminiApiKey: { set: !!s.geminiApiKey, masked: mask(s.geminiApiKey) },
    tavilyApiKey: { set: !!s.tavilyApiKey, masked: mask(s.tavilyApiKey) },
    geminiModel: s.geminiModel,
    searchProvider: s.searchProvider,
    mode: s.mode,
    publisher: s.publisher,
    publisherTagline: s.publisherTagline,
    author: s.author,
    confidentiality: s.confidentiality,
    disclaimer: s.disclaimer,
    effectiveMode: effectiveMode(s),
    effectiveSearch: effectiveSearch(s),
  };
}

module.exports = { load, save, publicView, effectiveMode, effectiveSearch, DATA_DIR, BASE_DIR };

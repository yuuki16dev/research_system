// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');

const BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  geminiApiKey: '',
  tavilyApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  searchProvider: 'auto', // auto | tavily | duckduckgo
  mode: 'auto', // auto（キーがあればLIVE） | mock（常にデモ）
  publisher: 'Research Studio',
};

const ALLOWED = Object.keys(DEFAULTS);
const ENUMS = {
  searchProvider: ['auto', 'tavily', 'duckduckgo'],
  mode: ['auto', 'mock'],
};

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    effectiveMode: effectiveMode(s),
    effectiveSearch: effectiveSearch(s),
  };
}

module.exports = { load, save, publicView, effectiveMode, effectiveSearch, DATA_DIR, BASE_DIR };

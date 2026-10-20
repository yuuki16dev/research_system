// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const ERROR_LOG = path.join(LOGS_DIR, 'error.log');
const APP_LOG = path.join(LOGS_DIR, 'app.log');

// インメモリの直近ログリングバッファ（動作中の追跡用、最大200件保持）
const MAX_RING_BUFFER = 200;
/** @type {Array<{ time: string, level: string, message: string }>} */
const memoryBuffer = [];

let initialized = false;

function ensureDir() {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  } catch {}
}

/** APIキーなどの機密情報をマスクするフィルタ */
function maskSecrets(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/AIza[0-9A-Za-z-_]{35}/g, (m) => m.slice(0, 4) + '••••••••••••' + m.slice(-4))
    .replace(/tvly-[0-9A-Za-z-_]{20,}/g, (m) => m.slice(0, 5) + '••••••••••••' + m.slice(-4));
}

function recordToMemory(level, message) {
  const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  memoryBuffer.push({ time, level, message: maskSecrets(message) });
  if (memoryBuffer.length > MAX_RING_BUFFER) {
    memoryBuffer.shift();
  }
}

/** 正しくない動作（WARN / ERROR / FATAL）のみをディスクに永続保存 */
function appendErrorLog(level, message) {
  ensureDir();
  const time = new Date().toISOString();
  const line = `[${time}] [${level}] ${maskSecrets(message)}\n`;
  try {
    fs.appendFileSync(ERROR_LOG, line, 'utf8');
  } catch {}
}

/** 正常ログ（app.log）等の不要なディスクファイルを削除してクリーンに維持 */
function cleanupNormalLogs() {
  try {
    if (fs.existsSync(APP_LOG)) {
      fs.unlinkSync(APP_LOG);
    }
  } catch {}
}

/** ロガーの初期化と未捕捉エラーの監視 */
function initLogger() {
  if (initialized) return;
  initialized = true;
  ensureDir();
  cleanupNormalLogs();

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  // 動作中はコンソールへ即時ストリーム出力しつつ、メモリバッファにのみ保持（ディスクには書かない）
  console.log = (...args) => {
    origLog.apply(console, args);
    const msg = util.format(...args);
    recordToMemory('INFO', msg);
  };

  // 警告はコンソール表示 ＋ エラーログへ保存
  console.warn = (...args) => {
    origWarn.apply(console, args);
    const msg = util.format(...args);
    recordToMemory('WARN', msg);
    appendErrorLog('WARN', msg);
  };

  // エラーはコンソール表示 ＋ エラーログへ保存
  console.error = (...args) => {
    origError.apply(console, args);
    const msg = util.format(...args);
    recordToMemory('ERROR', msg);
    appendErrorLog('ERROR', msg);
  };

  // 未捕捉の例外（uncaughtException）のキャッチ
  process.on('uncaughtException', (err) => {
    const trace = err && err.stack ? err.stack : String(err);
    const recentContext = memoryBuffer
      .slice(-8)
      .map((l) => `  [${l.time}] [${l.level}] ${l.message}`)
      .join('\n');

    const banner = [
      '======================================================================',
      '【致命的エラー】予期せぬ例外が発生しました (uncaughtException)',
      `時刻: ${new Date().toLocaleString('ja-JP')}`,
      `エラー: ${err && err.message ? err.message : String(err)}`,
      'クラッシュ直前の動作状況:',
      recentContext || '  (ログなし)',
      'スタックトレース:',
      trace,
      '======================================================================',
    ].join('\n');

    origError.call(console, '\n' + banner + '\n');
    appendErrorLog('FATAL', banner);
  });

  // 未処理の Promise 拒絶（unhandledRejection）のキャッチ
  process.on('unhandledRejection', (reason) => {
    const trace = reason && reason.stack ? reason.stack : util.inspect(reason);
    const recentContext = memoryBuffer
      .slice(-8)
      .map((l) => `  [${l.time}] [${l.level}] ${l.message}`)
      .join('\n');

    const banner = [
      '----------------------------------------------------------------------',
      '【非同期エラー】未処理の Promise 拒絶が発生しました (unhandledRejection)',
      `時刻: ${new Date().toLocaleString('ja-JP')}`,
      '直前の動作状況:',
      recentContext || '  (ログなし)',
      'スタックトレース:',
      trace,
      '----------------------------------------------------------------------',
    ].join('\n');

    origError.call(console, '\n' + banner + '\n');
    appendErrorLog('UNHANDLED_REJECTION', banner);
  });

  // プロセス終了時に正常ログファイルがディスクに残らないよう確認
  process.on('exit', () => {
    cleanupNormalLogs();
  });

  console.log(`[logger] ロギング初期化完了（動作中: コンソール表示 / 終了時保存: エラーログのみ）`);
}

/** 直近のエラーログを取得 */
function getRecentErrorLog(maxLines = 100) {
  try {
    if (!fs.existsSync(ERROR_LOG)) return '';
    const content = fs.readFileSync(ERROR_LOG, 'utf8');
    const lines = content.trim().split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

/** 動作中の直近ログ（メモリ上）を取得 */
function getRecentLiveLogs(maxItems = 50) {
  return memoryBuffer.slice(-maxItems);
}

module.exports = {
  initLogger,
  maskSecrets,
  getRecentErrorLog,
  getRecentLiveLogs,
  LOGS_DIR,
  ERROR_LOG,
  APP_LOG,
};

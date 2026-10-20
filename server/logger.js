// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const APP_LOG = path.join(LOGS_DIR, 'app.log');
const ERROR_LOG = path.join(LOGS_DIR, 'error.log');

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

function appendLog(file, level, message) {
  ensureDir();
  const time = new Date().toISOString();
  const line = `[${time}] [${level}] ${maskSecrets(message)}\n`;
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch {}
}

/** ロガーの初期化と未捕捉エラーの監視 */
function initLogger() {
  if (initialized) return;
  initialized = true;
  ensureDir();

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args) => {
    origLog.apply(console, args);
    const msg = util.format(...args);
    appendLog(APP_LOG, 'INFO', msg);
  };

  console.warn = (...args) => {
    origWarn.apply(console, args);
    const msg = util.format(...args);
    appendLog(APP_LOG, 'WARN', msg);
  };

  console.error = (...args) => {
    origError.apply(console, args);
    const msg = util.format(...args);
    appendLog(APP_LOG, 'ERROR', msg);
    appendLog(ERROR_LOG, 'ERROR', msg);
  };

  // 未捕捉の例外（uncaughtException）のキャッチ
  process.on('uncaughtException', (err) => {
    const trace = err && err.stack ? err.stack : String(err);
    const banner = [
      '======================================================================',
      '【致命的エラー】予期せぬ例外が発生しました (uncaughtException)',
      `時刻: ${new Date().toLocaleString('ja-JP')}`,
      `エラー: ${err && err.message ? err.message : String(err)}`,
      'スタックトレース:',
      trace,
      '======================================================================',
    ].join('\n');

    origError.call(console, '\n' + banner + '\n');
    appendLog(APP_LOG, 'FATAL', banner);
    appendLog(ERROR_LOG, 'FATAL', banner);
  });

  // 未処理の Promise 拒絶（unhandledRejection）のキャッチ
  process.on('unhandledRejection', (reason) => {
    const trace = reason && reason.stack ? reason.stack : util.inspect(reason);
    const banner = [
      '----------------------------------------------------------------------',
      '【非同期エラー】未処理の Promise 拒絶が発生しました (unhandledRejection)',
      `時刻: ${new Date().toLocaleString('ja-JP')}`,
      trace,
      '----------------------------------------------------------------------',
    ].join('\n');

    origError.call(console, '\n' + banner + '\n');
    appendLog(APP_LOG, 'UNHANDLED_REJECTION', banner);
    appendLog(ERROR_LOG, 'UNHANDLED_REJECTION', banner);
  });

  console.log(`[logger] ロギング初期化完了 (ログ保存先: ${LOGS_DIR})`);
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

module.exports = {
  initLogger,
  maskSecrets,
  getRecentErrorLog,
  LOGS_DIR,
  APP_LOG,
  ERROR_LOG,
};

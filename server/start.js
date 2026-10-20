'use strict';

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const readline = require('readline');
const logger = require('./logger');

const DEFAULT_PORT = 3939;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      // @ts-ignore
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/** 空いているポートを順番に探索 */
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let p = startPort; p < startPort + maxAttempts; p++) {
    const inUse = await isPortInUse(p);
    if (!inUse) return p;
  }
  return startPort;
}

/** 該当ポートで動いているのが Research Studio か確認 */
async function checkIsResearchStudio(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/info`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data = await res.json();
      return data && data.app === 'Research Studio';
    }
  } catch {}
  return false;
}

function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  } catch {}
}

function pauseAndExit(code = 1) {
  console.log('\n何かキーを押すと画面を閉じます...');
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => process.exit(code));
  } else {
    setTimeout(() => process.exit(code), 5000);
  }
}

async function main() {
  console.log('\n' + '═'.repeat(56));
  console.log('  ◆ Research Studio 起動マネージャー');
  console.log('═'.repeat(56) + '\n');

  const inUse = await isPortInUse(DEFAULT_PORT);
  let targetPort = DEFAULT_PORT;

  if (inUse) {
    const isOurApp = await checkIsResearchStudio(DEFAULT_PORT);
    if (isOurApp) {
      console.log(`[情報] すでに Research Studio は起動しています（ポート ${DEFAULT_PORT}）`);
      console.log(`ブラウザで http://localhost:${DEFAULT_PORT} を開きます...\n`);
      openBrowser(`http://localhost:${DEFAULT_PORT}`);
      console.log('※ 終了する場合は stop.bat を実行するか、既存の画面を閉じてください。\n');
      return;
    } else {
      console.log(`[注意] ポート ${DEFAULT_PORT} は別のプログラムが使用しています。`);
      targetPort = await findAvailablePort(DEFAULT_PORT + 1);
      console.log(`空きポート ${targetPort} を検出しました。ポート ${targetPort} で起動します...\n`);
    }
  }

  console.log('サーバーを起動しています...');
  const serverScript = path.join(__dirname, 'index.js');
  const env = { ...process.env, PORT: String(targetPort) };

  const child = spawn(process.execPath, [serverScript], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env,
  });

  const url = `http://localhost:${targetPort}`;

  // 1.5秒後に自動でブラウザを開く
  setTimeout(() => {
    openBrowser(url);
  }, 1500);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log('\n' + '═'.repeat(56));
      console.log(`【エラー】サーバーが異常終了しました (終了コード: ${code})`);
      console.log(`詳細なエラーログは以下に保存されています:`);
      console.log(`  ▶ ${logger.ERROR_LOG}`);
      console.log('═'.repeat(56) + '\n');
      pauseAndExit(code);
    }
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('\n【起動マネージャーエラー】', err.message);
  console.log(`詳細ログ: ${logger.ERROR_LOG}`);
  pauseAndExit(1);
});

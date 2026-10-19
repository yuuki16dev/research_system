'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const net = require('net');

const PORT = 3939;
const URL = `http://localhost:${PORT}`;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
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
  } catch (e) {
    // ignore browser open failures
  }
}

async function main() {
  console.log('\n' + '═'.repeat(56));
  console.log('  ◆ Research Studio 起動マネージャー');
  console.log('═'.repeat(56) + '\n');

  const inUse = await isPortInUse(PORT);
  if (inUse) {
    console.log(`[情報] すでに Research Studio は起動しています（ポート ${PORT}）`);
    console.log(`ブラウザで ${URL} を開きます...\n`);
    openBrowser(URL);
    console.log('※ 終了する場合は stop.bat を実行するか、画面を閉じてください。\n');
    return;
  }

  console.log('サーバーを起動しています...');
  const serverScript = path.join(__dirname, 'index.js');
  const child = spawn(process.execPath, [serverScript], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

  // 1.5秒後に自動でブラウザを開く
  setTimeout(() => {
    openBrowser(URL);
  }, 1500);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\nサーバーが終了コード ${code} で停止しました。`);
    }
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[エラー]', err.message);
  process.exit(1);
});

'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const net = require('net');
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

/** 該当ポートで動いているのが Research Studio か確認 (IPv4 / IPv6 両対応) */
async function checkIsResearchStudio(port) {
  const hosts = ['127.0.0.1', 'localhost'];
  for (const h of hosts) {
    try {
      const res = await fetch(`http://${h}:${port}/api/info`, {
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.app === 'Research Studio') return true;
      }
    } catch {}
  }
  return false;
}

/** ポートを強制解放する（ゾンビプロセスや未応答プロセスの除去） */
function forceFreePort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid) && pid !== '0' && pid !== String(process.pid)) {
          try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch {}
        }
      }
    } else {
      const output = execSync(`lsof -t -i:${port}`, { encoding: 'utf8' }).trim();
      if (output) {
        const pids = output.split('\n');
        for (const pid of pids) {
          if (pid && pid !== String(process.pid)) {
            try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); } catch {}
          }
        }
      }
    }
  } catch {}
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

let pkgVer = '1.8.0';
try {
  pkgVer = require('../package.json').version || pkgVer;
} catch {}

async function main() {
  const nodeMajor = parseInt((process.versions.node || '0').split('.')[0], 10);
  if (nodeMajor < 18) {
    console.log('\n' + '═'.repeat(60));
    console.log('  【環境エラー】Node.js のバージョンが要件を満たしていません');
    console.log('═'.repeat(60));
    console.log(`\n  現在の Node.js バージョン : v${process.versions.node}`);
    console.log('  アプリの動作に必要な環境 : Node.js v18 以上\n');
    console.log('  ※「v18以上」はアプリのバージョンではなく、実行に必要な Node.js のバージョンです。\n');
    console.log('  【解決方法 1】Node.js不要のワンクリック版を使う（推奨・もう1つの方法）');
    console.log('    GitHub Releases から「ResearchStudio.exe」をダウンロードしてください:');
    console.log('    https://github.com/yuuki16dev/research_system/releases\n');
    console.log('  【解決方法 2】Node.js を最新版（LTS版）に更新する');
    console.log('    公式サイトから最新の Node.js をインストールしてください:');
    console.log('    https://nodejs.org/\n');
    console.log('═'.repeat(60) + '\n');
    pauseAndExit(1);
    return;
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`  ◆ Research Studio v${pkgVer} 起動マネージャー`);
  console.log('═'.repeat(56) + '\n');

  // 二重起動チェック
  const inUse = await isPortInUse(DEFAULT_PORT);
  if (inUse) {
    const isOurApp = await checkIsResearchStudio(DEFAULT_PORT);
    if (isOurApp) {
      console.log(`\n${'═'.repeat(56)}`);
      console.log(`  [情報] Research Studio はすでに起動しています`);
      console.log(`  アクセス先: http://localhost:${DEFAULT_PORT}`);
      console.log(`${'═'.repeat(56)}\n`);
      console.log('ブラウザで既存の画面を開きます...\n');
      openBrowser(`http://localhost:${DEFAULT_PORT}`);
      console.log('※ すでに起動しているため、この起動ウィンドウは1.5秒後に自動で閉じます...');
      setTimeout(() => process.exit(0), 1500);
      return;
    }

    // もしポート 3939 が塞がっているが正常応答しない場合は、前回のゾンビプロセスを解放
    console.log(`[情報] ポート ${DEFAULT_PORT} を解放・クリーンアップしています...`);
    forceFreePort(DEFAULT_PORT);
    await new Promise((r) => setTimeout(r, 600));
  }

  // サーバー起動（別プロセスを spawn するのではなく、同一プロセスで index.js を実行して単一PID化）
  console.log('サーバーを起動しています...');
  process.env.PORT = String(DEFAULT_PORT);
  process.env.AUTO_OPEN = '1';

  // index.js を直接読み込んで起動
  require('./index.js');
}

main().catch((err) => {
  console.error('\n【起動マネージャーエラー】', err.message);
  console.log(`詳細ログ: ${logger.ERROR_LOG}`);
  pauseAndExit(1);
});


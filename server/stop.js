'use strict';

const { execSync } = require('child_process');

const PORT = 3939;

console.log('\n' + '═'.repeat(56));
console.log('  ◆ Research Studio 停止マネージャー');
console.log('═'.repeat(56) + '\n');

function killPort(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid) && pid !== '0') {
          pids.add(pid);
        }
      }

      if (pids.size === 0) {
        console.log(`Research Studio は起動していません。（ポート ${port} は空いています）`);
        return;
      }

      for (const pid of pids) {
        console.log(`プロセス (PID: ${pid}) を停止しています...`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } catch {}
      }
      console.log('\n[完了] Research Studio を正常に停止しました。');
    } else {
      const output = execSync(`lsof -t -i:${port}`, { encoding: 'utf8' }).trim();
      if (!output) {
        console.log(`Research Studio は起動していません。（ポート ${port} は空いています）`);
        return;
      }
      const pids = output.split('\n');
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      }
      console.log('\n[完了] Research Studio を正常に停止しました。');
    }
  } catch (err) {
    console.log(`Research Studio は現在起動していません。（ポート ${port} は空いています）`);
  }
}

killPort(PORT);
console.log('');

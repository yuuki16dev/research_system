'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

async function verify() {
  console.log('[VERIFY] Launching start.bat via cmd.exe...');
  const child = spawn('cmd.exe', ['/c', 'start.bat'], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });

  let success = false;
  let appInfo = null;

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch('http://localhost:3939/api/info');
      if (res.ok) {
        appInfo = await res.json();
        success = true;
        break;
      }
    } catch {}
  }

  try {
    child.kill('SIGTERM');
  } catch {}
  try {
    execSync('node server/stop.js', { cwd: ROOT, stdio: 'ignore' });
  } catch {}

  if (success && appInfo) {
    console.log('[VERIFY SUCCESS] start.bat launched smoothly!');
    console.log(`  App Name : ${appInfo.app}`);
    console.log(`  Version  : v${appInfo.version}`);
    console.log(`  Mode     : ${appInfo.settings.effectiveMode}`);
    console.log(`  Search   : ${appInfo.settings.effectiveSearch}`);
    process.exit(0);
  } else {
    console.error('[VERIFY FAILED] Could not reach Research Studio on port 3939 within timeout');
    process.exit(1);
  }
}

verify().catch((e) => {
  console.error('[VERIFY ERROR]', e);
  process.exit(1);
});

'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const exePath = path.join(ROOT, 'dist', 'ResearchStudio.exe');

async function testExe() {
  console.log('[TEST EXE] Spawning dist/ResearchStudio.exe ...');
  const child = spawn(exePath, [], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  });

  let ok = false;
  let info = null;

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch('http://localhost:3939/api/info');
      if (res.ok) {
        info = await res.json();
        ok = true;
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

  if (ok && info) {
    console.log('[TEST EXE SUCCESS] ResearchStudio.exe launched and responded!');
    console.log(`  App: ${info.app} v${info.version}`);
    console.log(`  Mode: ${info.settings.effectiveMode}`);
    process.exit(0);
  } else {
    console.error('[TEST EXE FAILED] ResearchStudio.exe did not respond within timeout');
    process.exit(1);
  }
}

testExe().catch((e) => {
  console.error('[TEST EXE ERROR]', e);
  process.exit(1);
});

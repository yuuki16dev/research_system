'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const exePath = path.join(ROOT, 'dist', 'ResearchStudio.exe');

async function testExe() {
  const fs = require('fs');
  const os = require('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-verify-'));
  const isolatedExe = path.join(tempDir, 'ResearchStudio.exe');

  console.log(`[TEST EXE] Testing in isolated clean directory: ${tempDir}`);
  fs.copyFileSync(exePath, isolatedExe);

  console.log('[TEST EXE] Spawning isolated ResearchStudio.exe ...');
  const child = spawn(isolatedExe, [], {
    cwd: tempDir,
    stdio: 'ignore',
    windowsHide: true,
  });

  let ok = false;
  let info = null;

  for (let i = 0; i < 35; i++) {
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

  // クリーンアップ
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  if (ok && info) {
    console.log('[TEST EXE SUCCESS] ResearchStudio.exe launched and responded in isolated environment!');
    console.log(`  App: ${info.app} v${info.version}`);
    console.log(`  Mode: ${info.settings.effectiveMode}`);
    process.exit(0);
  } else {
    // もし error.log が生成されていたら中身を表示してデバッグ支援
    try {
      const errLogPath = path.join(tempDir, 'data', 'logs', 'error.log');
      if (fs.existsSync(errLogPath)) {
        console.error('[TEST EXE ERROR LOG]:\n', fs.readFileSync(errLogPath, 'utf8'));
      }
    } catch {}
    console.error('[TEST EXE FAILED] ResearchStudio.exe did not respond within timeout in isolated environment');
    process.exit(1);
  }
}

testExe().catch((e) => {
  console.error('[TEST EXE ERROR]', e);
  process.exit(1);
});

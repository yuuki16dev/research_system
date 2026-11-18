'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const distDir = path.join(ROOT, 'dist');
const pkgDir = path.join(distDir, 'ResearchStudio-Windows');
const zipPath = path.join(distDir, 'ResearchStudio-win.zip');

console.log('[PACKAGE] Preparing release distribution package ...');

if (fs.existsSync(pkgDir)) {
  fs.rmSync(pkgDir, { recursive: true, force: true });
}
fs.mkdirSync(pkgDir, { recursive: true });

const filesToInclude = [
  { src: path.join(distDir, 'ResearchStudio.exe'), dest: path.join(pkgDir, 'ResearchStudio.exe') },
  { src: path.join(ROOT, 'stop.bat'), dest: path.join(pkgDir, 'stop.bat') },
  { src: path.join(ROOT, '.env.example'), dest: path.join(pkgDir, '.env.example') },
  { src: path.join(ROOT, 'はじめにお読みください.txt'), dest: path.join(pkgDir, 'はじめにお読みください.txt') },
];

for (const file of filesToInclude) {
  if (!fs.existsSync(file.src)) {
    throw new Error(`Missing required release source file: ${file.src}`);
  }
  fs.copyFileSync(file.src, file.dest);
  console.log(`  + Added: ${path.basename(file.dest)}`);
}

if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}

console.log(`[PACKAGE] Compressing into ${zipPath} ...`);
if (process.platform === 'win32') {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${pkgDir}/*' -DestinationPath '${zipPath}' -Force"`, {
    stdio: 'inherit',
    cwd: ROOT,
  });
} else {
  execSync(`zip -r "${zipPath}" .`, { cwd: pkgDir, stdio: 'inherit' });
}

console.log('[PACKAGE SUCCESS] Release package built successfully!');

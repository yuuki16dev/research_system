'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const batFiles = ['start.bat', 'stop.bat'];

let fixedCount = 0;

for (const relPath of batFiles) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) continue;

  let buf = fs.readFileSync(fullPath);

  // Strip BOM if present
  let hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (hasBom) {
    buf = buf.subarray(3);
    console.log(`[FIX] Stripped UTF-8 BOM from ${relPath}`);
  }

  // Normalize line endings to CRLF
  const originalStr = buf.toString('utf8');
  const normalizedStr = originalStr.replace(/\r?\n/g, '\r\n');

  if (hasBom || originalStr !== normalizedStr) {
    fs.writeFileSync(fullPath, Buffer.from(normalizedStr, 'utf8'));
    console.log(`[FIX] Normalized line endings to CRLF for ${relPath}`);
    fixedCount++;
  } else {
    console.log(`[OK] ${relPath} already has strict CRLF and no BOM`);
  }
}

console.log(`Batch normalization complete. Fixed ${fixedCount} files.`);

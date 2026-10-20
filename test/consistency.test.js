'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('version consistency: package.json and package-lock.json must match', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pkgLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

  assert.ok(pkg.version, 'package.json must specify version');
  assert.equal(pkgLock.version, pkg.version, 'package-lock.json version must match package.json');
  assert.equal(
    pkgLock.packages[''].version,
    pkg.version,
    'package-lock.json root package version must match package.json'
  );
});

test('version consistency: CHANGELOG.md must contain current package version entry', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

  const expectedHeader = `## [v${pkg.version}]`;
  assert.ok(
    changelog.includes(expectedHeader),
    `CHANGELOG.md must contain release section header "${expectedHeader}"`
  );
});

test('version consistency: public/index.html must not contain obsolete v0.1.0 and must have version placeholders', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  assert.ok(!html.includes('v0.1.0'), 'public/index.html must not contain obsolete v0.1.0 version string');
  assert.ok(html.includes('id="footer-version"'), 'public/index.html must have footer-version element');
  assert.ok(html.includes('id="settings-version-badge"'), 'public/index.html must have settings-version-badge element');
  assert.ok(html.includes(`v${pkg.version}`), `public/index.html must contain current version v${pkg.version}`);
});

test('port consistency: default ports in start.js and stop.js match expected 3939', () => {
  const startJs = fs.readFileSync(path.join(ROOT, 'server', 'start.js'), 'utf8');
  const stopJs = fs.readFileSync(path.join(ROOT, 'server', 'stop.js'), 'utf8');
  const indexJs = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');

  assert.ok(startJs.includes('3939'), 'server/start.js must reference default port 3939');
  assert.ok(stopJs.includes('3939'), 'server/stop.js must reference default port 3939');
  assert.ok(indexJs.includes('3939'), 'server/index.js must reference default port 3939');
});

test('gitattributes: enforces CRLF for .bat and LF for .sh', () => {
  const gitattributesPath = path.join(ROOT, '.gitattributes');
  assert.ok(fs.existsSync(gitattributesPath), '.gitattributes file must exist at repository root');
  const content = fs.readFileSync(gitattributesPath, 'utf8');
  assert.match(content, /\*\.bat\s+text\s+eol=crlf/i, '.gitattributes must specify eol=crlf for *.bat');
  assert.match(content, /\*\.cmd\s+text\s+eol=crlf/i, '.gitattributes must specify eol=crlf for *.cmd');
  assert.match(content, /\*\.sh\s+text\s+eol=lf/i, '.gitattributes must specify eol=lf for *.sh');
});

test('batch file integrity: start.bat and stop.bat must have CRLF, no BOM, and chcp 65001', () => {
  const batFiles = ['start.bat', 'stop.bat'];

  for (const file of batFiles) {
    const filePath = path.join(ROOT, file);
    assert.ok(fs.existsSync(filePath), `${file} must exist`);

    const buf = fs.readFileSync(filePath);
    // 1. BOM check: UTF-8 BOM is EF BB BF
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    assert.strictEqual(hasBom, false, `${file} must NOT contain UTF-8 BOM (causes cmd.exe syntax errors)`);

    // 2. CRLF check: cmd.exe requires strict CRLF line endings
    const str = buf.toString('utf8');
    const soloLf = (str.replace(/\r\n/g, '').match(/\n/g) || []).length;
    assert.strictEqual(
      soloLf,
      0,
      `${file} contains ${soloLf} solo LF (\\n) line endings! cmd.exe requires strict CRLF (\\r\\n).`
    );

    // 3. For start.bat, check code page 65001 for UTF-8 display
    if (file === 'start.bat') {
      assert.ok(
        str.includes('chcp 65001'),
        'start.bat must include chcp 65001 to prevent Japanese text mojibake'
      );

      // Verify all goto targets exist as labels (:LABEL)
      const gotoMatches = str.matchAll(/goto\s+([A-Za-z0-9_]+)/gi);
      for (const m of gotoMatches) {
        const target = m[1];
        if (target.toLowerCase() === ':eof' || target.toLowerCase() === 'eof') continue;
        const labelRegex = new RegExp(`^\\s*:${target}\\b`, 'm');
        assert.ok(
          labelRegex.test(str),
          `start.bat jumps to label "${target}" via goto, but label ":${target}" is missing!`
        );
      }
    }
  }
});


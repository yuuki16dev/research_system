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

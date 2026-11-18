'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEMVER_TAG_RE = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const DEFAULT_RELEASE_ASSETS = [
  path.join(ROOT, 'dist', 'ResearchStudio-win.zip'),
  path.join(ROOT, 'dist', 'ResearchStudio.exe'),
  path.join(ROOT, 'はじめにお読みください.txt'),
];

/**
 * Resolve the release tag from workflow_dispatch input, git tag ref, or package.json,
 * and verify strict SemVer formatting plus package.json version consistency.
 */
function resolveAndValidateReleaseTag({ inputTag = '', ref = '', refName = '', pkgVersion = '' } = {}) {
  const trimmedInput = String(inputTag || '').trim();
  const trimmedRef = String(ref || '').trim();
  const trimmedRefName = String(refName || '').trim();
  const normalizedPkgVersion = String(pkgVersion || '').trim();

  let tag = '';
  if (trimmedInput) {
    tag = trimmedInput;
  } else if (trimmedRef.startsWith('refs/tags/') && trimmedRefName) {
    tag = trimmedRefName;
  } else {
    tag = normalizedPkgVersion ? `v${normalizedPkgVersion}` : '';
  }

  const match = tag.match(SEMVER_TAG_RE);
  if (!match) {
    throw new Error(`不正なリリースタグ形式です: "${tag}"（例: v2.19.1 の形式で指定してください）`);
  }

  const tagVersion = match[1];
  if (normalizedPkgVersion && tagVersion !== normalizedPkgVersion) {
    throw new Error(
      `リリースタグ (${tag}) と package.json の version (${normalizedPkgVersion}) が一致しません`
    );
  }

  return { tag, version: tagVersion };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a single version section from CHANGELOG.md (Keep a Changelog / vX.Y.Z headings).
 * Returns null if no matching section exists.
 */
function extractChangelogSection(changelogText, tagOrVersion) {
  const cleanVer = String(tagOrVersion || '').trim().replace(/^v/i, '');
  if (!cleanVer || !changelogText) return null;

  const headingRe = new RegExp(`^##\\s+\\[?v?${escapeRegExp(cleanVer)}\\]?(?:\\s|$|\\-)`, 'i');
  const nextSectionRe = /^##\s+/;
  const lines = String(changelogText).split(/\r?\n/);

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const captured = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (i > startIdx && nextSectionRe.test(lines[i])) break;
    captured.push(lines[i]);
  }

  const section = captured.join('\n').trim();
  return section || null;
}

/**
 * Build Japanese release notes Markdown from CHANGELOG.md with a safe fallback when missing.
 */
function buildReleaseNotes({
  tag,
  changelogPath = path.join(ROOT, 'CHANGELOG.md'),
  outPath = path.join(ROOT, 'dist', 'release-notes.md'),
} = {}) {
  let changelogText = '';
  if (fs.existsSync(changelogPath)) {
    changelogText = fs.readFileSync(changelogPath, 'utf8');
  }

  const section = extractChangelogSection(changelogText, tag);
  const installGuide = [
    '---',
    '### 📦 インストール方法（Windows ワンクリック簡易版）',
    '1. 下の **Assets** から `ResearchStudio-win.zip` をダウンロードし、任意のフォルダへ展開してください。',
    '2. 展開したフォルダ内の `ResearchStudio.exe` をダブルクリックすると自動起動します（終了は `stop.bat`）。',
    '3. 配布ファイルの整合性を検証する場合は `SHA256SUMS.txt` をご確認ください。',
  ].join('\n');

  const body = section
    ? `${section}\n\n${installGuide}\n`
    : `## Research Studio ${tag}\n\n> ※ CHANGELOG.md に ${tag} の記載が見つからなかったため、自動生成ノートを併用します。\n\n${installGuide}\n`;

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, body, 'utf8');
  }

  return { found: Boolean(section), outPath, content: body };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Verify all release assets exist and are non-empty, then write SHA256SUMS.txt.
 */
function generateSha256Sums({
  files = DEFAULT_RELEASE_ASSETS,
  outPath = path.join(ROOT, 'dist', 'SHA256SUMS.txt'),
} = {}) {
  const lines = [];
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`必須のリリース配布ファイルが見つかりません: ${filePath}`);
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`リリース配布ファイルが空または不正です: ${filePath}`);
    }
    const digest = sha256File(filePath);
    lines.push(`${digest}  ${path.basename(filePath)}`);
  }

  const content = `${lines.join('\n')}\n`;
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');
  }
  return lines;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === '--resolve-tag') {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const { tag, version } = resolveAndValidateReleaseTag({
      inputTag: process.env.INPUT_TAG,
      ref: process.env.GITHUB_REF,
      refName: process.env.GITHUB_REF_NAME,
      pkgVersion: pkg.version,
    });
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nversion=${version}\n`, 'utf8');
    }
    console.log(`Target Release Tag: ${tag} (package.json: ${pkg.version})`);
  } else if (cmd === '--prepare-notes') {
    const tag = args[1];
    const outPath = args[2] ? path.resolve(args[2]) : path.join(ROOT, 'dist', 'release-notes.md');
    const result = buildReleaseNotes({ tag, outPath });
    console.log(`[RELEASE NOTES] Generated ${outPath} (from CHANGELOG: ${result.found})`);
  } else if (cmd === '--checksums') {
    const outPath = args[1] ? path.resolve(args[1]) : path.join(ROOT, 'dist', 'SHA256SUMS.txt');
    const customFiles = args.slice(2).map((p) => path.resolve(p));
    const lines = generateSha256Sums({
      files: customFiles.length ? customFiles : DEFAULT_RELEASE_ASSETS,
      outPath,
    });
    console.log(`[CHECKSUMS] Wrote ${lines.length} entries to ${outPath}`);
  } else {
    console.error('Usage: release-helper.js <--resolve-tag | --prepare-notes <tag> [out] | --checksums [out] [files...]>');
    process.exit(1);
  }
}

module.exports = {
  resolveAndValidateReleaseTag,
  extractChangelogSection,
  buildReleaseNotes,
  generateSha256Sums,
};

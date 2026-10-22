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

test('shutdown UI consistency: power button, modal elements, icon, and module must exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-power-shutdown"'), 'public/index.html must have btn-power-shutdown');
  assert.ok(html.includes('id="modal-shutdown"'), 'public/index.html must have modal-shutdown');
  assert.ok(html.includes('id="shutdown-normal-view"'), 'public/index.html must have shutdown-normal-view');
  assert.ok(html.includes('id="shutdown-busy-warning"'), 'public/index.html must have shutdown-busy-warning');
  assert.ok(html.includes('id="shutdown-completed-overlay"'), 'public/index.html must have shutdown-completed-overlay');

  const uiJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ui.js'), 'utf8');
  assert.ok(uiJs.includes('power:'), 'public/js/ui.js must have power icon SVG');

  const shutdownJsPath = path.join(ROOT, 'public', 'js', 'modules', 'shutdown.js');
  assert.ok(fs.existsSync(shutdownJsPath), 'public/js/modules/shutdown.js must exist');
  const shutdownJs = fs.readFileSync(shutdownJsPath, 'utf8');
  assert.ok(shutdownJs.includes('bindShutdownHandlers'), 'shutdown.js must export bindShutdownHandlers');
  assert.ok(shutdownJs.includes('/api/lifecycle/leave'), 'shutdown.js must handle /api/lifecycle/leave beacon');
  assert.ok(shutdownJs.includes('isResearchActive()'), 'shutdown.js must check isResearchActive for mis-click guard');

  const apiJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'api.js'), 'utf8');
  assert.ok(apiJs.includes('shutdown:'), 'public/js/api.js must have shutdown method');
});

test('dynamic year consistency: util labels and frontend dynamically adapt to current year', () => {
  const currentYear = new Date().getFullYear();
  const util = require('../server/util');
  assert.equal(util.PURPOSE_LABELS.trend, `${currentYear}年最新トレンド・速報`, 'PURPOSE_LABELS.trend must dynamically reflect current year');

  const pipeline = fs.readFileSync(path.join(ROOT, 'server', 'pipeline.js'), 'utf8');
  assert.ok(pipeline.includes('${currentYear}年最新トレンド・速報'), 'pipeline.js must dynamically interpolate currentYear for trend purpose');

  const researchJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'research.js'), 'utf8');
  assert.ok(researchJs.includes('periodYearSub.textContent = `最新動向 (${prevYear}〜${currentYear})`'), 'research.js must dynamically set period-year-subtext');
  assert.ok(researchJs.includes('chipTrend.dataset.example = `${currentYear}年のショート動画マーケティングのトレンド`'), 'research.js must dynamically set example chip year');
  assert.ok(researchJs.includes('for (let y = 2015; y <= currentYear; y++)'), 'research.js must dynamically populate custom period select options up to currentYear');
});

test('computed style collision assertion: search input icon and text padding must not overlap', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

  // 1. .input-sm の padding に !important が付いていないことを検証（グローバル上書き破壊の防止）
  const inputSmMatch = css.match(/\.input-sm\s*\{([^}]+)\}/);
  assert.ok(inputSmMatch, '.input-sm rule must exist in styles.css');
  assert.ok(
    !inputSmMatch[1].includes('padding: 0 10px !important') && !inputSmMatch[1].includes('padding:0 10px!important'),
    '.input-sm must not use !important on padding to prevent clobbering icon-padded inputs'
  );

  // 2. .dsearch-wrap .input の padding-left がアイコン幅（14px）+ left（10px）+ 余白（10px以上）= 34px 以上確保されていること
  const dsearchMatch = css.match(/\.dsearch-wrap\s+\.input\s*\{([^}]+)\}/);
  assert.ok(dsearchMatch, '.dsearch-wrap .input rule must exist');
  const dsearchPad = dsearchMatch[1].match(/padding-left:\s*(\d+)px/);
  assert.ok(dsearchPad, '.dsearch-wrap .input must have padding-left specified');
  const dPadVal = parseInt(dsearchPad[1], 10);
  assert.ok(
    dPadVal >= 34,
    `.dsearch-wrap .input padding-left (${dPadVal}px) must be >= 34px to prevent collision with search icon`
  );

  // 3. .hsearch-wrap .input の padding-left も十分なクリアランスがあること
  const hsearchMatch = css.match(/\.hsearch-wrap\s+\.input\s*\{([^}]+)\}/);
  assert.ok(hsearchMatch, '.hsearch-wrap .input rule must exist');
  const hsearchPad = hsearchMatch[1].match(/padding-left:\s*(\d+)px/);
  assert.ok(hsearchPad, '.hsearch-wrap .input must have padding-left specified');
  const hPadVal = parseInt(hsearchPad[1], 10);
  assert.ok(
    hPadVal >= 34,
    `.hsearch-wrap .input padding-left (${hPadVal}px) must be >= 34px to prevent collision with search icon`
  );
});

test('style selector and custom style field consistency: DOM elements and CSS rules exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

  // 1. index.html に案Aのスタイルセレクターとカスタム入力欄が存在すること
  assert.ok(html.includes('id="btn-style-selector"'), 'btn-style-selector must exist');
  assert.ok(html.includes('id="style-dropdown-menu"'), 'style-dropdown-menu must exist');
  assert.ok(html.includes('data-style="business"'), 'business style option must exist');
  assert.ok(html.includes('data-style="tech"'), 'tech style option must exist');
  assert.ok(html.includes('data-style="brief"'), 'brief style option must exist');
  assert.ok(html.includes('data-style="decision"'), 'decision style option must exist');
  assert.ok(html.includes('data-style="academic"'), 'academic style option must exist');
  assert.ok(html.includes('data-style="custom"'), 'custom style option must exist');
  assert.ok(html.includes('id="custom-style-field"'), 'custom-style-field must exist');
  assert.ok(html.includes('id="custom-style-input"'), 'custom-style-input must exist');
  assert.ok(html.includes('id="search-chips-row"'), 'search-chips-row must exist');

  // 2. styles.css に必要なクラスとアニメーション・非表示スタイルが定義されていること
  assert.ok(css.includes('.style-selector-wrap'), '.style-selector-wrap must exist in CSS');
  assert.ok(css.includes('.btn-style-selector'), '.btn-style-selector must exist in CSS');
  assert.ok(css.includes('.style-dropdown-menu'), '.style-dropdown-menu must exist in CSS');
  assert.ok(css.includes('.custom-style-field'), '.custom-style-field must exist in CSS');
  assert.ok(css.includes('.search-chips-row.is-hidden'), '.search-chips-row.is-hidden must exist in CSS');

  // 3. .search-chips-row.is-hidden で非表示制御（max-height: 0, opacity: 0）が徹底されていること
  const isHiddenMatch = css.match(/\.search-chips-row\.is-hidden\s*\{([^}]+)\}/);
  assert.ok(isHiddenMatch, '.search-chips-row.is-hidden rule must be parsed');
  assert.ok(isHiddenMatch[1].includes('max-height: 0'), '.search-chips-row.is-hidden must have max-height: 0');
  assert.ok(isHiddenMatch[1].includes('opacity: 0'), '.search-chips-row.is-hidden must have opacity: 0');

  // 4. ドロップダウンメニューのUI被り・見切れ防止アサーション（不透明度・max-height・上向き展開・文字省略）
  assert.ok(!html.includes('class="style-dropdown-menu glass"'), 'style-dropdown-menu must not have glass class to avoid unwanted opacity collision');
  
  const menuCssMatch = css.match(/\.style-dropdown-menu\s*\{([^}]+)\}/);
  assert.ok(menuCssMatch, '.style-dropdown-menu rule must exist');
  assert.ok(menuCssMatch[1].includes('max-height:'), '.style-dropdown-menu must have max-height constraint');
  assert.ok(menuCssMatch[1].includes('overflow-y: auto'), '.style-dropdown-menu must have overflow-y: auto for scrollability');
  
  const zIndexMatch = menuCssMatch[1].match(/z-index:\s*(\d+)/);
  assert.ok(zIndexMatch, '.style-dropdown-menu must have z-index');
  assert.ok(parseInt(zIndexMatch[1], 10) >= 500, '.style-dropdown-menu z-index must be >= 500 to stay above all background elements');

  assert.ok(css.includes('.style-dropdown-menu.drop-up'), 'styles.css must support .style-dropdown-menu.drop-up for smart flip-up');
  
  // 5. スタッキングコンテキスト（重なり順序）アサーション：一時的プルダウンが過去の履歴カードより必ず1番上に表示されること
  const heroCardMatch = css.match(/\.search-hero-card\s*\{([^}]+)\}/);
  assert.ok(heroCardMatch, '.search-hero-card rule must exist');
  assert.ok(heroCardMatch[1].includes('z-index:'), '.search-hero-card must have explicit z-index for stacking context elevation');
  
  assert.ok(css.includes('.search-hero-card.has-open-dropdown') || css.includes('.search-hero-card:has'), 'search card must elevate z-index when dropdown is open');
  assert.ok(css.includes('.style-selector-wrap.is-open') || css.includes('.style-selector-wrap:has'), 'style selector must elevate z-index when open');

  const recentCardMatch = css.match(/\.recent-card\s*\{([^}]+)\}/);
  assert.ok(recentCardMatch, '.recent-card rule must exist');
  assert.ok(recentCardMatch[1].includes('z-index: 1'), '.recent-card must have lower z-index than search dropdown overlays');

  const researchJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'research.js'), 'utf8');
  assert.ok(researchJs.includes('getBoundingClientRect'), 'research.js must check viewport position with getBoundingClientRect');
  assert.ok(researchJs.includes('drop-up'), 'research.js must dynamically toggle drop-up class on space shortage');
  assert.ok(researchJs.includes('has-open-dropdown'), 'research.js must toggle has-open-dropdown on container for stacking elevation');

  // 6. スプリットモード（Side-by-Side）時の左上UI被り防止アサーション（トップバー・TOC・エクスポートバー）
  assert.ok(!html.includes('id="export-bar" class="export-bar glass"') && !html.includes('class="export-bar glass"'), 'export-bar must not have glass class to prevent transparency bleed-through');
  assert.ok(css.includes('.status-pill') && css.includes('white-space: nowrap'), 'status-pill must have white-space: nowrap to prevent awkward vertical text wrapping');
  assert.ok(css.includes('body.has-deepdive-split .results-layout') && css.includes('grid-template-columns: 1fr'), 'split results-layout must be 1fr to maximize readability');
  assert.ok(css.includes('body.has-deepdive-split .toc') && css.includes('display: none'), 'split TOC must be hidden to eliminate collision with export-bar buttons');

  // 7. 通常時TOCの被り防止クリアランス ＆ スプリット時エクスポートバーのスリム化（可読区域最大化）アサーション
  const tocMatch = css.match(/\.toc\s*\{([^}]+)\}/);
  assert.ok(tocMatch, '.toc rule must exist');
  assert.ok(tocMatch[1].includes('top: calc(14px + var(--topbar-h) + 98px)'), '.toc must have safe clearance (>95px) below .export-bar to prevent overlap');

  assert.ok(css.includes('body.has-deepdive-split .export-bar') && css.includes('flex-direction: row'), 'split export-bar must be 1 row to prevent taking up vertical reading space');
  assert.ok(css.includes('body.has-deepdive-split .export-bar') && css.includes('max-height: 48px'), 'split export-bar must cap height to <= 48px to preserve maximum reading area');
});

test('client-side ES modules syntax integrity: all public/js files must compile with node --check without SyntaxError or duplicate declarations', () => {
  const { execFileSync } = require('child_process');
  const jsDir = path.join(ROOT, 'public', 'js');
  const findJsFiles = (dir) => {
    let results = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) results.push(...findJsFiles(full));
      else if (full.endsWith('.js')) results.push(full);
    }
    return results;
  };

  const jsFiles = findJsFiles(jsDir);
  assert.ok(jsFiles.length >= 10, 'Must check all client-side JavaScript modules');

  for (const file of jsFiles) {
    const code = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);

    try {
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : err.message;
      assert.fail(`Client module ${rel} failed ES module syntax check:\n${stderr}`);
    }
  }
});

test('client-side ES module imports and exports consistency: all imported symbols must exist in target modules', () => {
  const jsDir = path.join(ROOT, 'public', 'js');
  const findJsFiles = (dir) => {
    let results = [];
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) results.push(...findJsFiles(full));
      else if (full.endsWith('.js')) results.push(full);
    }
    return results;
  };

  const files = findJsFiles(jsDir);
  const fileExports = {};

  for (const f of files) {
    const normPath = path.relative(ROOT, f).replace(/\\/g, '/');
    const code = fs.readFileSync(f, 'utf8');
    const exports = new Set();

    for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g)) {
      exports.add(m[1]);
    }
    for (const m of code.matchAll(/export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g)) {
      exports.add(m[1]);
    }
    for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
      m[1].split(',').forEach((item) => {
        const parts = item.trim().split(/\s+as\s+/);
        const name = parts[parts.length - 1].trim();
        if (name) exports.add(name);
      });
    }
    if (code.includes('export default')) {
      exports.add('default');
    }
    fileExports[normPath] = exports;
  }

  for (const f of files) {
    const normPath = path.relative(ROOT, f).replace(/\\/g, '/');
    const code = fs.readFileSync(f, 'utf8');

    for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const importedNames = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const relPath = m[2];
      const dir = path.dirname(normPath);
      let target = path.posix.normalize(path.posix.join(dir, relPath));
      if (!target.endsWith('.js')) target += '.js';

      assert.ok(fileExports[target], `Module ${target} imported by ${normPath} must exist`);
      for (const name of importedNames) {
        assert.ok(
          fileExports[target].has(name),
          `Symbol '${name}' imported by ${normPath} from ${relPath} must be exported by ${target}`
        );
      }
    }
  }
});

test('pdf print margin consistency: print.css and pdf.js must enforce generous 18mm margin', () => {
  const printCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'print.css'), 'utf8');
  const pdfJs = fs.readFileSync(path.join(ROOT, 'server', 'pdf.js'), 'utf8');

  assert.ok(
    printCss.includes('margin: 16mm 18mm 16mm 18mm;'),
    'public/css/print.css must enforce generous 18mm horizontal margins to prevent claustrophobic layout'
  );
  assert.ok(
    pdfJs.includes('margin: 16mm 18mm 16mm 18mm;'),
    'server/pdf.js must enforce generous 18mm horizontal margins in @page rule'
  );
});

test('excel export consistency: exportExcel must configure dashboard sheets, auto col widths, and hyperlinks', () => {
  const exportersJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'exporters.js'), 'utf8');

  assert.ok(
    exportersJs.includes('calculateColWidths'),
    'exporters.js must include calculateColWidths helper for dynamic column width fitting'
  );
  assert.ok(
    exportersJs.includes('enhanceWorksheet'),
    'exporters.js must include enhanceWorksheet for wrapText, alignment and hyperlinks'
  );
  assert.ok(
    exportersJs.includes("'エグゼクティブサマリー'"),
    'exporters.js must include Executive Summary dashboard sheet as primary tab'
  );
  assert.ok(
    exportersJs.includes("wsSummary['!cols']"),
    'exporters.js must specify !cols on summary sheet'
  );
  assert.ok(
    exportersJs.includes('Target: cell.v'),
    'exporters.js must attach hyperlinked Target on source URL cells'
  );
});

test('mobile responsiveness consistency: style dropdown and chips must fit small mobile screens without clipping or overflow', () => {
  const stylesCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

  assert.ok(
    stylesCss.includes('.style-dropdown-menu {\n    min-width: 0 !important;'),
    'styles.css must unconstrain dropdown min-width on small screens to prevent clipping on 360px mobile viewports'
  );
  assert.ok(
    stylesCss.includes('.btn-style-selector {\n    width: 100%;'),
    'styles.css must expand style selector button to full width on mobile for better touch targets'
  );
});

test('svg chart consistency: Pure SVG chart engine, vector PDF embedding, and styles exist', () => {
  const chartsJsPath = path.join(ROOT, 'public', 'js', 'modules', 'charts.js');
  assert.ok(fs.existsSync(chartsJsPath), 'public/js/modules/charts.js must exist');
  const chartsJs = fs.readFileSync(chartsJsPath, 'utf8');
  assert.ok(chartsJs.includes('export function renderSvgChart'), 'charts.js must export renderSvgChart function');
  assert.ok(chartsJs.includes('renderBarChart'), 'charts.js must support bar charts');
  assert.ok(chartsJs.includes('renderRadarChart'), 'charts.js must support radar charts');

  const renderJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'render.js'), 'utf8');
  assert.ok(renderJs.includes("import { renderSvgChart } from './modules/charts.js';"), 'render.js must import renderSvgChart');
  assert.ok(renderJs.includes('renderSvgChart(data.chart)'), 'render.js must invoke renderSvgChart on data.chart');

  const exportersJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'exporters.js'), 'utf8');
  assert.ok(exportersJs.includes("import { renderSvgChart } from './modules/charts.js';"), 'exporters.js must import renderSvgChart');
  assert.ok(exportersJs.includes('pr-chart-wrap'), 'exporters.js must wrap chart in pr-chart-wrap for vector PDF');

  const printCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'print.css'), 'utf8');
  assert.ok(printCss.includes('.pr-chart-wrap'), 'print.css must define .pr-chart-wrap vector print rules');
});

test('whitelabel brand settings consistency: publisher tagline, author, confidentiality, and disclaimer integrated', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="publisher-tagline"'), 'index.html must have publisher-tagline input');
  assert.ok(html.includes('id="publisher-author"'), 'index.html must have publisher-author input');
  assert.ok(html.includes('id="publisher-confidentiality"'), 'index.html must have publisher-confidentiality input');
  assert.ok(html.includes('id="publisher-disclaimer"'), 'index.html must have publisher-disclaimer textarea or input');

  const settingsJs = fs.readFileSync(path.join(ROOT, 'server', 'settings.js'), 'utf8');
  assert.ok(settingsJs.includes('publisherTagline'), 'settings.js must support publisherTagline');
  assert.ok(settingsJs.includes('author'), 'settings.js must support author');
  assert.ok(settingsJs.includes('confidentiality'), 'settings.js must support confidentiality');
  assert.ok(settingsJs.includes('disclaimer'), 'settings.js must support disclaimer');

  const exportersJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'exporters.js'), 'utf8');
  assert.ok(exportersJs.includes('publisherTagline'), 'exporters.js must reflect publisherTagline in exports');
  assert.ok(exportersJs.includes('confidentiality'), 'exporters.js must reflect confidentiality in exports');
  assert.ok(exportersJs.includes('disclaimer'), 'exporters.js must reflect disclaimer in exports');
});

test('url direct analysis mode consistency: UI badge and pipeline optimization exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="url-mode-badge"'), 'index.html must include url-mode-badge');

  const researchJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'research.js'), 'utf8');
  assert.ok(researchJs.includes('syncUrlBadge'), 'research.js must have syncUrlBadge for URL detection');

  const pipelineJs = fs.readFileSync(path.join(ROOT, 'server', 'pipeline.js'), 'utf8');
  assert.ok(pipelineJs.includes('特定URLダイレクト分析モード'), 'pipeline.js must support URL direct analysis mode in query planning');
});

test('v1.5.0 AppData persistence, history pin, and version check consistency', () => {
  const settingsJs = fs.readFileSync(path.join(ROOT, 'server', 'settings.js'), 'utf8');
  assert.ok(settingsJs.includes('resolveDataDir'), 'settings.js must implement resolveDataDir for user-level persistence');

  const historyJs = fs.readFileSync(path.join(ROOT, 'server', 'history.js'), 'utf8');
  assert.ok(historyJs.includes('togglePin'), 'history.js must implement togglePin');
  assert.ok(historyJs.includes('function update('), 'history.js must implement update for inline edited reports');
  assert.ok(historyJs.includes('pinned'), 'history.js must handle pinned status in sorting');

  const serverIndexJs = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  assert.ok(serverIndexJs.includes('/api/history/:id/pin'), 'server/index.js must have /api/history/:id/pin endpoint');
  assert.ok(serverIndexJs.includes("app.put('/api/history/:id'"), 'server/index.js must have PUT /api/history/:id endpoint');
  assert.ok(serverIndexJs.includes('/api/version/check'), 'server/index.js must have /api/version/check endpoint');
});

test('v1.5.0 inline direct editor, presets, and update notification banner consistency', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-toggle-edit"'), 'index.html must have btn-toggle-edit button');
  assert.ok(html.includes('id="research-presets-bar"'), 'index.html must have research-presets-bar');
  assert.ok(html.includes('id="version-update-banner"'), 'index.html must have version-update-banner');

  const editorJsPath = path.join(ROOT, 'public', 'js', 'modules', 'editor.js');
  assert.ok(fs.existsSync(editorJsPath), 'public/js/modules/editor.js must exist');
  const editorJs = fs.readFileSync(editorJsPath, 'utf8');
  assert.ok(editorJs.includes('bindReportEditor'), 'editor.js must export bindReportEditor');
  assert.ok(editorJs.includes('resetEditMode'), 'editor.js must export resetEditMode');

  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');
  assert.ok(css.includes('.is-editable-mode'), 'styles.css must have .is-editable-mode style');
  assert.ok(css.includes('.research-presets-bar'), 'styles.css must have .research-presets-bar style');
  assert.ok(css.includes('.version-update-banner'), 'styles.css must have .version-update-banner style');
  assert.ok(css.includes('.btn-pin-hi'), 'styles.css must have .btn-pin-hi style');
});

test('api key guide and GitHub support consistency: modal, topbar button, and contact links exist', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-guide"'), 'index.html must have btn-guide button in topbar');
  assert.ok(html.includes('id="modal-api-guide"'), 'index.html must have modal-api-guide modal');
  assert.ok(html.includes('id="btn-open-guide-from-settings"'), 'index.html must have btn-open-guide-from-settings button');
  assert.ok(
    html.includes('https://github.com/yuuki16dev/research_system/issues'),
    'index.html must have direct link to user GitHub issues for support'
  );

  const modalsJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'modules', 'modals.js'), 'utf8');
  assert.ok(modalsJs.includes('bindApiGuideModal'), 'modals.js must export bindApiGuideModal');

  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  assert.ok(appJs.includes('bindApiGuideModal'), 'app.js must import and call bindApiGuideModal');

  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');
  assert.ok(css.includes('.api-guide-quick-card'), 'styles.css must style .api-guide-quick-card');
  assert.ok(css.includes('.guide-github-card'), 'styles.css must style .guide-github-card');
});





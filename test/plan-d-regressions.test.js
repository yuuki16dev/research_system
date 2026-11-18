'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  sanitizeReportPatch,
  buildMarkdown,
  ensureAbortSignalAny,
} = require('../server/util');
const { renderTemplateHtml } = require('../server/template-engine');
const { createJob } = require('../server/jobs');
const { recordGemini, getFullUsageSummary } = require('../server/usage');
const { DATA_DIR } = require('../server/settings');
const { runDeltaTracking } = require('../server/pipeline');
const { generateCommercialExcel } = require('../server/excel-commercial');

test('util: sanitizeReportPatch keeps allowlisted editable fields and strips protected fields', () => {
  const sanitized = sanitizeReportPatch({
    id: 'forged-id',
    user_id: 'forged-user',
    share_enabled: true,
    share_token: 'forged-token',
    title: 'Updated Title',
    summary: 'Updated Summary',
    metrics: [{ label: 'ROI', value: '120%' }],
  });

  assert.equal(sanitized.id, undefined);
  assert.equal(sanitized.user_id, undefined);
  assert.equal(sanitized.share_enabled, undefined);
  assert.equal(sanitized.share_token, undefined);
  assert.equal(sanitized.title, 'Updated Title');
  assert.equal(sanitized.summary, 'Updated Summary');
  assert.deepEqual(sanitized.metrics, [{ label: 'ROI', value: '120%' }]);
});

test('util: buildMarkdown escapes table pipes/newlines and blocks non-http(s) URLs', () => {
  const md = buildMarkdown({
    theme: 'Pipe | Theme\nLine2',
    title: 'Safe Report',
    createdAt: '2026-01-01T00:00:00.000Z',
    table: {
      columns: ['Col | A', 'Col B'],
      rows: [['Val | 1\nNext', 'Val (2)']],
    },
    sources: [
      { index: 1, title: 'Bad Link', url: 'javascript:alert(1)', domain: 'bad.example', score: 10 },
      { index: 2, title: 'Parens [Link]', url: 'https://example.com/a(b)', domain: 'example.com', score: 90 },
    ],
  });

  assert.ok(md.includes('Pipe \\| Theme Line2'));
  assert.ok(md.includes('Val \\| 1 Next'));
  assert.equal(md.includes('javascript:alert(1)'), false);
  assert.ok(md.includes('https://example.com/a%28b%29'));
});

test('util: ensureAbortSignalAny produces a signal aborted when any source aborts', () => {
  ensureAbortSignalAny();
  const c1 = new AbortController();
  const c2 = new AbortController();
  const combined = AbortSignal.any([c1.signal, c2.signal]);
  assert.equal(combined.aborted, false);
  c2.abort(new Error('stop'));
  assert.equal(combined.aborted, true);
});

test('template-engine: renderTemplateHtml preserves $1, $&, and numeric zero values', () => {
  const html = renderTemplateHtml('slides', {
    title: 'Revenue $1 & $& Growth',
    theme: 'Pricing $10',
    metrics: [{ label: 'ZeroMetric', value: 0 }],
    summary: 'Target 0 churn with $1 per unit ($& check).',
  });

  assert.ok(html.includes('Revenue $1 & $& Growth'));
  assert.ok(html.includes('ZeroMetric'));
  assert.ok(html.includes('"value":0') || html.includes('"value":"0"'));
});

test('jobs: cancelled job never runs onResult or emits result event', async () => {
  let onResultCalled = false;
  let settledStatus = null;
  const events = [];

  await new Promise((resolve) => {
    const job = createJob(
      { theme: 'cancel-race' },
      async (j) => {
        j.controller.abort();
        j.status = 'cancelled';
        return { title: 'Should be discarded' };
      },
      {
        onResult: async () => {
          onResultCalled = true;
        },
        onSettled: async (status) => {
          settledStatus = status;
        },
      }
    );

    job.emitter.on('event', (evt) => {
      events.push(evt);
      if (evt.type === 'end') resolve();
    });
  });

  assert.equal(onResultCalled, false);
  assert.equal(settledStatus, 'cancelled');
  assert.equal(events.some((e) => e.type === 'result'), false);
  assert.ok(events.some((e) => e.type === 'error' && e.message.includes('キャンセル')));
});

test('usage: recordGemini accumulates per-call model cost and getFullUsageSummary uses dynamic model pricing', async () => {
  const usageFile = path.join(DATA_DIR, 'usage.json');
  const hadFile = fs.existsSync(usageFile);
  const originalContent = hadFile ? fs.readFileSync(usageFile, 'utf8') : null;

  try {
    if (hadFile) fs.unlinkSync(usageFile);

    recordGemini({
      model: 'gemini-3.8-flash',
      promptTokens: 1_000_000,
      candidatesTokens: 0,
      totalTokens: 1_000_000,
    });
    const afterSecond = recordGemini({
      model: 'gemini-3.1-flash-lite',
      promptTokens: 1_000_000,
      candidatesTokens: 0,
      totalTokens: 1_000_000,
    });

    // 0.075 + 0.0375 = 0.1125 USD
    assert.ok(Math.abs(afterSecond.gemini.estimatedCostUsd - 0.1125) < 1e-6);

    const summary = await getFullUsageSummary(
      { geminiModel: 'gemini-3.1-flash-lite' },
      { fetchFn: async () => ({ ok: false, status: 500 }) }
    );
    assert.equal(summary.gemini.model, 'gemini-3.1-flash-lite');
    assert.ok(summary.gemini.quotas.pricing.includes('$0.0375'));
    assert.ok(summary.gemini.quotas.pricing.includes('$0.15'));
  } finally {
    if (hadFile && originalContent !== null) {
      fs.writeFileSync(usageFile, originalContent, 'utf8');
    } else if (fs.existsSync(usageFile)) {
      fs.unlinkSync(usageFile);
    }
  }
});

test('pipeline: runDeltaTracking works in mock mode without crashing on search runner', async () => {
  const events = [];
  const res = await runDeltaTracking(
    {
      params: {
        baseReport: { id: 'rep-1', theme: 'クラウド移行', createdAt: '2026-01-01T00:00:00.000Z' },
        forceMock: true,
      },
      controller: new AbortController(),
      emit: (e) => events.push(e),
    },
    { mode: 'mock', geminiApiKey: '' }
  );

  assert.ok(res);
  assert.ok(typeof res.title === 'string' && res.title.length > 0);
  assert.ok(events.some((e) => e.type === 'progress' && e.value === 100));
});

test('excel-commercial: preserves meta fields and clamps overly long cell strings cleanly', async () => {
  const longText = 'X'.repeat(33000);
  const wb = await generateCommercialExcel({
    meta: {
      title: 'Meta Excel Title',
      theme: 'Excel Regression',
      publisher: 'Meta Publisher Inc.',
      score: 88,
      date: '2026-02-01T00:00:00.000Z',
    },
    summary: { conclusion: longText },
    table: {
      columns: ['Item', 'Note'],
      rows: [['Alpha', longText]],
    },
    sources: [{ index: 1, title: 'Src', url: 'https://example.com', domain: 'example.com', score: 88 }],
  });

  const allText = [];
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const v = cell.value && cell.value.richText
          ? cell.value.richText.map((r) => r.text).join('')
          : String(cell.value ?? '');
        if (v.length > 32767) {
          assert.fail(`Cell ${cell.address} on ${ws.name} exceeded Excel 32767 char limit (${v.length})`);
        }
        allText.push(v);
      });
    });
  });

  const joined = allText.join('\n');
  assert.ok(joined.includes('Meta Excel Title'));
  assert.ok(joined.includes('Meta Publisher Inc.'));
});

test('frontend: charts & exporters modules run cleanly and fix SVG gradient collisions / analystNote objects', async () => {
  const { renderSvgChart } = await import('../public/js/modules/charts.js');
  const { buildClaudePrompt, buildMarkdown: clientBuildMarkdown } = await import('../public/js/exporters.js');

  const chartData = {
    type: 'bar',
    labels: ['Q1', 'Q2'],
    datasets: [{ label: 'Revenue', data: [10] }, { data: [20, 30] }],
  };
  const svg1 = renderSvgChart(chartData, { theme: { primary: '#123456', accent: '#654321' } });
  const svg2 = renderSvgChart(chartData);

  const id1 = svg1.match(/id="(barGrad_[^"]+)"/)?.[1];
  const id2 = svg2.match(/id="(barGrad_[^"]+)"/)?.[1];
  assert.ok(id1 && id2);
  assert.notEqual(id1, id2);
  assert.ok(svg1.includes('#123456'));

  const structuredReport = {
    theme: 'B2B SaaS',
    title: 'Test',
    summary: 'Summary line',
    deepThinking: {
      analystNote: {
        coreHypothesis: 'Core Hypothesis Here',
        criticalQuestions: ['Question One?'],
      },
    },
  };
  const prompt = buildClaudePrompt(structuredReport, 'article');
  const md = clientBuildMarkdown(structuredReport);
  assert.ok(prompt.includes('Core Hypothesis Here'));
  assert.ok(md.includes('Core Hypothesis Here'));
  assert.equal(prompt.includes('[object Object]'), false);
  assert.equal(md.includes('[object Object]'), false);

  const apiSrc = fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8');
  assert.equal(apiSrc.includes('api.getHistory'), false);
  assert.equal(apiSrc.includes('api.getHistoryItem'), false);
  assert.ok(apiSrc.includes('api.history(') || apiSrc.includes('api.history()'));

  const handlersSrc = fs.readFileSync(path.join(__dirname, '../public/js/modules/export-handlers.js'), 'utf8');
  const zoomFnIdx = handlersSrc.indexOf('function updateZoom(');
  const openPdfIdx = handlersSrc.indexOf('export function openPdfPreview(');
  assert.ok(zoomFnIdx !== -1 && openPdfIdx !== -1 && zoomFnIdx < openPdfIdx);
});

test('release-helper: validates SemVer tags, extracts CHANGELOG notes with fallback, and generates SHA256SUMS', () => {
  const os = require('os');
  const {
    resolveAndValidateReleaseTag,
    extractChangelogSection,
    buildReleaseNotes,
    generateSha256Sums,
  } = require('../scripts/release-helper');

  assert.deepEqual(
    resolveAndValidateReleaseTag({ inputTag: '', ref: 'refs/tags/v2.19.0', refName: 'v2.19.0', pkgVersion: '2.19.0' }),
    { tag: 'v2.19.0', version: '2.19.0' }
  );
  assert.deepEqual(
    resolveAndValidateReleaseTag({ inputTag: '', ref: 'refs/heads/main', refName: 'main', pkgVersion: '2.19.0' }),
    { tag: 'v2.19.0', version: '2.19.0' }
  );
  assert.throws(
    () => resolveAndValidateReleaseTag({ inputTag: '2.19.0', pkgVersion: '2.19.0' }),
    /不正なリリースタグ形式/
  );
  assert.throws(
    () => resolveAndValidateReleaseTag({ inputTag: 'v2.20.0', pkgVersion: '2.19.0' }),
    /一致しません/
  );

  const sampleChangelog = `# CHANGELOG\n\n## [v2.19.0] - 2026-11-15\n### ハイライト\n- 機能Aを追加\n\n## [v2.18.0] - 2026-11-14\n- 旧機能\n`;
  const extracted = extractChangelogSection(sampleChangelog, 'v2.19.0');
  assert.ok(extracted && extracted.includes('機能Aを追加'));
  assert.equal(extracted.includes('旧機能'), false);
  assert.equal(extractChangelogSection(sampleChangelog, 'v9.9.9'), null);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-release-test-'));
  try {
    const changelogFile = path.join(tmpDir, 'CHANGELOG.md');
    const notesOut = path.join(tmpDir, 'release-notes.md');
    const assetA = path.join(tmpDir, 'ResearchStudio.exe');
    const sumOut = path.join(tmpDir, 'SHA256SUMS.txt');

    fs.writeFileSync(changelogFile, sampleChangelog, 'utf8');
    fs.writeFileSync(assetA, 'dummy-binary-payload', 'utf8');

    const hit = buildReleaseNotes({ tag: 'v2.19.0', changelogPath: changelogFile, outPath: notesOut });
    assert.equal(hit.found, true);
    assert.ok(fs.readFileSync(notesOut, 'utf8').includes('機能Aを追加'));

    const miss = buildReleaseNotes({ tag: 'v2.99.0', changelogPath: changelogFile, outPath: notesOut });
    assert.equal(miss.found, false);
    assert.ok(fs.readFileSync(notesOut, 'utf8').includes('自動生成ノートを併用します'));

    const sumLines = generateSha256Sums({ files: [assetA], outPath: sumOut });
    assert.equal(sumLines.length, 1);
    assert.match(sumLines[0], /^[0-9a-f]{64}  ResearchStudio\.exe$/);
    assert.throws(() => generateSha256Sums({ files: [path.join(tmpDir, 'missing.exe')], outPath: sumOut }), /見つかりません/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

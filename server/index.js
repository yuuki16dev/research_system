'use strict';

const logger = require('./logger');
logger.initLogger();

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// Node.js 18.x 互換用 AbortSignal.any ポリフィル
if (typeof AbortSignal.any !== 'function') {
  AbortSignal.any = function (signals) {
    const controller = new AbortController();
    for (const signal of signals) {
      if (!signal) continue;
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  };
}


const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');

const settings = require('./settings');
const history = require('./history');
const memory = require('./memory');
const { createJob, getJob } = require('./jobs');
const { runResearch } = require('./pipeline');
const { generate } = require('./gemini');
const { tavilySearch } = require('./search');
const deepdive = require('./deepdive');
const pdf = require('./pdf');
const excel = require('./excel');
const presentation = require('./presentation');
const { getFullUsageSummary } = require('./usage');


const PORT = Number(process.env.PORT) || 3939;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

// 自動シャットダウン用タイマー（全ブラウザ切断時）
let autoShutdownTimer = null;

// 通常のアクセスがあった場合は自動終了タイマーをキャンセル
app.use((req, res, next) => {
  if (req.path !== '/api/lifecycle/leave' && autoShutdownTimer) {
    clearTimeout(autoShutdownTimer);
    autoShutdownTimer = null;
  }
  next();
});

// リアルタイム HTTP リクエストログ（静的ファイル等はスキップ）
app.use((req, res, next) => {
  if (
    req.path === '/api/info' ||
    req.path === '/api/logs' ||
    req.path === '/api/lifecycle/leave' ||
    req.path.startsWith('/vendor') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.svg') ||
    req.path.endsWith('.ico')
  ) {
    return next();
  }
  const t0 = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - t0;
    console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${elapsed}ms)`);
  });
  next();
});

/* ------------------------------------------------------------- static */
app.use('/vendor', express.static(path.join(ROOT, 'node_modules', 'xlsx', 'dist')));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/* --------------------------------------------------------------- info */
let currentPort = PORT;

let pkgVer = '1.11.0';
try {
  pkgVer = require('../package.json').version || pkgVer;
} catch {}

function compareSemver(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

let versionCache = { checkedAt: 0, latest: null };

function lanAddresses(port = currentPort) {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, url: `http://${a.address}:${port}` });
    }
  }
  // 一般的な家庭LAN（192.168.x.x）を優先
  return out.sort((a, b) => Number(!a.address.startsWith('192.168.')) - Number(!b.address.startsWith('192.168.')));
}

app.get('/api/info', (req, res) => {
  res.json({ app: 'Research Studio', version: pkgVer, port: currentPort, lan: lanAddresses(currentPort), settings: settings.publicView() });
});

app.get('/api/version/check', async (req, res) => {
  const current = pkgVer;
  const now = Date.now();
  if (versionCache.latest && now - versionCache.checkedAt < 3600000) {
    return res.json({ current, ...versionCache.latest });
  }

  try {
    const fetchRes = await fetch('https://api.github.com/repos/yuuki16dev/research_system/releases/latest', {
      headers: { 'User-Agent': 'ResearchStudio-App' },
      signal: AbortSignal.timeout(3500),
    });
    if (!fetchRes.ok) {
      return res.json({ current, hasUpdate: false });
    }
    const data = await fetchRes.json();
    const tagName = String(data.tag_name || '').replace(/^v/, '');
    const hasUpdate = tagName && tagName !== current && compareSemver(tagName, current) > 0;
    versionCache = {
      checkedAt: now,
      latest: {
        hasUpdate,
        latestVersion: tagName,
        releaseUrl: data.html_url || 'https://github.com/yuuki16dev/research_system/releases',
        releaseName: data.name || '',
      },
    };
    res.json({ current, ...versionCache.latest });
  } catch {
    res.json({ current, hasUpdate: false });
  }
});

function parseChangelog(content, currentVer) {
  const releases = [];
  const lines = String(content || '').split(/\r?\n/);
  let currentRelease = null;
  let currentCategory = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // ## [v1.6.0] - 2026-10-23 または ## [1.6.0] - 2026-10-23
    const releaseMatch = line.match(/^##\s+\[v?([0-9.]+)\](?:\s*-\s*([0-9-]+))?/);
    if (releaseMatch) {
      if (currentRelease) {
        if (currentCategory) currentRelease.categories.push(currentCategory);
        releases.push(currentRelease);
      }
      const ver = releaseMatch[1];
      const date = releaseMatch[2] || '';
      currentRelease = {
        version: `v${ver}`,
        rawVersion: ver,
        date,
        isCurrent: ver === String(currentVer).replace(/^v/, ''),
        categories: [],
      };
      currentCategory = null;
      continue;
    }

    if (!currentRelease) continue;

    // ### 📊 見出し
    const catMatch = line.match(/^###\s+(.+)$/);
    if (catMatch) {
      if (currentCategory) currentRelease.categories.push(currentCategory);
      currentCategory = {
        title: catMatch[1].trim(),
        items: [],
      };
      continue;
    }

    // 箇条書き項目: - **...**: ... または - ...
    if (currentCategory && line.startsWith('- ')) {
      currentCategory.items.push(line.replace(/^-\s+/, ''));
    }
  }

  if (currentRelease) {
    if (currentCategory) currentRelease.categories.push(currentCategory);
    releases.push(currentRelease);
  }

  return releases;
}

app.get('/api/changelog', (req, res) => {
  try {
    const changelogPath = path.join(ROOT, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) {
      return res.status(404).json({ error: 'CHANGELOG.md not found' });
    }
    const rawContent = fs.readFileSync(changelogPath, 'utf8');
    const releases = parseChangelog(rawContent, pkgVer);
    res.json({
      app: 'Research Studio',
      currentVersion: pkgVer,
      totalReleases: releases.length,
      releases,
    });
  } catch (err) {
    logger.error('Failed to parse CHANGELOG.md', err);
    res.status(500).json({ error: 'Failed to read changelog', message: err.message });
  }
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f1e', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------------------------------------------------------- lifecycle & shutdown */
app.all('/api/lifecycle/leave', (req, res) => {
  // ブラウザが閉じられた瞬間の通知。5秒の猶予期間をおいて他タブ・再読み込みがなければ自動終了
  if (!autoShutdownTimer && process.env.NODE_ENV !== 'test') {
    autoShutdownTimer = setTimeout(() => {
      console.log('\n[自動終了] すべてのブラウザ画面が閉じられたため、Research Studio を安全に終了します...');
      process.exit(0);
    }, 5000);
  }
  res.json({ ok: true });
});

app.post('/api/shutdown', (req, res) => {
  console.log('\n[手動終了] WebUI よりシャットダウン指示を受信しました。サーバーを正常停止します...');
  res.json({ ok: true, message: 'Research Studio is shutting down' });
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => {
      process.exit(0);
    }, 400);
  }
});

/* ----------------------------------------------------------- settings */
app.get('/api/settings', (req, res) => res.json(settings.publicView()));

app.put('/api/settings', (req, res) => {
  const s = settings.save(req.body || {});
  res.json(settings.publicView(s));
});

/** 接続テスト。body にキーが含まれていればそれを、なければ保存済みのキーを使う */
app.post('/api/settings/test', async (req, res) => {
  const cur = settings.load();
  const body = req.body || {};
  const geminiKey = body.geminiApiKey || cur.geminiApiKey;
  const tavilyKey = body.tavilyApiKey || cur.tavilyApiKey;
  const model = body.geminiModel || cur.geminiModel;
  const out = {};

  if (geminiKey) {
    try {
      const t0 = Date.now();
      await generate({ apiKey: geminiKey, model, prompt: 'Reply with the single word: OK', json: false, temperature: 0, signal: AbortSignal.timeout(20000) });
      out.gemini = { ok: true, message: `接続OK（${model} / ${Date.now() - t0}ms）` };
    } catch (e) {
      out.gemini = { ok: false, message: e.message };
    }
  } else out.gemini = { ok: false, message: 'APIキー未設定' };

  if (tavilyKey) {
    try {
      const r = await tavilySearch({ apiKey: tavilyKey, query: 'Research Studio test', maxResults: 1, signal: AbortSignal.timeout(20000) });
      out.tavily = { ok: true, message: `接続OK（${r.length}件取得）` };
    } catch (e) {
      out.tavily = { ok: false, message: e.message };
    }
  } else out.tavily = { ok: false, message: 'APIキー未設定（DuckDuckGoを使用）' };

  res.json(out);
});

/* ------------------------------------------------------------- usage */
app.get('/api/usage', async (req, res) => {
  try {
    const data = await getFullUsageSummary(settings.load());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ----------------------------------------------------------- research */
app.post('/api/research', (req, res) => {
  const b = req.body || {};
  const theme = String(b.theme || '').trim().slice(0, 300);
  const scope = ['web', 'sns', 'sites'].includes(b.scope) ? b.scope : 'web';
  const depth = ['quick', 'deep'].includes(b.depth) ? b.depth : 'quick';
  const period = ['year', 'month', '3years', 'all', 'custom'].includes(b.period) ? b.period : 'year';
  const validPurposes = ['business', 'tech', 'brief', 'decision', 'academic', 'custom', 'general', 'compare', 'tool', 'risk', 'trend'];
  const purpose = validPurposes.includes(b.purpose) ? b.purpose : 'business';
  const customPurpose = String(b.customPurpose || '').trim().slice(0, 500);
  const customPeriod = String(b.customPeriod || '').trim().slice(0, 100);
  const sites = String(b.sites || '').slice(0, 300);
  const referenceContext = String(b.referenceContext || '').trim().slice(0, 3000);
  if (theme.length < 2) return res.status(400).json({ error: 'テーマを2文字以上で入力してください' });

  console.log(`[リサーチ受付] テーマ: "${theme}" (スコープ: ${scope}, 深度: ${depth}, スタイル: ${purpose})`);
  const params = { theme, scope, depth, sites, period, customPeriod, purpose, customPurpose, referenceContext, forceMock: !!b.forceMock };
  const job = createJob(params, (j) => runResearch(j, settings.load()), {
    onResult: (result) => {
      history.save(result);
      try {
        memory.learnFromResearch(result);
      } catch (err) {
        console.error('[memory] learn error:', err.message);
      }
    },
  });
  res.status(202).json({ jobId: job.id });
});

app.get('/api/research/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ジョブが見つかりません（期限切れの可能性があります）' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  job.events.forEach(send);
  if (job.status !== 'running') return res.end();

  const onEvent = (e) => {
    send(e);
    if (e.type === 'end' || e.type === 'error') cleanup(true);
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  function cleanup(end) {
    clearInterval(heartbeat);
    job.emitter.off('event', onEvent);
    if (end) res.end();
  }
  job.emitter.on('event', onEvent);
  req.on('close', () => cleanup(false));
});

app.post('/api/research/:id/cancel', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  job.controller.abort();
  res.json({ ok: true });
});

app.post('/api/research/deep-dive', async (req, res) => {
  const { theme, question, reportContext, period, quote } = req.body || {};
  if (!theme || !question) return res.status(400).json({ error: 'theme と question は必須です' });
  console.log(`[深掘り対話] 質問: "${question.slice(0, 35)}..." を受信`);
  try {
    const result = await deepdive.runDeepDive({ theme, question, reportContext, period, quote });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || '深掘り調査に失敗しました' });
  }
});

/* ------------------------------------------------------------- PDF export */
app.post('/api/export/pdf', async (req, res) => {
  const { html, filename, orientation } = req.body || {};
  if (!html) return res.status(400).json({ error: 'html は必須です' });
  console.log(`[PDF出力] ファイル名: "${filename || 'Research_Report.pdf'}" (${orientation || 'auto'}) の生成開始`);

  try {
    const pdfPath = await pdf.generatePdfFromHtml(html, { orientation });
    const safeName = encodeURIComponent((filename || 'Research_Report.pdf').replace(/[\\/:*?"<>|\r\n]+/g, '_'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    res.sendFile(pdfPath, (err) => {
      try {
        const fs = require('fs');
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      } catch {}
    });
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message || 'PDFの生成に失敗しました' });
  }
});

/* ----------------------------------------------------------- Excel export */
app.post('/api/export/excel', async (req, res) => {
  const { data, brand, filename } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data は必須です' });

  try {
    const buffer = await excel.generateExcelReport(data, brand || {});
    const safeName = encodeURIComponent((filename || 'Research_Report.xlsx').replace(/[\\/:*?"<>|\r\n]+/g, '_'));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    res.send(buffer);
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message || 'Excelの生成に失敗しました' });
  }
});

/* ---------------------------------------------------- presentation studio */
app.post('/api/presentation/prompt', (req, res) => {
  const { document, audience, goal, files } = req.body || {};
  try {
    const prompt = presentation.generatePrompt({ document, audience, goal, files });
    res.json({ prompt });
  } catch (err) {
    res.status(400).json({ error: err.message || 'プロンプト生成に失敗しました' });
  }
});

app.post('/api/presentation/generate', async (req, res) => {
  const { document, audience, goal, files } = req.body || {};
  const hasDoc = document && document.trim();
  const hasFiles = Array.isArray(files) && files.length > 0;

  if (!hasDoc && !hasFiles) {
    return res.status(400).json({ error: '企画書・資料のテキストを入力するか、ファイルを添付してください' });
  }

  try {
    const slidesData = await presentation.generateSlides({ document, audience, goal, files });
    res.json(slidesData);
  } catch (err) {
    console.error('Presentation generate error:', err);
    res.status(500).json({ error: err.message || 'スライドの生成に失敗しました' });
  }
});

/* ------------------------------------------------------------ history */
app.get('/api/history', (req, res) => res.json(history.list()));
app.get('/api/history/:id', (req, res) => {
  const r = history.get(req.params.id);
  return r ? res.json(r) : res.status(404).json({ error: 'not found' });
});
app.patch('/api/history/:id', (req, res) => {
  const updated = history.update(req.params.id, req.body || {});
  return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
});
app.put('/api/history/:id', (req, res) => {
  const updated = history.update(req.params.id, req.body || {});
  return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
});
app.post('/api/history/:id/pin', (req, res) => {
  const updated = history.togglePin(req.params.id);
  return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
});
app.delete('/api/history/:id', (req, res) => res.json({ ok: history.remove(req.params.id) }));

/* ------------------------------------------------------------- memory */
app.get('/api/memory', (req, res) => res.json(memory.load()));
app.delete('/api/memory/:domain', (req, res) => res.json({ ok: memory.remove(req.params.domain) }));
app.post('/api/memory/clear', (req, res) => res.json({ ok: memory.clear() }));

/* --------------------------------------------------------------- logs */
app.get('/api/logs', (req, res) => {
  res.json({
    logsDir: logger.LOGS_DIR,
    errorLogFile: logger.ERROR_LOG,
    recentErrors: logger.getRecentErrorLog(100),
    liveLogs: logger.getRecentLiveLogs(50),
  });
});

/* -------------------------------------------------------------- errors */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

function openBrowser(url) {
  try {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  } catch {}
}

/** 該当ポートで動いているのが Research Studio か確認 */
async function checkIsResearchStudio(port) {
  const hosts = ['127.0.0.1', 'localhost'];
  for (const h of hosts) {
    try {
      const res = await fetch(`http://${h}:${port}/api/info`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.app === 'Research Studio') return true;
      }
    } catch {}
  }
  return false;
}

function startServer(port, host, retries = 5) {
  const server = app.listen(port, host, () => {
    currentPort = port;
    const s = settings.publicView();

    const line = '─'.repeat(56);
    console.log(`\n${line}\n  ◆ Research Studio  v${pkgVer}\n${line}`);
    console.log(`  ローカル     : http://localhost:${port}`);
    lanAddresses(port).forEach((a) => console.log(`  スマホ (LAN) : http://${a.address}:${port}   [${a.name}]`));
    console.log(`  モード       : ${s.effectiveMode === 'live' ? 'LIVE (Gemini)' : 'DEMO (モックデータ)'}`);
    console.log(`  検索         : ${s.effectiveSearch}`);
    console.log(`  ログ保存先   : ${logger.LOGS_DIR}`);
    console.log(`${line}`);
    console.log(`  ★ 終了方法: [Ctrl + C] を押すか、このウィンドウを閉じてください`);
    console.log(`  ★ 停止用バッチ: stop.bat をダブルクリックでも停止できます`);
    console.log(`${line}\n`);

    if (process.pkg || process.env.AUTO_OPEN === '1') {
      openBrowser(`http://localhost:${port}`);
    }
  });

  server.on('error', async (err) => {
    // @ts-ignore
    if (err.code === 'EADDRINUSE') {
      // すでに自アプリ（Research Studio）が動いている場合は既存画面を開いて二重起動を防止
      const isOurApp = await checkIsResearchStudio(port);
      if (isOurApp) {
        console.log(`\n${'═'.repeat(56)}`);
        console.log(`  [情報] Research Studio はすでに起動しています (ポート: ${port})`);
        console.log(`  既存のブラウザ画面を開きます: http://localhost:${port}`);
        console.log(`${'═'.repeat(56)}\n`);
        openBrowser(`http://localhost:${port}`);
        process.exit(0);
      }

      console.error(`\n[エラー] ポート ${port} は使用中です。Research Studio は単一インスタンス（ポート ${port}）で動作します。`);
      console.error(`既存のプロセスを停止して再起動するには stop.bat を実行してください。\n`);
      process.exit(1);
    }
    console.error('[致命的エラー] サーバーの起動に失敗しました:', err);
    process.exit(1);
  });
}

async function bootstrap() {
  // 二重起動ガード: すでに起動中であれば重複起動せず既存ブラウザ画面を開いて終了
  const alreadyRunning = await checkIsResearchStudio(PORT);
  if (alreadyRunning) {
    console.log(`\n${'═'.repeat(56)}`);
    console.log(`  [情報] Research Studio はすでに起動しています (ポート: ${PORT})`);
    console.log(`  既存のブラウザ画面を開きます: http://localhost:${PORT}`);
    console.log(`${'═'.repeat(56)}\n`);
    openBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }

  startServer(PORT, HOST);
}

bootstrap();

module.exports = { app, parseChangelog };

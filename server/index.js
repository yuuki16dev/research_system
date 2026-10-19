'use strict';

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

const PORT = Number(process.env.PORT) || 3939;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

/* ------------------------------------------------------------- static */
app.use('/vendor', express.static(path.join(ROOT, 'node_modules', 'xlsx', 'dist')));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/* --------------------------------------------------------------- info */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, url: `http://${a.address}:${PORT}` });
    }
  }
  // 一般的な家庭LAN（192.168.x.x）を優先
  return out.sort((a, b) => Number(!a.address.startsWith('192.168.')) - Number(!b.address.startsWith('192.168.')));
}

app.get('/api/info', (req, res) => {
  res.json({ app: 'Research Studio', version: '0.1.0', port: PORT, lan: lanAddresses(), settings: settings.publicView() });
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
  const purpose = ['general', 'compare', 'business', 'tool', 'risk', 'trend'].includes(b.purpose) ? b.purpose : 'general';
  const customPeriod = String(b.customPeriod || '').trim().slice(0, 100);
  const sites = String(b.sites || '').slice(0, 300);
  const referenceContext = String(b.referenceContext || '').trim().slice(0, 3000);
  if (theme.length < 2) return res.status(400).json({ error: 'テーマを2文字以上で入力してください' });

  const params = { theme, scope, depth, sites, period, customPeriod, purpose, referenceContext, forceMock: !!b.forceMock };
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
    if (e.type === 'end') cleanup(true);
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
  try {
    const result = await deepdive.runDeepDive({ theme, question, reportContext, period, quote });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || '深掘り調査に失敗しました' });
  }
});

/* ------------------------------------------------------------- PDF export */
app.post('/api/export/pdf', async (req, res) => {
  const { html, filename } = req.body || {};
  if (!html) return res.status(400).json({ error: 'html は必須です' });

  try {
    const pdfPath = await pdf.generatePdfFromHtml(html);
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
app.delete('/api/history/:id', (req, res) => res.json({ ok: history.remove(req.params.id) }));

/* ------------------------------------------------------------- memory */
app.get('/api/memory', (req, res) => res.json(memory.load()));
app.delete('/api/memory/:domain', (req, res) => res.json({ ok: memory.remove(req.params.domain) }));
app.post('/api/memory/clear', (req, res) => res.json({ ok: memory.clear() }));

/* -------------------------------------------------------------- errors */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, HOST, () => {
  const s = settings.publicView();
  const line = '─'.repeat(56);
  console.log(`\n${line}\n  ◆ Research Studio  v0.1.0\n${line}`);
  console.log(`  ローカル     : http://localhost:${PORT}`);
  lanAddresses().forEach((a) => console.log(`  スマホ (LAN) : ${a.url}   [${a.name}]`));
  console.log(`  モード       : ${s.effectiveMode === 'live' ? 'LIVE (Gemini)' : 'DEMO (モックデータ)'}`);
  console.log(`  検索         : ${s.effectiveSearch}`);
  console.log(`${line}`);
  console.log(`  ★ 終了方法: [Ctrl + C] を押すか、このウィンドウを閉じてください`);
  console.log(`  ★ 停止用バッチ: stop.bat をダブルクリックでも停止できます`);
  console.log(`${line}\n`);

  if (process.pkg || process.env.AUTO_OPEN === '1') {
    try {
      const { spawn } = require('child_process');
      const url = `http://localhost:${PORT}`;
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'darwin') {
        spawn('open', [url], { detached: true, stdio: 'ignore' });
      } else {
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      }
    } catch {}
  }
});


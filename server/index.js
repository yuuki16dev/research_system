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
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const QRCode = require('qrcode');

const settings = require('./settings');
const history = require('./history');
const memory = require('./memory');
const { createJob, getJob, checkJobCapacity } = require('./jobs');
const { runResearch, runCrossSynthesis, runDeltaTracking } = require('./pipeline');
const { generate } = require('./gemini');
const { generateGroq } = require('./groq');
const { tavilySearch } = require('./search');
const deepdive = require('./deepdive');
const pdf = require('./pdf');
const excel = require('./excel');
const templateEngine = require('./template-engine');
const profile = require('./profile');
const presentation = require('./presentation');
const { getFullUsageSummary } = require('./usage');
const { buildMarkdown, buildPlainText } = require('./util');
const auth = require('./auth');
const quota = require('./quota');
const { validateThemeSafety } = require('./security');
const env = require('./env');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

if (env.IS_CLOUD && (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY.trim())) {
  console.error('[FATAL] クラウド環境（SUPABASE_URL設定時）では SUPABASE_SERVICE_ROLE_KEY が必須です');
  process.exit(1);
}


const PORT = Number(process.env.PORT) || 3939;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');

const app = express();
app.disable('x-powered-by');

// B-8: クラウド環境下でのリバースプロキシ信頼設定
if (env.IS_CLOUD) {
  app.set('trust proxy', 1);
}

// B-8: セキュリティヘッダー (Helmet + CSP)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// B-8: レート制限 (express-rate-limit)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 10, // 10回
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'ログイン・登録試行回数の上限に達しました。15分後に再試行してください。', code: 'TOO_MANY_REQUESTS' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分
  max: 10, // 10回
  keyGenerator: (req) => (req.user && req.user.id) || req.ip,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AIリクエストの回数上限に達しました（1分間に最大10回）。しばらく待ってから再試行してください。', code: 'RATE_LIMIT_EXCEEDED' },
});

const isTest = process.env.NODE_ENV === 'test';
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分
  max: isTest ? 5000 : 120, // テスト環境ではテスト全体の並行連続呼び出しを阻害しないよう緩和
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'リクエスト頻度が高すぎます。しばらく時間をおいて再試行してください。', code: 'RATE_LIMIT_EXCEEDED' },
});

// 全体 API に一般レートリミッターを適用
app.use('/api', generalApiLimiter);

// B-8: express.json の上限設定 (通常 1MB、ファイル添付・復元受付ルートのみ 10MB)
const json1mb = express.json({ limit: '1mb' });
const json10mb = express.json({ limit: '10mb' });
app.use((req, res, next) => {
  if (
    req.path === '/api/research' ||
    req.path === '/api/presentation/generate' ||
    req.path === '/api/history/restore'
  ) {
    return json10mb(req, res, next);
  }
  return json1mb(req, res, next);
});

// 自動シャットダウン用タイマー（全ブラウザ切断時）
let autoShutdownTimer = null;

// 通常のアクセスがあった場合は自動終了タイマーをキャンセル（クラウド版では無効）
app.use((req, res, next) => {
  if (!env.IS_CLOUD && req.path !== '/api/lifecycle/leave' && autoShutdownTimer) {
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Research Studio', version: pkgVer, uptime: Math.floor(process.uptime()) });
});

/* ------------------------------------------------------------- Auth & Quota */
app.get('/api/auth/config', (req, res) => {
  res.json({
    enabled: auth.isCloudAuthEnabled(),
    hasSupabase: env.IS_CLOUD,
    isLocal: !env.IS_CLOUD,
    testUsersEnabled: env.TEST_USERS_ENABLED,
  });
});

app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'パスワードは8文字以上で設定してください' });
  }
  try {
    const data = await auth.signupUser(email, password);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
  }
  try {
    const data = await auth.loginUser(email, password);
    res.json(data);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  // トークンがリクエストに明示的に含まれている場合のみ認証済みとする
  if (match) {
    const user = await auth.verifyToken(match[1]);
    if (user) {
      const userPlan = user.plan || 'free';
      const q = await quota.getMonthlyQuota(user.id, userPlan);
      return res.json({
        authenticated: true,
        isCloud: auth.isCloudAuthEnabled(),
        user: {
          id: user.id,
          email: user.email,
          plan: userPlan,
          isLocal: !!user.isLocal,
        },
        quota: q,
      });
    }
  }

  // トークンがない場合、または無効なトークンの場合は未ログイン（ゲスト）
  res.json({
    authenticated: false,
    isCloud: auth.isCloudAuthEnabled(),
    user: null,
    quota: null,
  });
});

function getCloudSettingsView(s = settings.load()) {
  return {
    publisher: s.publisher,
    publisherTagline: s.publisherTagline,
    author: s.author,
    confidentiality: s.confidentiality,
    disclaimer: s.disclaimer,
    themePreset: s.themePreset || 'corporate-blue',
    themePrimaryColor: s.themePrimaryColor || '',
    themeAccentColor: s.themeAccentColor || '',
    effectiveMode: settings.effectiveMode(s),
  };
}

app.get('/api/info', (req, res) => {
  if (env.IS_CLOUD) {
    return res.json({
      app: 'Research Studio',
      version: pkgVer,
      port: currentPort,
      settings: getCloudSettingsView(),
    });
  }
  res.json({
    app: 'Research Studio',
    version: pkgVer,
    port: currentPort,
    lan: lanAddresses(currentPort),
    settings: settings.publicView(),
  });
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
    res.status(500).json({ error: '更新履歴の取得に失敗しました' });
  }
});

if (!env.IS_CLOUD) {
  app.get('/api/qr', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
      const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0f1e', light: '#ffffff' } });
      res.type('image/svg+xml').send(svg);
    } catch (e) {
      logger.error('QR code generation error', e);
      res.status(500).json({ error: 'QRコードの生成に失敗しました' });
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
}

/* ----------------------------------------------------------- settings */
app.get('/api/settings', (req, res) => {
  if (env.IS_CLOUD) {
    return res.json(getCloudSettingsView());
  }
  res.json(settings.publicView());
});

if (!env.IS_CLOUD) {
  app.put('/api/settings', (req, res) => {
    const s = settings.save(req.body || {});
    res.json(settings.publicView(s));
  });

  /** 接続テスト。body にキーが含まれていればそれを、なければ保存済みのキーを使う */
  app.post('/api/settings/test', async (req, res) => {
    const cur = settings.load();
    const body = req.body || {};
    const geminiKey = String(body.geminiApiKey || cur.geminiApiKey || '').trim();
    const tavilyKey = String(body.tavilyApiKey || cur.tavilyApiKey || '').trim();
    const groqKey = String(body.groqApiKey || cur.groqApiKey || '').trim();
    const model = body.geminiModel || cur.geminiModel || 'gemini-3.8-flash';
    const groqModel = body.groqModel || cur.groqModel || 'llama-3.3-70b-versatile';
    const out = {};

    if (geminiKey) {
      try {
        const t0 = Date.now();
        await generate({
          apiKey: geminiKey,
          model,
          prompt: 'Reply with the single word: OK',
          json: false,
          temperature: 0,
          maxRetries: 2,
          signal: AbortSignal.timeout(15000),
        });
        const tierMode = body.geminiAccountTier || cur.geminiAccountTier || 'auto';
        const tierLabel = tierMode === 'tier1' ? '有料枠 (Tier 1モード)' : '無料枠 (トークン圧縮＆混雑回避ON)';
        out.gemini = { ok: true, message: `接続OK（${model} / ${Date.now() - t0}ms / ${tierLabel}）` };
      } catch (e) {
        // 最初のモデルで失敗した場合、Google公式の安定モデル（gemini-3.7-flash）で即座に代替診断
        let altTested = null;
        if (model !== 'gemini-3.7-flash') {
          try {
            const t1 = Date.now();
            await generate({
              apiKey: geminiKey,
              model: 'gemini-3.7-flash',
              prompt: 'Reply with the single word: OK',
              json: false,
              temperature: 0,
              maxRetries: 1,
              signal: AbortSignal.timeout(10000),
            });
            altTested = `gemini-3.7-flash（${Date.now() - t1}msで接続成功）`;
          } catch {
            // ignore
          }
        }

        if (altTested) {
          out.gemini = {
            ok: false,
            message: `${model} でエラー [${e.message}] ➔ 【解決策】${altTested} は正常に利用可能です！モデル欄に「gemini-3.7-flash」と入力して保存してください。`,
          };
        } else {
          out.gemini = {
            ok: false,
            message: `接続失敗: ${e.message}`,
          };
        }
      }
    } else {
      out.gemini = { ok: false, message: 'APIキー未設定' };
    }

    if (tavilyKey) {
      try {
        const r = await tavilySearch({ apiKey: tavilyKey, query: 'Research Studio test', maxResults: 1, signal: AbortSignal.timeout(15000) });
        out.tavily = { ok: true, message: `接続OK（${r.length}件取得）` };
      } catch (e) {
        out.tavily = { ok: false, message: e.message };
      }
    } else {
      out.tavily = { ok: false, message: 'APIキー未設定（DuckDuckGoを使用）' };
    }

    if (groqKey) {
      try {
        const t0 = Date.now();
        await generateGroq({
          apiKey: groqKey,
          model: groqModel,
          prompt: 'Reply with the single word: OK',
          json: false,
          timeoutMs: 10000,
        });
        out.groq = { ok: true, message: `接続OK（${groqModel} / ${Date.now() - t0}ms / 補欠スタンバイ中）` };
      } catch (e) {
        out.groq = { ok: false, message: `Groq接続失敗: ${e.message}` };
      }
    } else {
      out.groq = { ok: false, message: '未設定（Gemini単体で稼働）' };
    }

    res.json(out);
  });
}

/* ------------------------------------------------------------- usage */
if (!env.IS_CLOUD) {
  app.get('/api/usage', async (req, res) => {
    try {
      const force = req.query.refresh === '1' || req.query.force === 'true' || req.query.force === '1';
      const data = await getFullUsageSummary(settings.load(), { forceRefresh: force });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

/* ----------------------------------------------------------- research */
app.post('/api/research', auth.requireAuth, aiLimiter, quota.requireQuota, (req, res) => {
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
  const referenceContext = String(b.referenceContext || '').trim().slice(0, 15000);
  const referenceUrls = Array.isArray(b.referenceUrls) ? b.referenceUrls.map(u => String(u || '').trim()).filter(Boolean).slice(0, 10) : [];
  const attachedFiles = Array.isArray(b.attachedFiles) ? b.attachedFiles.filter(f => f && typeof f === 'object' && f.name).slice(0, 10) : [];
  const focus = typeof b.focus === 'string' ? b.focus.slice(0, 200) : '';
  const authoritative = !!b.authoritative;
  if (theme.length < 2) return res.status(400).json({ error: 'テーマを2文字以上で入力してください' });

  // 悪意ある検索・不正攻撃コードの防御 (v2.15.0)
  const safetyCheck = validateThemeSafety(theme);
  if (!safetyCheck.safe) {
    return res.status(400).json({ error: `入力内容が安全基準に抵触しました: ${safetyCheck.reason}` });
  }
  const sanitizedTheme = safetyCheck.sanitized;

  const userId = req.user ? req.user.id : 'owner-user';
  const userPlan = req.user ? (req.user.plan || 'free') : 'admin';

  // B-9: 同時実行数および同一ユーザーの実行中ジョブ制限
  const capacity = checkJobCapacity(userId);
  if (!capacity.ok) {
    return res.status(capacity.status).json({ error: capacity.error, code: capacity.code });
  }

  console.log(`[リサーチ受付] テーマ: "${sanitizedTheme}" (スコープ: ${scope}, 深度: ${depth}, スタイル: ${purpose}, ユーザー: ${userId}, プラン: ${userPlan})`);
  const params = { theme: sanitizedTheme, scope, depth, sites, period, customPeriod, purpose, customPurpose, referenceContext, referenceUrls, attachedFiles, focus, authoritative, forceMock: !!b.forceMock, userId };
  const job = createJob(params, (j) => runResearch(j, settings.load()), {
    userId,
    onResult: async (result) => {
      if (!result.userId && userId) {
        result.userId = userId;
      }
      try {
        await history.save(result);
      } catch (err) {
        console.error('[history] save error:', err.message);
      }
      if (userId) {
        quota.recordUsage(userId, userPlan).catch((err) => console.warn('[quota] record error:', err.message));
      }
      if (!env.IS_CLOUD) {
        try {
          memory.learnFromResearch(result);
        } catch (err) {
          console.error('[memory] learn error:', err.message);
        }
      }
    },
  });
  res.status(202).json({ jobId: job.id, token: job.token, subscriptionToken: job.token });
});

/* ------------------------------------------------ cross-synthesis (v1.17.0) */
app.post('/api/research/cross-synthesis', auth.requireAuth, aiLimiter, async (req, res) => {
  const b = req.body || {};
  const reportIds = Array.isArray(b.reportIds) ? b.reportIds : [];
  if (reportIds.length < 2) {
    return res.status(400).json({ error: 'クロス分析には2件以上のレポート選択が必要です' });
  }

  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';

  // B-9: 同時実行数および同一ユーザーの実行中ジョブ制限
  const capacity = checkJobCapacity(userId);
  if (!capacity.ok) {
    return res.status(capacity.status).json({ error: capacity.error, code: capacity.code });
  }

  const reportPromises = reportIds.map((id) => history.get(id, userId, userPlan));
  const reports = (await Promise.all(reportPromises)).filter(Boolean);
  if (reports.length < 2) {
    return res.status(404).json({ error: '選択されたレポートが見つかりません（2件以上存在する必要があります）' });
  }

  const themes = reports.map((r) => r.theme || '無題');
  const synthesizedTitle = `【統合クロス分析】${themes.join(' × ')}`;
  console.log(`[クロス統合受付] 対象レポート: ${reports.length}件 ("${themes.join('", "')}") (ユーザー: ${userId})`);

  const params = {
    theme: synthesizedTitle,
    reportIds,
    reports,
    forceMock: !!b.forceMock,
  };

  const job = createJob(params, (j) => runCrossSynthesis(j, settings.load()), {
    userId,
    onResult: async (result) => {
      if (!result.userId && userId) {
        result.userId = userId;
      }
      try {
        await history.save(result);
      } catch (err) {
        console.error('[history] save error:', err.message);
      }
      if (!env.IS_CLOUD) {
        try {
          memory.learnFromResearch(result);
        } catch (err) {
          console.error('[memory] learn error:', err.message);
        }
      }
    },
  });
  res.status(202).json({ jobId: job.id, token: job.token, subscriptionToken: job.token });
});

/* ------------------------------------------------ delta-tracking (v1.18.0) */
app.post('/api/research/delta', auth.requireAuth, aiLimiter, async (req, res) => {
  const b = req.body || {};
  const baseReportId = String(b.baseReportId || '').trim();
  if (!baseReportId) {
    return res.status(400).json({ error: '差分更新元のレポートID（baseReportId）が必要です' });
  }

  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';

  // B-9: 同時実行数および同一ユーザーの実行中ジョブ制限
  const capacity = checkJobCapacity(userId);
  if (!capacity.ok) {
    return res.status(capacity.status).json({ error: capacity.error, code: capacity.code });
  }

  const baseReport = await history.get(baseReportId, userId, userPlan);
  if (!baseReport) {
    return res.status(404).json({ error: '差分更新元のレポートが見つかりません' });
  }

  const rawTheme = baseReport.theme || baseReport.title || '調査テーマ';
  const cleanTheme = rawTheme.replace(/^(【定点差分】)+/, '');
  const theme = `【定点差分】${cleanTheme}`;
  console.log(`[定点差分受付] 元レポート: "${rawTheme}" -> "${theme}" (ID: ${baseReportId}, ユーザー: ${userId})`);

  const params = {
    theme,
    baseReportId,
    baseReport,
    forceMock: !!b.forceMock,
  };

  const job = createJob(params, (j) => runDeltaTracking(j, settings.load()), {
    userId,
    onResult: async (result) => {
      if (!result.userId && userId) {
        result.userId = userId;
      }
      try {
        await history.save(result);
      } catch (err) {
        console.error('[history] save error:', err.message);
      }
      if (!env.IS_CLOUD) {
        try {
          memory.learnFromResearch(result);
        } catch (err) {
          console.error('[memory] learn error:', err.message);
        }
      }
    },
  });
  res.status(202).json({ jobId: job.id, token: job.token, subscriptionToken: job.token });
});

app.get('/api/research/:id/events', auth.optionalAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ジョブが見つかりません（期限切れの可能性があります）' });

  // B-9: 持ち主（または有効な購読トークン）の検証
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const isTokenValid = Boolean(queryToken && job.token && queryToken === job.token);
  const isOwnerByAuth = Boolean(req.user && job.userId && req.user.id === job.userId);

  if (!isTokenValid && !isOwnerByAuth) {
    return res.status(404).json({ error: 'ジョブが見つかりません（期限切れまたはアクセス権がありません）' });
  }

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
    if (e.type === 'end' || e.type === 'error') {
      // ソケットバッファが確実にクライアントへ届くよう微小ディレイを設けて正常クローズ
      setTimeout(() => cleanup(true), 150);
    }
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

app.post('/api/research/:id/cancel', auth.requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });

  // B-9: 持ち主検証（持ち主以外には 404 を返す）
  const userId = req.user ? req.user.id : null;
  if (job.userId && userId !== job.userId) {
    return res.status(404).json({ error: 'not found' });
  }

  job.controller.abort();
  job.status = 'cancelled';
  res.json({ ok: true });
});

app.post('/api/research/deep-dive', auth.requireAuth, aiLimiter, async (req, res) => {
  const { theme, question, reportContext, period, quote, chatHistory } = req.body || {};
  if (!theme || !question) return res.status(400).json({ error: 'theme と question は必須です' });

  // B-8: 入力文字数・件数の厳格な検証
  if (typeof theme !== 'string' || theme.length > 500) {
    return res.status(400).json({ error: 'theme は500文字以内の文字列である必要があります' });
  }
  if (typeof question !== 'string' || question.length > 500) {
    return res.status(400).json({ error: 'question は500文字以内の文字列である必要があります' });
  }
  if (quote !== undefined && quote !== null) {
    if (typeof quote !== 'string' || quote.length > 1000) {
      return res.status(400).json({ error: 'quote は1,000文字以内の文字列である必要があります' });
    }
  }
  if (reportContext !== undefined && reportContext !== null) {
    if (typeof reportContext !== 'string' || reportContext.length > 8000) {
      return res.status(400).json({ error: 'reportContext は8,000文字以内の文字列である必要があります' });
    }
  }
  if (chatHistory !== undefined && chatHistory !== null) {
    if (!Array.isArray(chatHistory)) {
      return res.status(400).json({ error: 'chatHistory は配列である必要があります' });
    }
    if (chatHistory.length > 10) {
      return res.status(400).json({ error: 'chatHistory は最大10件までです' });
    }
    for (let i = 0; i < chatHistory.length; i++) {
      const item = chatHistory[i];
      let itemLen = 0;
      if (typeof item === 'string') {
        itemLen = item.length;
      } else if (item && typeof item === 'object') {
        itemLen = (String(item.question || '') + String(item.answer || '')).length;
      }
      if (itemLen > 2000) {
        return res.status(400).json({ error: `chatHistory[${i}] は2,000文字以内である必要があります` });
      }
    }
  }

  console.log(`[深掘り対話] 質問: "${question.slice(0, 35)}..." を受信 (履歴: ${Array.isArray(chatHistory) ? chatHistory.length : 0}件)`);
  try {
    const result = await deepdive.runDeepDive({ theme, question, reportContext, period, quote, chatHistory });
    res.json(result);
  } catch (err) {
    console.error('Deep dive execution error:', err);
    res.status(500).json({ error: '深掘り調査の実行に失敗しました' });
  }
});

/* ------------------------------------------------------------- PDF HTML preview */
app.post('/api/export/pdf/html', auth.requireAuth, (req, res) => {
  const { data, brand, template } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data は必須です' });
  try {
    const html = templateEngine.renderTemplateHtml(template || 'slides', data, brand);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('PDF HTML generation error:', err);
    res.status(500).json({ error: 'HTMLの生成に失敗しました' });
  }
});

/* ------------------------------------------------------------- PDF export */
app.post('/api/export/pdf', auth.requireAuth, async (req, res) => {
  let { html, data, brand, template, filename, orientation } = req.body || {};

  // B-7: クラウド版では任意のHTMLパラメータ受取を拒絶し 400 を返す
  if (env.IS_CLOUD && typeof html === 'string' && html.trim().length > 0) {
    return res.status(400).json({
      error: 'クラウド版では直接のHTML指定によるPDF生成は許可されていません。data と template を指定してください。',
      code: 'HTML_PAYLOAD_FORBIDDEN',
    });
  }

  // data と template がある場合はサーバー側で新テンプレートからHTMLを直接レンダリング
  if (!html && data) {
    try {
      html = templateEngine.renderTemplateHtml(template || 'slides', data, brand);
      if (!orientation) {
        const norm = String(template || '').toLowerCase();
        orientation = (norm === 'decision' || norm === 'decision-brief' || norm === 'b' || norm === 'report' || norm === 'research-report' || norm === 'c')
          ? 'portrait'
          : 'landscape';
      }
    } catch (e) {
      console.error('Template render error:', e);
      return res.status(500).json({ error: 'テンプレートの生成に失敗しました' });
    }
  }

  if (!html) return res.status(400).json({ error: 'data は必須です（ローカル版では html も可）' });
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
    const statusCode = err.status || 500;
    const msg = statusCode === 503 ? err.message : 'PDFの生成に失敗しました';
    res.status(statusCode).json({ error: msg });
  }
});

/* ----------------------------------------------------------- Excel export */
app.post('/api/export/excel', auth.requireAuth, async (req, res) => {
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

/* -------------------------------------------------------- Markdown export */
app.post('/api/export/markdown', auth.requireAuth, (req, res) => {
  const { data, filename } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data は必須です' });

  try {
    const md = buildMarkdown(data);
    const safeName = encodeURIComponent((filename || `${data.title || data.theme || 'Research_Report'}.md`).replace(/[\\/:*?"<>|\r\n]+/g, '_'));
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    res.send(md);
  } catch (err) {
    console.error('Markdown export error:', err);
    res.status(500).json({ error: err.message || 'Markdownの生成に失敗しました' });
  }
});

/* ------------------------------------------------------ Plain text export */
app.post('/api/export/text', auth.requireAuth, (req, res) => {
  const { data, filename } = req.body || {};
  if (!data) return res.status(400).json({ error: 'data は必須です' });

  try {
    const txt = buildPlainText(data);
    const safeName = encodeURIComponent((filename || `${data.title || data.theme || 'Research_Report'}.txt`).replace(/[\\/:*?"<>|\r\n]+/g, '_'));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`);
    res.send(txt);
  } catch (err) {
    console.error('Plain text export error:', err);
    res.status(500).json({ error: err.message || 'プレーンテキストの生成に失敗しました' });
  }
});

/* ---------------------------------------------------- presentation studio */
app.post('/api/presentation/prompt', auth.requireAuth, (req, res) => {
  const { document, audience, goal, files } = req.body || {};
  try {
    const prompt = presentation.generatePrompt({ document, audience, goal, files });
    res.json({ prompt });
  } catch (err) {
    res.status(400).json({ error: err.message || 'プロンプト生成に失敗しました' });
  }
});

app.post('/api/presentation/generate', auth.requireAuth, aiLimiter, async (req, res) => {
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
    res.status(500).json({ error: 'スライドの生成に失敗しました' });
  }
});

/* ------------------------------------------------------------ history */
app.get('/api/history', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const list = await history.list(userId, userPlan);
    res.json(list);
  } catch (err) {
    console.error('[history] list error:', err.message);
    res.status(500).json({ error: '履歴一覧の取得に失敗しました' });
  }
});

// 全履歴の一括バックアップダウンロード (v2.13.0)
app.get('/api/history/backup', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const reports = await history.getAllForUser(userId, userPlan);
    const userProf = profile.getProfile(userId);
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="research_studio_backup_${userId}_${ymd}.json"`);
    res.json({
      version: pkgVer,
      exportedAt: new Date().toISOString(),
      userId,
      profile: userProf,
      count: reports.length,
      reports,
    });
  } catch (err) {
    console.error('[history] backup error:', err.message);
    res.status(500).json({ error: 'バックアップの生成に失敗しました' });
  }
});

// バックアップからの全履歴復元・インポート (v2.13.0)
app.post('/api/history/restore', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { reports, profile: incomingProfile } = req.body || {};
  if (!Array.isArray(reports)) {
    return res.status(400).json({ error: 'reports は配列である必要があります' });
  }
  if (reports.length > 50) {
    return res.status(400).json({ error: '一度に復元できる件数は最大50件です' });
  }

  try {
    const result = await history.restoreReports(reports, userId);
    if (incomingProfile && typeof incomingProfile === 'object') {
      profile.updateProfile(userId, incomingProfile);
    }

    res.json({
      ok: true,
      userId,
      restored: result.restored,
      skipped: result.skipped,
      totalInPayload: reports.length,
    });
  } catch (err) {
    console.error('[history] restore error:', err.message);
    res.status(500).json({ error: '履歴の復元に失敗しました' });
  }
});

/* ------------------------------------------------------------ profile (v2.13.0) */
app.get('/api/user/profile', auth.requireAuth, (req, res) => {
  const userId = req.user.id;
  res.json({ ok: true, profile: profile.getProfile(userId) });
});

app.put('/api/user/profile', auth.requireAuth, (req, res) => {
  const userId = req.user.id;
  const updated = profile.updateProfile(userId, req.body || {});
  res.json({ ok: true, profile: updated });
});
app.get('/api/history/:id', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const r = await history.get(req.params.id, userId, userPlan);
    return r ? res.json(r) : res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('[history] get error:', err.message);
    res.status(500).json({ error: '履歴の取得に失敗しました' });
  }
});

/* ------------------------------------------------------ share (v2.10.0) */
if (!env.IS_CLOUD) {
  app.get('/api/share/:id', async (req, res) => {
    try {
      const r = await history.get(req.params.id, null, 'admin');
      return r ? res.json(r) : res.status(404).json({ error: '指定されたレポートが見つかりません' });
    } catch (err) {
      console.error('[share] get error:', err.message);
      res.status(500).json({ error: 'レポートの取得に失敗しました' });
    }
  });

  app.get('/share/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'share.html'), { dotfiles: 'allow' });
  });
}
app.patch('/api/history/:id', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const updated = await history.update(req.params.id, req.body || {}, userId, userPlan);
    return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('[history] update error:', err.message);
    res.status(500).json({ error: '更新に失敗しました' });
  }
});
app.put('/api/history/:id', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const updated = await history.update(req.params.id, req.body || {}, userId, userPlan);
    return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('[history] update error:', err.message);
    res.status(500).json({ error: '更新に失敗しました' });
  }
});
app.post('/api/history/:id/pin', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const updated = await history.togglePin(req.params.id, userId, userPlan);
    return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
  } catch (err) {
    console.error('[history] pin error:', err.message);
    res.status(500).json({ error: 'ピン留めの切り替えに失敗しました' });
  }
});
app.delete('/api/history/:id', auth.requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userPlan = req.user.plan || 'free';
  try {
    const ok = await history.remove(req.params.id, userId, userPlan);
    if (!ok) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[history] remove error:', err.message);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

/* ------------------------------------------------------------- memory */
if (!env.IS_CLOUD) {
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
}

/* -------------------------------------------------------------- errors */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

function openBrowser(url) {
  if (process.env.NODE_ENV === 'test' || process.env.CI) return;
  try {
    const { spawn } = require('child_process');
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    if (child && typeof child.unref === 'function') {
      child.unref();
    }
  } catch {}
}

/** 該当ポートで動いているのが Research Studio か確認 */
function checkIsResearchStudio(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/info`, { timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json && json.app === 'Research Studio');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      resolve(false);
    });
  });
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
        if (process.env.NODE_ENV !== 'test') {
          openBrowser(`http://localhost:${port}`);
        }
        setTimeout(() => process.exit(0), 20);
        return;
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
    if (process.env.NODE_ENV !== 'test') {
      openBrowser(`http://localhost:${PORT}`);
    }
    setTimeout(() => process.exit(0), 20);
    return;
  }

  startServer(PORT, HOST);
}

bootstrap();

module.exports = { app, parseChangelog };

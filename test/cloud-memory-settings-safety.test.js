'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('B-3: Cloud mode suppresses memory learning, domain suggestions, settings save, and usage file writes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-b3-'));
  const origEnv = { ...process.env };

  try {
    process.env.RESEARCH_DATA_DIR = tmpDir;
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'mock-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role';
    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    process.env.TAVILY_API_KEY = 'mock-tavily-key';

    // モジュール再ロードまたは読み込み
    // env.js を反映
    delete require.cache[require.resolve('../server/env')];
    delete require.cache[require.resolve('../server/settings')];
    delete require.cache[require.resolve('../server/memory')];
    delete require.cache[require.resolve('../server/usage')];

    const env = require('../server/env');
    assert.strictEqual(env.IS_CLOUD, true, 'IS_CLOUD must be true');

    const memory = require('../server/memory');
    const settings = require('../server/settings');
    const usage = require('../server/usage');

    // 1. memory: learnFromResearch does nothing in cloud mode
    memory.learnFromResearch({
      theme: '量子コンピューティング動向',
      sources: [
        { domain: 'nature.com', score: 95 },
        { domain: 'arxiv.org', score: 90 },
      ],
    });
    assert.deepStrictEqual(memory.suggestRelevantDomains('量子コンピューティング'), []);
    assert.deepStrictEqual(memory.load(), []);

    // 2. settings: load() creates config from env without files; save() throws
    const loadedSettings = settings.load();
    assert.strictEqual(loadedSettings.geminiApiKey, 'mock-gemini-key');
    assert.strictEqual(loadedSettings.tavilyApiKey, 'mock-tavily-key');
    assert.strictEqual(loadedSettings.publisher, 'Research Studio');

    assert.throws(
      () => {
        settings.save({ publisher: 'Malicious Publisher' });
      },
      /クラウド環境では設定ファイルの保存は無効化されています/,
      'settings.save must throw in cloud mode'
    );

    // 3. usage: recordGemini and recordGroq must not write usage.json
    usage.recordGemini({ model: 'gemini-3.8-flash', promptTokens: 100, candidatesTokens: 200 });
    usage.recordGroq({ model: 'llama-3.3-70b-versatile', promptTokens: 50, candidatesTokens: 50 });
    usage.recordSearch({ provider: 'tavily', count: 1 });

    // 4. Verify no files (memory.json, settings.json, usage.json) were created in tmpDir
    const memoryFile = path.join(tmpDir, 'memory.json');
    const settingsFile = path.join(tmpDir, 'settings.json');
    const usageFile = path.join(tmpDir, 'usage.json');

    assert.strictEqual(fs.existsSync(memoryFile), false, 'memory.json must not be created in cloud mode');
    assert.strictEqual(fs.existsSync(settingsFile), false, 'settings.json must not be created in cloud mode');
    assert.strictEqual(fs.existsSync(usageFile), false, 'usage.json must not be created in cloud mode');
  } finally {
    process.env = origEnv;
    delete require.cache[require.resolve('../server/env')];
    delete require.cache[require.resolve('../server/settings')];
    delete require.cache[require.resolve('../server/memory')];
    delete require.cache[require.resolve('../server/usage')];

    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 一時ディレクトリ削除エラーは無視
    }
  }
});

test('B-3: End-to-end research execution in cloud mode leaves no memory.json, settings.json, or usage.json in data directory', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-b3-e2e-'));
  const http = require('http');
  const net = require('net');

  function getFreePort() {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
  }

  // Supabase モック
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  });

  const mockPort = await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => resolve(mockServer.address().port));
  });

  const testPort = await getFreePort();
  const { fork } = require('child_process');
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  const child = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      RESEARCH_DATA_DIR: tmpDir,
      SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      ENABLE_TEST_USERS: 'true',
    },
    silent: true,
  });

  try {
    // サーバーの起動待ち
    let started = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
        if (res.ok) {
          started = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(started, 'Cloud server must start up successfully');

    // リサーチ実行 (forceMock: true)
    const researchRes = await fetch(`http://127.0.0.1:${testPort}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-user-a',
      },
      body: JSON.stringify({
        theme: 'クラウド知見メモリ安全検証テスト',
        forceMock: true,
      }),
    });
    assert.strictEqual(researchRes.status, 202);
    const { jobId } = await researchRes.json();
    assert.ok(jobId);

    // ジョブ完了待ち
    await new Promise((r) => setTimeout(r, 2000));

    // 検証: tmpDir 配下に memory.json, settings.json, usage.json が作成されていないこと
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'memory.json')), false, 'memory.json must not exist');
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'settings.json')), false, 'settings.json must not exist');
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'usage.json')), false, 'usage.json must not exist');
  } finally {
    try {
      child.kill('SIGINT');
      if (child.pid) {
        try { child.kill('SIGKILL'); } catch {}
      }
    } catch {}
    await new Promise((r) => mockServer.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 一時ディレクトリ削除エラーは無視
    }
  }
});

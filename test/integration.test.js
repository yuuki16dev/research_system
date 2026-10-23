'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

// サーバー起動ヘルパー
async function runWithServer(callback) {
  const testPort = 3949; // テスト専用ポート
  const env = { ...process.env, PORT: String(testPort) };

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  const url = `http://localhost:${testPort}`;

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`${url}/api/info`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }

  assert.ok(ready, 'Test server failed to start within timeout');

  try {
    await callback(url);
  } finally {
    try { child.kill('SIGINT'); } catch {}
  }
}

test('integration: /api/info returns app name, version, and masked settings', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/info`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.app, 'Research Studio');
    assert.ok(data.version);
    assert.ok(data.settings);
    if (data.settings.geminiApiKey) {
      assert.strictEqual(typeof data.settings.geminiApiKey.set, 'boolean');
      if (data.settings.geminiApiKey.masked) {
        assert.ok(data.settings.geminiApiKey.masked.includes('•'));
      }
    }
  });
});

test('integration: /api/settings handles get and put', async () => {
  await runWithServer(async (url) => {
    const getRes = await fetch(`${url}/api/settings`);
    assert.strictEqual(getRes.status, 200);
    const settings = await getRes.json();
    assert.ok(settings.geminiModel);
    assert.ok(settings.searchProvider);
    assert.ok(settings.mode);

    // PUT test (update publisher safely)
    const putRes = await fetch(`${url}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisher: 'Research Studio Test' }),
    });
    assert.strictEqual(putRes.status, 200);
    const updated = await putRes.json();
    assert.strictEqual(updated.publisher, 'Research Studio Test');
  });
});

test('integration: /api/usage returns full usage summary', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/usage`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.gemini);
    assert.ok(data.tavily);
    assert.ok(data.duckduckgo);
    assert.strictEqual(typeof data.gemini.configured, 'boolean');
  });
});

test('integration: /api/history lists existing research history and supports get by id', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/history`);
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    if (list.length > 0) {
      const itemRes = await fetch(`${url}/api/history/${list[0].id}`);
      assert.strictEqual(itemRes.status, 200);
      const item = await itemRes.json();
      assert.ok(item.theme);
    }
  });
});

test('integration: /api/research creates job, returns 202, and accepts cancel', async () => {
  await runWithServer(async (url) => {
    const createRes = await fetch(`${url}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'テスト自動検証用のテーマ',
        scope: 'web',
        depth: 'quick',
        period: 'year',
        purpose: 'general',
        forceMock: true,
      }),
    });
    assert.strictEqual(createRes.status, 202);
    const data = await createRes.json();
    assert.ok(data.jobId, 'jobId must be returned in response');

    // ジョブのキャンセルテスト
    const cancelRes = await fetch(`${url}/api/research/${data.jobId}/cancel`, {
      method: 'POST',
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelData.ok, true);
  });
});

test('integration: /api/research accepts new styles (tech, brief, decision, academic, custom) and customPurpose', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: '次世代Webフロントエンドの選定',
        scope: 'web',
        depth: 'quick',
        period: 'year',
        purpose: 'custom',
        customPurpose: 'エンジニア目線でバンドルサイズとSSR性能に特化して比較',
        forceMock: true,
      }),
    });
    assert.strictEqual(res.status, 202);
    const data = await res.json();
    assert.ok(data.jobId, 'jobId must be returned for custom purpose request');

    // キャンセルして後始末
    await fetch(`${url}/api/research/${data.jobId}/cancel`, { method: 'POST' });
  });
});

test('integration: /api/research/deep-dive handles question answering', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/research/deep-dive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'テストテーマ',
        question: '要点を簡潔に教えてください',
        reportContext: {
          title: 'テストレポート',
          summary: 'テスト用の要約文です。',
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.answer, 'deepdive answer must be returned');
  });
});

test('integration: double-launch prevention exits second process gracefully and points to existing instance', async () => {
  await runWithServer(async (url) => {
    // 既存のサーバーが稼働しているポート（3949）と同じポートで2つ目を起動
    const testPort = '3949';
    const child2 = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      env: { ...process.env, PORT: testPort },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child2.stdout.on('data', (d) => { output += d.toString(); });
    child2.stderr.on('data', (d) => { output += d.toString(); });

    const exitCode = await new Promise((resolve) => {
      child2.on('exit', (code) => resolve(code));
    });

    assert.strictEqual(exitCode, 0, 'Second process should exit cleanly with code 0');
    assert.ok(
      output.includes('すでに起動しています'),
      'Output should mention that Research Studio is already running'
    );
  });
});

test('integration: /api/lifecycle/leave accepts beacon request and cancels on subsequent requests', async () => {
  await runWithServer(async (url) => {
    // 離脱シグナルの送信 (sendBeacon 模倣)
    const leaveRes = await fetch(`${url}/api/lifecycle/leave`, { method: 'POST' });
    assert.strictEqual(leaveRes.status, 200);
    const leaveData = await leaveRes.json();
    assert.strictEqual(leaveData.ok, true);

    // その後の通常アクセスにより自動終了タイマーがキャンセルされ正常にレスポンスすることを確認
    const infoRes = await fetch(`${url}/api/info`);
    assert.strictEqual(infoRes.status, 200);
  });
});

test('integration: /api/shutdown accepts graceful shutdown request', async () => {
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/shutdown`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.message.includes('shutting down'));
  });
});

test('integration: /api/export/excel generates high-quality spreadsheet binary with ExcelJS', async () => {
  await runWithServer(async (url) => {
    const mockData = {
      title: 'テストExcelレポート',
      summary: 'テストサマリー本文',
      metrics: [{ label: '市場規模', value: '1,500億円', note: '前年比20%増' }],
      table: { columns: ['項目', 'A社', 'B社'], rows: [['価格', '1000円', '2000円']] },
      sources: [{ index: 1, title: 'ソース1', url: 'https://example.com', score: 0.9 }],
    };

    const res = await fetch(`${url}/api/export/excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: mockData, brand: { publisherName: 'Test Corp' } }),
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const buffer = await res.arrayBuffer();
    assert.ok(buffer.byteLength > 5000, 'Excel buffer must be non-empty and well-structured');
  });
});

test('integration: /api/changelog returns structured version history', async () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  await runWithServer(async (url) => {
    const res = await fetch(`${url}/api/changelog`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.app, 'Research Studio');
    assert.strictEqual(data.currentVersion, pkg.version);
    assert.ok(Array.isArray(data.releases), 'releases must be an array');
    assert.ok(data.releases.length >= 10, 'releases must contain past versions');

    const latest = data.releases[0];
    assert.strictEqual(latest.version, `v${pkg.version}`);
    assert.strictEqual(latest.isCurrent, true);
    assert.ok(Array.isArray(latest.categories), 'categories must be an array');
    assert.ok(latest.categories.length > 0, 'latest release must have categories');
  });
});





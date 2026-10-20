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
  for (let i = 0; i < 25; i++) {
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

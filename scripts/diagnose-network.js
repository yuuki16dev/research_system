'use strict';

const dns = require('dns');
const https = require('https');
const settings = require('../server/settings').load();

console.log('====================================================');
console.log('  Research Studio 通信・Gemini API 総合診断ツール');
console.log('====================================================\n');

console.log('1. 基本環境情報:');
console.log(`   ・OS: ${process.platform} (${process.arch})`);
console.log(`   ・Node.js: ${process.version}`);
console.log(`   ・HTTP_PROXY: ${process.env.HTTP_PROXY || process.env.http_proxy || '（未設定・ダイレクト通信）'}`);
console.log(`   ・HTTPS_PROXY: ${process.env.HTTPS_PROXY || process.env.https_proxy || '（未設定・ダイレクト通信）'}`);
console.log(`   ・設定ファイル: geminiModel = ${settings.geminiModel}`);
console.log(`   ・APIキー: ${settings.geminiApiKey ? '設定済み (' + settings.geminiApiKey.slice(0, 4) + '••••' + settings.geminiApiKey.slice(-4) + ')' : '未設定'}\n`);

async function testDns() {
  console.log('2. DNS名前解決テスト (generativelanguage.googleapis.com):');
  return new Promise((resolve) => {
    dns.lookup('generativelanguage.googleapis.com', { all: true }, (err, addresses) => {
      if (err) {
        console.log(`   ❌ DNS解決失敗: ${err.message} (${err.code})`);
        return resolve(false);
      }
      console.log('   ✅ DNS解決成功:');
      addresses.forEach((a) => console.log(`      - IP: ${a.address} (family: IPv${a.family})`));
      resolve(true);
    });
  });
}

async function testFetch(model, apiKey) {
  console.log(`\n3. Gemini API 直接通信テスト [モデル: ${model}]:`);
  const t0 = Date.now();
  const cleanKey = String(apiKey || '').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cleanKey)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Ping' }] }],
        generationConfig: { maxOutputTokens: 5, temperature: 0 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    const ms = Date.now() - t0;
    const bodyText = await res.text();
    let bodyJson = null;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch (_) {}

    if (res.ok) {
      console.log(`   ✅ 成功! HTTP ${res.status} OK (${ms}ms)`);
      console.log(`      応答: ${bodyText.slice(0, 150)}...`);
      return { ok: true, status: res.status };
    } else {
      console.log(`   ❌ Google側エラー: HTTP ${res.status} (${ms}ms)`);
      if (bodyJson && bodyJson.error) {
        console.log(`      エラーコード: ${bodyJson.error.code} (${bodyJson.error.status})`);
        console.log(`      メッセージ: ${bodyJson.error.message}`);
      } else {
        console.log(`      レスポンス本文: ${bodyText.slice(0, 300)}`);
      }
      return { ok: false, status: res.status, error: bodyJson ? bodyJson.error : bodyText };
    }
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`   ❌ 接続エラー・通信失敗 (${ms}ms):`);
    console.log(`      名前: ${err.name}`);
    console.log(`      エラーメッセージ: ${err.message}`);
    if (err.cause) {
      console.log(`      内部原因 (cause): ${err.cause.message || err.cause.code || err.cause}`);
    }
    return { ok: false, error: err };
  }
}

async function main() {
  await testDns();

  const key = settings.geminiApiKey;
  if (!key) {
    console.log('\n❌ APIキーが未設定のため、以降のAPI通信テストをスキップします。');
    console.log('   画面の「設定」でAPIキーを入力してください。');
    return;
  }

  // 現在の設定モデルをテスト
  await testFetch(settings.geminiModel, key);

  // 代替モデル（gemini-3.7-flash）もテスト
  if (settings.geminiModel !== 'gemini-3.7-flash') {
    await testFetch('gemini-3.7-flash', key);
  }

  // gemini-3.5-flash もテスト
  await testFetch('gemini-3.5-flash', key);

  // gemini-flash-latest もテスト
  await testFetch('gemini-flash-latest', key);

  console.log('\n====================================================');
  console.log('  診断完了: 上記の出力結果をコピーしてお知らせください');
  console.log('====================================================');
}

main().catch((err) => console.error('診断実行時例外:', err));

'use strict';

const fs = require('fs');
const path = require('path');
const dbCheck = require('../server/db-check');
const env = require('../server/env');

const ROOT = path.join(__dirname, '..');

/**
 * Load key=value pairs from .env into targetEnv only for unset keys.
 */
function loadDotEnvIfPresent(dotEnvPath = path.join(ROOT, '.env'), targetEnv = process.env) {
  if (!fs.existsSync(dotEnvPath)) return [];
  const raw = fs.readFileSync(dotEnvPath, 'utf8');
  const loaded = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && targetEnv[key] === undefined) {
      targetEnv[key] = val;
      loaded.push(key);
    }
  }
  return loaded;
}

async function main() {
  loadDotEnvIfPresent();

  const supabaseUrl = env.getSupabaseUrl();
  const serviceKey = env.getSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    console.error('[check:db] SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してから実行してください（.env からも読み込み可能）。');
    process.exit(1);
  }

  console.log(`[check:db] 接続先: ${supabaseUrl}`);
  try {
    const result = await dbCheck.verifyDatabaseSchema({ force: true });
    console.log('[check:db] ✅ すべての必須テーブル・列・RPC 関数が正常に存在します。');
    console.log(`  - Tables: ${result.checkedTables.join(', ')}`);
    console.log(`  - RPCs  : ${result.checkedRpcs.join(', ')}`);
  } catch (err) {
    console.error(`[check:db] ❌ 検証失敗:\n${err.message}`);
    if (Array.isArray(err.missingMigrations) && err.missingMigrations.length > 0) {
      console.error('\n[推奨対応]');
      console.error('  Supabase ダッシュボード > SQL Editor で次のファイルを実行してください:');
      err.missingMigrations.forEach((f) => console.error(`    - supabase/migrations/${f}`));
      console.error('  （または一括統合版: supabase/migrations/all_in_one.sql）');
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadDotEnvIfPresent };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { fork } = require('child_process');

function getFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

test('B-4: PATCH request with { userId: "victim" } cannot change report ownership', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-b4-patch-'));
  const testPort = await getFreePort();
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  const child = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      RESEARCH_DATA_DIR: tmpDir,
      ENABLE_TEST_USERS: 'true',
    },
    silent: true,
  });

  try {
    // 起動待ち
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
    assert.ok(started, 'Server must start up');

    const reportAId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const originalCreatedAt = '2026-11-01T10:00:00.000Z';

    // 1. 利用者A のレポートを保存
    const histDir = path.join(tmpDir, 'history');
    fs.mkdirSync(histDir, { recursive: true });
    fs.writeFileSync(
      path.join(histDir, `${reportAId}.json`),
      JSON.stringify({
        id: reportAId,
        userId: 'user-a',
        title: 'Original Title A',
        theme: 'Original Theme A',
        summary: 'Original Summary A',
        createdAt: originalCreatedAt,
      }),
      'utf8'
    );

    // 2. 利用者A が PATCH で userId を user-b に書き換えようとする
    const patchRes = await fetch(`http://127.0.0.1:${testPort}/api/history/${reportAId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-user-a',
      },
      body: JSON.stringify({
        title: 'Updated Safe Title',
        userId: 'user-b', // 改ざん試行
        id: '99999999-9999-4999-8999-999999999999', // ID改ざん試行
        createdAt: '1999-01-01T00:00:00.000Z', // 作成日時改ざん試行
      }),
    });

    assert.strictEqual(patchRes.status, 200);
    const patchedBody = await patchRes.json();

    // 持ち主 (userId) と id と createdAt が改ざんされていないことの検証
    assert.strictEqual(patchedBody.title, 'Updated Safe Title', 'Title must be updated');
    assert.strictEqual(patchedBody.userId, 'user-a', 'Ownership must NOT be changed to user-b');
    assert.strictEqual(patchedBody.id, reportAId, 'ID must NOT be changed');
    assert.strictEqual(patchedBody.createdAt, originalCreatedAt, 'createdAt must NOT be changed');

    // 保存ファイルの実体も検証
    const saved = JSON.parse(fs.readFileSync(path.join(histDir, `${reportAId}.json`), 'utf8'));
    assert.strictEqual(saved.userId, 'user-a', 'File on disk must retain userId user-a');
    assert.strictEqual(saved.title, 'Updated Safe Title');
  } finally {
    try {
      child.kill('SIGINT');
      if (child.pid) child.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('B-4: Restore reports with conflicting ID cannot overwrite another user report', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-b4-restore-'));
  const testPort = await getFreePort();
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  const child = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      RESEARCH_DATA_DIR: tmpDir,
      ENABLE_TEST_USERS: 'true',
    },
    silent: true,
  });

  try {
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
    assert.ok(started, 'Server must start up');

    const victimReportId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const histDir = path.join(tmpDir, 'history');
    fs.mkdirSync(histDir, { recursive: true });

    // 被害者 User B のレポートをあらかじめ配置
    fs.writeFileSync(
      path.join(histDir, `${victimReportId}.json`),
      JSON.stringify({
        id: victimReportId,
        userId: 'user-b',
        title: 'Victim B Confidential Research',
        summary: 'Secret Content of User B',
        createdAt: '2026-11-02T10:00:00.000Z',
      }),
      'utf8'
    );

    // 悪意のある User A が、被害者 User B のレポートID（victimReportId）を含む復元を要求
    const restoreRes = await fetch(`http://127.0.0.1:${testPort}/api/history/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-user-a',
      },
      body: JSON.stringify({
        reports: [
          {
            id: victimReportId, // 衝突ID
            title: 'Malicious Attacker Overwrite Attempt',
            summary: 'Overwritten Summary',
          },
        ],
      }),
    });

    assert.strictEqual(restoreRes.status, 200);
    const restoreJson = await restoreRes.json();
    assert.strictEqual(restoreJson.ok, true);
    assert.strictEqual(restoreJson.restored, 1);

    // 最重要検証: 被害者 User B のレポートが一切上書き・改ざんされていないこと
    const victimFile = JSON.parse(fs.readFileSync(path.join(histDir, `${victimReportId}.json`), 'utf8'));
    assert.strictEqual(victimFile.userId, 'user-b', 'Victim report userId must remain user-b');
    assert.strictEqual(victimFile.title, 'Victim B Confidential Research', 'Victim title must NOT be overwritten');
    assert.strictEqual(victimFile.summary, 'Secret Content of User B', 'Victim summary must NOT be overwritten');

    // 攻撃者 User A の復元データは新しいUUIDで安全に保存されていること
    const allFiles = fs.readdirSync(histDir);
    assert.strictEqual(allFiles.length, 2, 'There must now be 2 files in total (victim file + new file)');
    const attackerFile = allFiles.find((f) => f !== `${victimReportId}.json`);
    assert.ok(attackerFile, 'Attacker report must be saved under a newly generated UUID');
    const attackerData = JSON.parse(fs.readFileSync(path.join(histDir, attackerFile), 'utf8'));
    assert.strictEqual(attackerData.userId, 'user-a', 'Attacker restored report must belong to user-a');
    assert.strictEqual(attackerData.title, 'Malicious Attacker Overwrite Attempt');
  } finally {
    try {
      child.kill('SIGINT');
      if (child.pid) child.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});

test('B-4: Restore endpoint enforces maximum 50 items and 1MB item size limit', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-b4-limits-'));
  const testPort = await getFreePort();
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  const child = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(testPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      RESEARCH_DATA_DIR: tmpDir,
      ENABLE_TEST_USERS: 'true',
    },
    silent: true,
  });

  try {
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
    assert.ok(started);

    // 1. 51件のレポート配列 ➔ 400 エラー
    const reports51 = Array.from({ length: 51 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `Report ${i}`,
    }));

    const res51 = await fetch(`http://127.0.0.1:${testPort}/api/history/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-user-a',
      },
      body: JSON.stringify({ reports: reports51 }),
    });
    assert.strictEqual(res51.status, 400, 'Payload with >50 reports must be rejected with 400');
    const errJson = await res51.json();
    assert.match(errJson.error, /最大50件/);

    // 2. 1件あたり1MB超過レポート ➔ スキップ
    const hugeReport = {
      id: '12345678-1234-4234-8234-123456789012',
      title: 'Huge Report',
      hugeBlob: 'A'.repeat(1024 * 1024 + 100), // > 1MB
    };

    const normalReport = {
      id: '23456789-2345-4345-8345-234567890123',
      title: 'Normal Report',
    };

    const resHuge = await fetch(`http://127.0.0.1:${testPort}/api/history/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token-user-a',
      },
      body: JSON.stringify({ reports: [hugeReport, normalReport] }),
    });
    assert.strictEqual(resHuge.status, 200);
    const hugeResult = await resHuge.json();
    assert.strictEqual(hugeResult.restored, 1, 'Only normal report must be restored');
    assert.strictEqual(hugeResult.skipped, 1, 'Huge report must be skipped');
  } finally {
    try {
      child.kill('SIGINT');
      if (child.pid) child.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
});


'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('child_process');

const planConfig = require('../server/plan-config');
const quota = require('../server/quota');

test('C-4: plan-config defines plan credits and action credit costs', () => {
  // 月間クレジット
  assert.equal(planConfig.PLAN_CREDITS.free, 3);
  assert.equal(planConfig.PLAN_CREDITS.standard, 30);
  assert.equal(planConfig.PLAN_CREDITS.admin, Infinity);

  // 処理ごとの消費量
  assert.equal(planConfig.getActionCost('research_quick'), 1);
  assert.equal(planConfig.getActionCost('research_deep'), 3);
  assert.equal(planConfig.getActionCost('cross'), 2);
  assert.equal(planConfig.getActionCost('delta'), 2);
  assert.equal(planConfig.getActionCost('slides'), 1);
  assert.equal(planConfig.getActionCost('deepdive'), 0);
});

test('C-4: free plan is restricted to quick research and deepdive only', () => {
  // free は通常リサーチと深掘り対話のみ許可
  assert.equal(planConfig.isActionAllowedForPlan('free', 'research_quick'), true);
  assert.equal(planConfig.isActionAllowedForPlan('free', 'deepdive'), true);

  // 深掘りリサーチ、クロス分析、差分更新、スライド生成は拒否
  assert.equal(planConfig.isActionAllowedForPlan('free', 'research_deep'), false);
  assert.equal(planConfig.isActionAllowedForPlan('free', 'cross'), false);
  assert.equal(planConfig.isActionAllowedForPlan('free', 'delta'), false);
  assert.equal(planConfig.isActionAllowedForPlan('free', 'slides'), false);

  // standard / admin は全許可
  assert.equal(planConfig.isActionAllowedForPlan('standard', 'research_deep'), true);
  assert.equal(planConfig.isActionAllowedForPlan('standard', 'cross'), true);
  assert.equal(planConfig.isActionAllowedForPlan('admin', 'slides'), true);
});

test('C-4: checkActionQuota rejects forbidden actions for free plan with PLAN_FORBIDDEN', async () => {
  const resDeep = await quota.checkActionQuota('user-free-test', 'free', 'research_deep');
  assert.equal(resDeep.allowed, false);
  assert.equal(resDeep.reason, 'PLAN_FORBIDDEN');
  assert.equal(resDeep.cost, 3);

  const resCross = await quota.checkActionQuota('user-free-test', 'free', 'cross');
  assert.equal(resCross.allowed, false);
  assert.equal(resCross.reason, 'PLAN_FORBIDDEN');

  const resQuick = await quota.checkActionQuota('user-free-test', 'free', 'research_quick');
  assert.equal(resQuick.allowed, true);
});

test('C-4: Consuming credits reduces remaining balance by action cost', async () => {
  const userId = `user-credit-calc-${Date.now()}`;
  
  // 初期クォータ取得 (free: 3 クレジット)
  const q0 = await quota.getMonthlyQuota(userId, 'free');
  assert.equal(q0.remaining, 3);

  // 1. 通常リサーチ消費 (コスト 1)
  await quota.consumeActionCredits(userId, 'free', 'research_quick');
  const q1 = await quota.getMonthlyQuota(userId, 'free');
  assert.equal(q1.used, 1);
  assert.equal(q1.remaining, 2);

  // 2. 対話消費 (コスト 0)
  await quota.consumeActionCredits(userId, 'free', 'deepdive');
  const q2 = await quota.getMonthlyQuota(userId, 'free');
  assert.equal(q2.used, 1);
  assert.equal(q2.remaining, 2);

  // 3. 残り2クレジットの状態で、コスト3の処理を行おうとすると CREDIT_EXHAUSTED
  const resExhaust = await quota.checkActionQuota(userId, 'standard', 'research_deep');
  // standard プランで残り2クレジット、必要3クレジット
  // ここでは free だが standard で試算
  // コスト3を消費してみる
  await quota.consumeActionCredits(userId, 'free', 'research_quick'); // 2回目 -> 残り1
  await quota.consumeActionCredits(userId, 'free', 'research_quick'); // 3回目 -> 残り0
  const qEnd = await quota.getMonthlyQuota(userId, 'free');
  assert.equal(qEnd.remaining, 0);

  const resZero = await quota.checkActionQuota(userId, 'free', 'research_quick');
  assert.equal(resZero.allowed, false);
  assert.equal(resZero.reason, 'QUOTA_EXCEEDED');
});

test('C-4: End-to-end HTTP API rejects free plan from invoking advanced features with 403', async () => {
  const testPort = 3968;
  const ROOT = path.join(__dirname, '..');
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(testPort),
      NODE_ENV: 'test',
      ENABLE_AUTH: 'true',
      ENABLE_TEST_USERS: 'true',
      TAVILY_API_KEY: 'test-key',
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  const url = `http://127.0.0.1:${testPort}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  assert.ok(ready, 'Server should start');

  try {
    const tokenFreeUser = 'Bearer test-token-user-a'; // user-a は free プラン

    // 1. free プランで通常リサーチ (depth: quick) ➔ 202 許可
    const resQuick = await fetch(`${url}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenFreeUser,
      },
      body: JSON.stringify({
        theme: 'C-4 通常リサーチテスト',
        depth: 'quick',
        forceMock: true,
      }),
    });
    assert.equal(resQuick.status, 202, 'Free plan quick research should return 202');

    // 2. free プランで深掘りリサーチ (depth: deep) ➔ 403 拒否
    const resDeep = await fetch(`${url}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenFreeUser,
      },
      body: JSON.stringify({
        theme: 'C-4 深掘りリサーチテスト',
        depth: 'deep',
        forceMock: true,
      }),
    });
    assert.equal(resDeep.status, 403, 'Free plan deep research should be blocked with 403');
    const dataDeep = await resDeep.json();
    assert.equal(dataDeep.code, 'PLAN_FORBIDDEN');

    // 3. free プランでクロス分析 ➔ 403 拒否
    const resCross = await fetch(`${url}/api/research/cross-synthesis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenFreeUser,
      },
      body: JSON.stringify({
        reportIds: ['id-1', 'id-2'],
      }),
    });
    assert.equal(resCross.status, 403, 'Free plan cross-synthesis should be blocked with 403');
    const dataCross = await resCross.json();
    assert.equal(dataCross.code, 'PLAN_FORBIDDEN');

    // 4. free プランでスライド生成 ➔ 403 拒否
    const resSlides = await fetch(`${url}/api/presentation/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tokenFreeUser,
      },
      body: JSON.stringify({
        document: 'テスト用資料テキスト',
      }),
    });
    assert.equal(resSlides.status, 403, 'Free plan slides generation should be blocked with 403');
    const dataSlides = await resSlides.json();
    assert.equal(dataSlides.code, 'PLAN_FORBIDDEN');
  } finally {
    child.kill('SIGINT');
  }
});


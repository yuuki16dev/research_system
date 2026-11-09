'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const auth = require('../server/auth');
const history = require('../server/history');

test('user-isolation: auth provides preset test users and validates tokens', async () => {
  // 1. Preset test user accounts
  assert.ok(Array.isArray(auth.PRESET_TEST_USERS), 'PRESET_TEST_USERS must be an array');
  assert.equal(auth.PRESET_TEST_USERS.length, 3);

  // 2. Login User A
  const resA = await auth.loginUser('user-a@test.local', 'password123');
  assert.ok(resA.access_token);
  assert.equal(resA.user.id, 'user-a');
  assert.equal(resA.user.plan, 'free');

  // 3. Login User B
  const resB = await auth.loginUser('user-b@test.local', 'password123');
  assert.ok(resB.access_token);
  assert.equal(resB.user.id, 'user-b');
  assert.equal(resB.user.plan, 'free');

  // 4. Login Admin
  const resAdmin = await auth.loginUser('admin@test.local', 'adminpassword');
  assert.ok(resAdmin.access_token);
  assert.equal(resAdmin.user.id, 'admin-user');
  assert.equal(resAdmin.user.plan, 'admin');

  // 5. Wrong password rejected
  await assert.rejects(async () => {
    await auth.loginUser('user-a@test.local', 'wrongpassword');
  }, /パスワードが正しくありません/);

  // 6. Token verification
  const verifiedA = await auth.verifyToken(resA.access_token);
  assert.ok(verifiedA);
  assert.equal(verifiedA.id, 'user-a');

  const verifiedB = await auth.verifyToken(resB.access_token);
  assert.ok(verifiedB);
  assert.equal(verifiedB.id, 'user-b');

  const invalidUser = await auth.verifyToken('invalid-token');
  assert.equal(invalidUser, null);
});

test('user-isolation: history list, get, and delete are isolated between users', () => {
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';

  // Save report for user-a
  history.save({
    id: idA,
    title: 'User A Report',
    theme: 'User A Report',
    userId: 'user-a',
    createdAt: new Date().toISOString(),
  });

  // Save report for user-b
  history.save({
    id: idB,
    title: 'User B Report',
    theme: 'User B Report',
    userId: 'user-b',
    createdAt: new Date().toISOString(),
  });

  try {
    // User A can only see their own report
    const listA = history.list('user-a', 'free');
    const idsA = listA.map((r) => r.id);
    assert.ok(idsA.includes(idA), 'User A should see report A');
    assert.ok(!idsA.includes(idB), 'User A must NOT see report B');

    // User B can only see their own report
    const listB = history.list('user-b', 'free');
    const idsB = listB.map((r) => r.id);
    assert.ok(idsB.includes(idB), 'User B should see report B');
    assert.ok(!idsB.includes(idA), 'User B must NOT see report A');

    // Admin can see both reports
    const listAdmin = history.list('admin-user', 'admin');
    const idsAdmin = listAdmin.map((r) => r.id);
    assert.ok(idsAdmin.includes(idA), 'Admin should see report A');
    assert.ok(idsAdmin.includes(idB), 'Admin should see report B');

    // User B cannot get User A's report directly
    const getReportAByUserB = history.get(idA, 'user-b', 'free');
    assert.equal(getReportAByUserB, null, 'User B must not be able to get report A');

    // User A can get User A's report directly
    const getReportAByUserA = history.get(idA, 'user-a', 'free');
    assert.ok(getReportAByUserA, 'User A should be able to get report A');
    assert.equal(getReportAByUserA.id, idA);

    // User B cannot delete User A's report
    const deleteAttemptByB = history.remove(idA, 'user-b', 'free');
    assert.equal(deleteAttemptByB, false, 'User B cannot delete User A report');

    // User A can delete their own report
    const deleteByA = history.remove(idA, 'user-a', 'free');
    assert.equal(deleteByA, true, 'User A can delete their own report');
  } finally {
    // Cleanup
    history.remove(idA, null, 'admin');
    history.remove(idB, null, 'admin');
  }
});

test('user-isolation: UI includes test account quick buttons and switch button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  // Quick test user buttons
  assert.ok(html.includes('data-email="user-a@test.local"'), 'Must have user-a button');
  assert.ok(html.includes('data-email="user-b@test.local"'), 'Must have user-b button');
  assert.ok(html.includes('data-email="admin@test.local"'), 'Must have admin button');

  // Account switch button
  assert.ok(html.includes('id="btn-account-switch"'), 'Must have btn-account-switch in account modal');
});

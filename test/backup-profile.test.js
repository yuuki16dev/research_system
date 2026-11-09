'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const profile = require('../server/profile');
const history = require('../server/history');

test('profile: getProfile returns default profile when non-existent', () => {
  const prof = profile.getProfile('test-user-non-existent');
  assert.equal(prof.displayName, '');
  assert.equal(prof.avatar, '👤');
  assert.equal(prof.defaultPurpose, 'general');
});

test('profile: updateProfile saves and returns updated profile data', () => {
  const uid = 'test-profile-user-1';
  const updated = profile.updateProfile(uid, {
    displayName: '田中 調査役',
    avatar: '🧑‍💻',
    defaultPurpose: 'tech',
  });

  assert.equal(updated.displayName, '田中 調査役');
  assert.equal(updated.avatar, '🧑‍💻');
  assert.equal(updated.defaultPurpose, 'tech');

  const loaded = profile.getProfile(uid);
  assert.equal(loaded.displayName, '田中 調査役');
  assert.equal(loaded.avatar, '🧑‍💻');
  assert.equal(loaded.defaultPurpose, 'tech');
});

test('history: getAllForUser and restoreReports handle full report lifecycle', () => {
  const uidA = 'user-backup-test-a';
  const uidB = 'user-backup-test-b';
  const id1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const id2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  // レポート作成
  history.save({
    id: id1,
    title: 'Report 1 for A',
    theme: 'Report 1 for A',
    userId: uidA,
    createdAt: new Date().toISOString(),
    summary: 'Summary 1',
  });

  history.save({
    id: id2,
    title: 'Report 2 for A',
    theme: 'Report 2 for A',
    userId: uidA,
    createdAt: new Date().toISOString(),
    summary: 'Summary 2',
  });

  // Aの全件取得
  const allA = history.getAllForUser(uidA, 'free');
  assert.equal(allA.length, 2);
  assert.ok(allA.some((r) => r.id === id1));
  assert.ok(allA.some((r) => r.id === id2));

  // Bの全件取得（空のはず）
  const allB = history.getAllForUser(uidB, 'free');
  assert.equal(allB.length, 0);

  // AのレポートをBに復元（リストア）
  const restoreRes = history.restoreReports(allA, uidB);
  assert.equal(restoreRes.restored, 2);
  assert.equal(restoreRes.skipped, 0);

  // Bで取得できることを確認
  const restoredB = history.getAllForUser(uidB, 'free');
  assert.equal(restoredB.length, 2);
  assert.equal(restoredB[0].userId, uidB);

  // クリーンアップ
  history.remove(id1, null, 'admin');
  history.remove(id2, null, 'admin');
});

test('profile & backup: API endpoints work with authentication', async () => {
  const auth = require('../server/auth');
  const loginRes = await auth.loginUser('user-a@test.local', 'password123');
  assert.ok(loginRes.access_token);
  assert.equal(loginRes.user.id, 'user-a');

  // プロフィール更新
  const updateRes = profile.updateProfile('user-a', {
    displayName: 'テストユーザーA',
    avatar: '🚀',
  });
  assert.equal(updateRes.displayName, 'テストユーザーA');
  assert.equal(updateRes.avatar, '🚀');

  const fetchedProf = profile.getProfile('user-a');
  assert.equal(fetchedProf.displayName, 'テストユーザーA');
  assert.equal(fetchedProf.avatar, '🚀');
});

test('profile & backup: DOM consistency in public/index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="profile-display-name"'), 'index.html must have #profile-display-name');
  assert.ok(html.includes('id="profile-avatar-selector"'), 'index.html must have #profile-avatar-selector');
  assert.ok(html.includes('id="btn-save-profile"'), 'index.html must have #btn-save-profile');
  assert.ok(html.includes('id="btn-backup-history"'), 'index.html must have #btn-backup-history');
  assert.ok(html.includes('id="input-restore-file"'), 'index.html must have #input-restore-file');
  assert.ok(html.includes('id="btn-history-backup-quick"'), 'index.html must have #btn-history-backup-quick');
  assert.ok(html.includes('id="user-avatar-badge"'), 'index.html must have #user-avatar-badge');
  assert.ok(html.includes('id="user-name-badge"'), 'index.html must have #user-name-badge');
  assert.ok(html.includes('id="drawer-tag-filter-bar"'), 'index.html must have #drawer-tag-filter-bar');
  assert.ok(html.includes('id="home-tag-filter-bar"'), 'index.html must have #home-tag-filter-bar');
});

test('history tags & search: normalizeResult derives default tags and supports filtering', () => {
  const util = require('../server/util');
  const resTech = util.normalizeResult({}, { purpose: 'tech' });
  assert.ok(resTech.tags.includes('技術調査'));

  const resDecision = util.normalizeResult({}, { purpose: 'decision' });
  assert.ok(resDecision.tags.includes('意思決定'));

  const resRisk = util.normalizeResult({}, { purpose: 'risk' });
  assert.ok(resRisk.tags.includes('リスク・課題'));

  const resCross = util.normalizeResult({}, { isCrossSynthesis: true });
  assert.ok(resCross.tags.includes('クロス統合'));
});



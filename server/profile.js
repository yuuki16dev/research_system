'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');

const DIR = path.join(DATA_DIR, 'profiles');

/**
 * ユーザープロフィールの取得
 * @param {string} userId
 */
function getProfile(userId = 'owner-user') {
  const uid = userId || 'owner-user';
  const file = path.join(DIR, `${uid}.json`);
  if (!fs.existsSync(file)) {
    return {
      userId: uid,
      displayName: '',
      avatar: '👤',
      defaultPurpose: 'general',
      defaultTheme: 'corporate-blue',
      updatedAt: null,
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      userId: uid,
      displayName: typeof data.displayName === 'string' ? data.displayName : '',
      avatar: typeof data.avatar === 'string' ? data.avatar : '👤',
      defaultPurpose: typeof data.defaultPurpose === 'string' ? data.defaultPurpose : 'general',
      defaultTheme: typeof data.defaultTheme === 'string' ? data.defaultTheme : 'corporate-blue',
      updatedAt: data.updatedAt || null,
    };
  } catch {
    return {
      userId: uid,
      displayName: '',
      avatar: '👤',
      defaultPurpose: 'general',
      defaultTheme: 'corporate-blue',
      updatedAt: null,
    };
  }
}

/**
 * ユーザープロフィールの更新
 * @param {string} userId
 * @param {Object} patch
 */
function updateProfile(userId = 'owner-user', patch = {}) {
  const uid = userId || 'owner-user';
  fs.mkdirSync(DIR, { recursive: true });
  const current = getProfile(uid);
  const updated = {
    ...current,
    displayName: typeof patch.displayName === 'string' ? patch.displayName.trim().slice(0, 50) : current.displayName,
    avatar: typeof patch.avatar === 'string' ? patch.avatar.trim().slice(0, 10) : current.avatar,
    defaultPurpose: typeof patch.defaultPurpose === 'string' ? patch.defaultPurpose : current.defaultPurpose,
    defaultTheme: typeof patch.defaultTheme === 'string' ? patch.defaultTheme : current.defaultTheme,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DIR, `${uid}.json`), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

module.exports = {
  getProfile,
  updateProfile,
};


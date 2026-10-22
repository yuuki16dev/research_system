'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./settings');

const DIR = path.join(DATA_DIR, 'history');
const MAX_ITEMS = 100;
const isId = (id) => /^[0-9a-f-]{36}$/i.test(id);

function save(result) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${result.id}.json`), JSON.stringify(result), 'utf8');
  prune();
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
        return {
          id: r.id,
          theme: r.theme,
          title: r.title,
          createdAt: r.createdAt,
          mode: r.mode,
          depth: r.depth,
          scope: r.scope,
          scopeLabel: r.scopeLabel,
          period: r.period || 'year',
          periodLabel: r.periodLabel || '直近1年',
          sourceCount: (r.sources || []).length,
          pinned: !!r.pinned,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
}

function get(id) {
  if (!isId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

function remove(id) {
  if (!isId(id)) return false;
  try {
    fs.unlinkSync(path.join(DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

function update(id, patch) {
  const item = get(id);
  if (!item) return null;
  const updated = { ...item, ...patch };
  save(updated);
  return updated;
}

function togglePin(id) {
  const item = get(id);
  if (!item) return null;
  item.pinned = !item.pinned;
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(item), 'utf8');
  return item;
}

function prune() {
  const items = list();
  items.slice(MAX_ITEMS).forEach((x) => remove(x.id));
}

module.exports = { save, list, get, remove, update, togglePin };


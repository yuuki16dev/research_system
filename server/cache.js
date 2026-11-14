'use strict';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 合計 50MB 上限
const DEFAULT_MAX_ENTRIES = 5000;

function estimateBytes(value) {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(serialized || 'null', 'utf8');
  } catch {
    return 1024;
  }
}

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value;
  }
  return structuredClone(value);
}

/**
 * 有効期限（既定24時間）・総サイズ上限（既定50MB）・件数上限つきインメモリ LRU キャッシュ
 */
class MemoryLruCache {
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
    now = () => Date.now(),
  } = {}) {
    this.ttlMs = ttlMs;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
    this.totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  _deleteEntry(key) {
    const existing = this.entries.get(key);
    if (!existing) return false;
    this.totalBytes = Math.max(0, this.totalBytes - existing.sizeBytes);
    return this.entries.delete(key);
  }

  pruneExpired(currentTime = this.now()) {
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= currentTime) {
        this._deleteEntry(key);
        removed += 1;
      }
    }
    return removed;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    const currentTime = this.now();
    if (entry.expiresAt <= currentTime) {
      this._deleteEntry(key);
      this.misses += 1;
      return undefined;
    }

    // LRU 順更新のため再挿入（Map の末尾が最新）
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return cloneValue(entry.value);
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (!key) return false;
    const stored = cloneValue(value);
    const sizeBytes = estimateBytes(stored);

    // 1エントリだけで上限を超える場合は他を全削除しないよう保存しない
    if (sizeBytes > this.maxBytes || this.maxEntries <= 0) {
      return false;
    }

    const currentTime = this.now();
    this._deleteEntry(key);
    this.pruneExpired(currentTime);

    while (
      this.entries.size > 0 &&
      (this.totalBytes + sizeBytes > this.maxBytes || this.entries.size >= this.maxEntries)
    ) {
      const oldestKey = this.entries.keys().next().value;
      this._deleteEntry(oldestKey);
    }

    this.entries.set(key, {
      value: stored,
      sizeBytes,
      expiresAt: currentTime + ttlMs,
    });
    this.totalBytes += sizeBytes;
    return true;
  }

  has(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this._deleteEntry(key);
      return false;
    }
    return true;
  }

  delete(key) {
    return this._deleteEntry(key);
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    this.pruneExpired();
    return {
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

const sharedCache = new MemoryLruCache();

function buildTavilyCacheKey({ query, maxResults = 5, includeDomains, deep, timeRange, startDate, endDate }) {
  const domains = Array.isArray(includeDomains) && includeDomains.length
    ? [...includeDomains].map(String).sort()
    : [];
  return 'tavily:' + JSON.stringify({
    query: String(query || '').trim(),
    maxResults: Number(maxResults) || 5,
    deep: Boolean(deep),
    includeDomains: domains,
    timeRange: timeRange || null,
    startDate: startDate || null,
    endDate: endDate || null,
  });
}

function buildPageCacheKey(url) {
  return `page:${String(url || '').trim()}`;
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  MemoryLruCache,
  sharedCache,
  buildTavilyCacheKey,
  buildPageCacheKey,
};


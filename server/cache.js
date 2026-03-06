/**
 * In-memory cache with TTL for VAK API responses.
 * Reduces API calls when users select the same country + operator.
 */

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMinutes) {
  const ttlMs = Math.max(1, Number(ttlMinutes) || 5) * 60 * 1000;
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function clear() {
  store.clear();
}

module.exports = { get, set, clear };

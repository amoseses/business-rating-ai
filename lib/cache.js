/**
 * Response caching module.
 * Provides in-memory cache for analysis results to speed up repeated requests.
 * Cache entries expire after a configurable TTL.
 */

/**
 * Simple in-memory cache with TTL expiration.
 */
class MemoryCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 5 * 60 * 1000; // 5 minutes default
    this.maxSize = options.maxSize || 100; // Max entries
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get a value from cache.
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache.
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} [ttlMs] - Optional custom TTL in ms
   */
  set(key, value, ttlMs) {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || this.ttlMs)
    });
  }

  /**
   * Check if key exists and is not expired.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key from cache.
   * @param {string} key
   */
  delete(key) {
    this.store.delete(key);
  }

  /**
   * Clear the entire cache.
   */
  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   * @returns {object} { size, hits, misses, hitRate }
   */
  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0
    };
  }

  /**
   * Generate a cache key from request parameters.
   * @param {string} pitch - Pitch text
   * @param {string} plan - Plan name
   * @returns {string} Cache key
   */
  static makeKey(pitch, plan) {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update((pitch || '').trim().toLowerCase()).digest('hex');
    return `analyze:${plan || 'data'}:${hash}`;
  }
}

// Global cache instance for analysis results
const analysisCache = new MemoryCache({ ttlMs: 10 * 60 * 1000, maxSize: 200 });

module.exports = {
  MemoryCache,
  analysisCache
};
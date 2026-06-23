/**
 * Backup and security module.
 * Provides data export, rate limiting, input sanitization, and security utilities.
 */
const crypto = require('crypto');

/**
 * Rate limiter using an in-memory store.
 * Tracks request counts per key (e.g. IP or email) within a time window.
 * Note: For production, use a distributed store like Redis or Supabase.
 */
class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute default
    this.maxRequests = options.maxRequests || 30; // 30 requests per window default
    this.store = new Map();
  }

  /**
   * Check if a key is rate limited.
   * @param {string} key - Identifier (IP, email, etc.)
   * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
   */
  check(key) {
    const now = Date.now();
    const record = this.store.get(key);

    if (!record || now > record.resetTime) {
      // New window
      this.store.set(key, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return { allowed: true, remaining: this.maxRequests - 1, resetTime: now + this.windowMs };
    }

    if (record.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetTime: record.resetTime };
    }

    record.count++;
    return { allowed: true, remaining: this.maxRequests - record.count, resetTime: record.resetTime };
  }

  /**
   * Middleware-style wrapper for API handlers.
   * @param {Function} handler - The API handler
   * @param {object} options
   * @param {string} [options.keySource] - 'ip' | 'email' | 'body'
   * @returns {Function}
   */
  middleware(handler, { keySource = 'ip' } = {}) {
    return (req, res) => {
      let key;
      if (keySource === 'email') {
        key = req.body?.email || req.ip || 'unknown';
      } else if (keySource === 'body') {
        key = JSON.stringify(req.body || {});
      } else {
        key = req.headers['x-forwarded-for'] || req.ip || 'unknown';
      }

      const result = this.check(key);
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetTime);

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Too many requests. Please wait before trying again.',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }

      return handler(req, res);
    };
  }

  /** Clean up expired entries */
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

// Global rate limiter instances
const analysisRateLimiter = new RateLimiter({ windowMs: 60 * 1000, maxRequests: 20 });
const authRateLimiter = new RateLimiter({ windowMs: 60 * 1000, maxRequests: 10 });
const apiRateLimiter = new RateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });

// Clean up expired entries every 5 minutes
setInterval(() => {
  analysisRateLimiter.cleanup();
  authRateLimiter.cleanup();
  apiRateLimiter.cleanup();
}, 5 * 60 * 1000);

/**
 * Sanitize user input to prevent injection attacks.
 * @param {string} input - Raw user input
 * @returns {string} Sanitized string
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/[\\$`]/g, '') // Remove shell metacharacters
    .trim();
}

/**
 * Sanitize an object's string fields recursively.
 * @param {object} obj - Object to sanitize
 * @returns {object} Sanitized object
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Export analysis data as JSON for backup.
 * @param {Array} analyses - Array of analysis result objects
 * @returns {string} JSON string
 */
function exportAnalysesAsJson(analyses) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: '1.0.0',
    count: analyses.length,
    analyses
  }, null, 2);
}

/**
 * Generate a secure random API key.
 * @param {number} [bytes=32] - Number of random bytes
 * @returns {string} Hex-encoded key
 */
function generateApiKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Hash an API key for storage (never store raw keys).
 * @param {string} apiKey - The raw API key
 * @returns {string} SHA-256 hash
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Validate that required environment variables are set.
 * @param {Array<string>} requiredVars - List of required env var names
 * @returns {object} { valid: boolean, missing: string[] }
 */
function validateEnvVars(requiredVars) {
  const missing = requiredVars.filter(name => !process.env[name]);
  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Create a content security policy string.
 * @returns {string} CSP header value
 */
function getCSPString() {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.stripe.com https://*.supabase.co",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "form-action 'self'"
  ].join('; ');
}

module.exports = {
  RateLimiter,
  analysisRateLimiter,
  authRateLimiter,
  apiRateLimiter,
  sanitizeInput,
  sanitizeObject,
  exportAnalysesAsJson,
  generateApiKey,
  hashApiKey,
  validateEnvVars,
  getCSPString
};
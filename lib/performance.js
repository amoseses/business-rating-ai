/**
 * Performance monitoring module.
 * Tracks API response times and logs to Supabase `performance_metrics` table.
 * Provides middleware-style wrapper for timing API handlers.
 */
const { getSupabase } = require('./supabase');

/**
 * Wrap an API handler with performance timing and logging.
 * @param {Function} handler - The async API handler function
 * @param {object} options
 * @param {string} options.endpointName - Name for this endpoint
 * @returns {Function} Wrapped handler that tracks timing
 */
function withPerformanceTracking(handler, { endpointName } = {}) {
  return async (req, res) => {
    const start = Date.now();
    const method = req.method || 'GET';

    // Wrap res.json and res.end to capture the response
    const originalJson = res.json.bind(res);
    const originalEnd = res.end.bind(res);
    let statusCode = 200;

    res.json = function (body) {
      statusCode = res.statusCode || 200;
      recordMetrics({
        endpoint: endpointName || req.url,
        method,
        responseTimeMs: Date.now() - start,
        statusCode,
        userEmail: req.body ? req.body.email : undefined
      });
      return originalJson(body);
    };

    res.end = function () {
      statusCode = res.statusCode || 200;
      recordMetrics({
        endpoint: endpointName || req.url,
        method,
        responseTimeMs: Date.now() - start,
        statusCode,
        userEmail: req.body ? req.body.email : undefined
      });
      return originalEnd.apply(this, arguments);
    };

    try {
      return await handler(req, res);
    } catch (error) {
      statusCode = error.statusCode || error.status || 500;
      recordMetrics({
        endpoint: endpointName || req.url,
        method,
        responseTimeMs: Date.now() - start,
        statusCode,
        userEmail: req.body ? req.body.email : undefined
      });
      throw error;
    }
  };
}

/**
 * Record a performance metric entry.
 * @param {object} params
 * @param {string} params.endpoint
 * @param {string} params.method
 * @param {number} params.responseTimeMs
 * @param {number} params.statusCode
 * @param {string} [params.userEmail]
 * @returns {Promise<boolean>}
 */
async function recordMetrics({ endpoint, method, responseTimeMs, statusCode, userEmail }) {
  // Skip recording if response time is 0 (likely a mock/test scenario)
  if (!endpoint) return false;

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('performance_metrics')
      .insert([{
        endpoint,
        method: method || 'GET',
        response_time_ms: responseTimeMs,
        status_code: statusCode || 200,
        user_email: userEmail || null
      }]);

    if (error) {
      console.warn('[Performance] Failed to record metric:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    // Silently fail - don't let monitoring break the app
    return false;
  }
}

/**
 * Get performance summary statistics.
 * @param {object} params
 * @param {string} [params.endpoint] - Filter by endpoint
 * @param {number} [params.minutes] - Lookback window in minutes
 * @returns {Promise<object>} Summary with avg, p50, p95, p99 response times
 */
async function getPerformanceSummary({ endpoint, minutes = 60 } = {}) {
  try {
    const supabase = getSupabase();
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    let query = supabase
      .from('performance_metrics')
      .select('response_time_ms')
      .gte('created_at', since);

    if (endpoint) {
      query = query.eq('endpoint', endpoint);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return { avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
    }

    const times = data.map(r => r.response_time_ms).sort((a, b) => a - b);
    const n = times.length;

    return {
      avg: Math.round(times.reduce((a, b) => a + b, 0) / n),
      p50: times[Math.floor(n * 0.5)],
      p95: times[Math.floor(n * 0.95)],
      p99: times[Math.floor(n * 0.99)],
      count: n
    };
  } catch (err) {
    console.warn('[Performance] Failed to get summary:', err.message);
    return { avg: 0, p50: 0, p95: 0, p99: 0, count: 0 };
  }
}

module.exports = {
  withPerformanceTracking,
  recordMetrics,
  getPerformanceSummary
};
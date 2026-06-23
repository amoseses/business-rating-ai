/**
 * Analytics event API endpoint.
 * POST /api/analytics - Track a client-side event
 * GET /api/analytics - Get analytics summary (admin, requires auth)
 */
const { trackEvent, trackPageView, generateSessionId } = require('../lib/analytics');
const { requireAuth } = require('./auth-helpers');
const { sendError } = require('./stripe-helpers');
const { sanitizeInput } = require('../lib/backup');

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    return handleTrackEvent(req, res);
  }
  if (req.method === 'GET') {
    return handleGetAnalytics(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

/**
 * POST handler: Track a client-side event.
 * Body: { eventName, userEmail?, sessionId?, properties?, pageUrl?, userAgent?, ipAddress? }
 */
async function handleTrackEvent(req, res) {
  try {
    const { eventName, userEmail, sessionId, properties, pageUrl, userAgent } = req.body || {};

    if (!eventName || typeof eventName !== 'string') {
      return res.status(400).json({ error: 'eventName is required' });
    }

    const result = await trackEvent({
      eventName: sanitizeInput(eventName),
      userEmail: userEmail ? sanitizeInput(userEmail) : undefined,
      sessionId: sessionId || generateSessionId(),
      properties: properties || {},
      pageUrl: pageUrl ? sanitizeInput(pageUrl) : undefined,
      userAgent: userAgent || req.headers['user-agent'],
      ipAddress: req.headers['x-forwarded-for'] || req.ip
    });

    return res.status(result ? 200 : 202).json({
      success: result,
      sessionId: sessionId || null
    });
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * GET handler: Get analytics summary (requires admin auth).
 * This is a simple endpoint; for full admin panel use /api/admin/analytics-summary
 */
async function handleGetAnalytics(req, res) {
  try {
    // Require admin authentication (check for auth header)
    const authHeader = req.headers.authorization || '';
    const adminToken = (process.env.ADMIN_API_KEY || '').trim();

    if (!adminToken || authHeader !== `Bearer ${adminToken}`) {
      return res.status(401).json({ error: 'Unauthorized. Use Admin API key.' });
    }

    // Return basic stats from Supabase
    const supabase = require('../lib/supabase').getSupabase();
    const [eventsResult, errorsResult, perfResult] = await Promise.all([
      supabase.from('analytics_events').select('*', { count: 'exact', head: true }),
      supabase.from('error_logs').select('*', { count: 'exact', head: true }).eq('resolved', false),
      supabase.from('performance_metrics').select('response_time_ms').limit(100)
    ]);

    const perfTimes = (perfResult.data || []).map(r => r.response_time_ms).sort((a, b) => a - b);
    const n = perfTimes.length;

    return res.status(200).json({
      totalEvents: eventsResult.count || 0,
      unresolvedErrors: errorsResult.count || 0,
      performance: n > 0 ? {
        avg: Math.round(perfTimes.reduce((a, b) => a + b, 0) / n),
        p95: perfTimes[Math.floor(n * 0.95)] || 0,
        count: n
      } : { avg: 0, p95: 0, count: 0 }
    });
  } catch (error) {
    return sendError(res, error);
  }
}
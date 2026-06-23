/**
 * Admin analytics summary endpoint.
 * Provides a comprehensive dashboard view of all monitoring data.
 * Protected by ADMIN_API_KEY environment variable.
 */
const { getSupabase, isSupabaseConfigured } = require('../../lib/supabase');
const { getPerformanceSummary } = require('../../lib/performance');
const { getEvaluationHistory, getLatestEvaluationSummary } = require('../../lib/evaluations');
const { getSetupStatus } = require('../stripe-helpers');
const { sendError } = require('../stripe-helpers');

function requireAdmin(req) {
  const adminToken = (process.env.ADMIN_API_KEY || '').trim();
  if (!adminToken) {
    if (process.env.VERCEL_ENV === 'production') {
      const error = new Error('Admin API key not configured. Set ADMIN_API_KEY env var.');
      error.statusCode = 500;
      throw error;
    }
    return; // Allow in dev
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${adminToken}`) {
    const error = new Error('Unauthorized. Provide ADMIN_API_KEY as Bearer token.');
    error.statusCode = 401;
    throw error;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    requireAdmin(req);
  } catch (error) {
    return sendError(res, error);
  }

  try {
    const supabaseConfigured = isSupabaseConfigured();

    // Gather all dashboard data in parallel
    const dashboard = {
      timestamp: new Date().toISOString(),
      setup: getSetupStatus(),
      supabaseConfigured,
      supabase: supabaseConfigured ? await getSupabaseMetrics() : { status: 'not_configured' },
      performance: await getPerformanceSummary({ minutes: 60 }),
      evaluations: await getLatestEvaluationSummary(),
      errors: await getErrorSummary(),
      userStats: supabaseConfigured ? await getUserStats() : { status: 'not_configured' }
    };

    return res.status(200).json(dashboard);
  } catch (error) {
    return sendError(res, error);
  }
};

async function getSupabaseMetrics() {
  try {
    const supabase = getSupabase();

    const [eventsCount, errorsCount, perfCount, evalCount] = await Promise.all([
      supabase.from('analytics_events').select('*', { count: 'exact', head: true }),
      supabase.from('error_logs').select('*', { count: 'exact', head: true }),
      supabase.from('performance_metrics').select('*', { count: 'exact', head: true }),
      supabase.from('evaluation_results').select('*', { count: 'exact', head: true })
    ]);

    return {
      totalEvents: eventsCount.count || 0,
      totalErrors: errorsCount.count || 0,
      totalPerformanceMetrics: perfCount.count || 0,
      totalEvaluations: evalCount.count || 0
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

async function getErrorSummary() {
  try {
    if (!isSupabaseConfigured()) {
      return { total: 0, unresolved: 0, byType: {} };
    }

    const supabase = getSupabase();

    // Get recent errors
    const { data: recentErrors } = await supabase
      .from('error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!recentErrors) {
      return { total: 0, unresolved: 0, byType: {} };
    }

    // Categorize by type
    const byType = {};
    let unresolved = 0;
    let critical = 0;

    for (const err of recentErrors) {
      const type = err.error_type || 'unknown';
      if (!byType[type]) byType[type] = 0;
      byType[type]++;
      if (!err.resolved) unresolved++;
      if (err.severity === 'critical') critical++;
    }

    return {
      total: recentErrors.length,
      unresolved,
      critical,
      byType,
      recentErrors: recentErrors.slice(0, 10)
    };
  } catch (err) {
    return { total: 0, unresolved: 0, byType: {}, error: err.message };
  }
}

async function getUserStats() {
  try {
    const supabase = getSupabase();

    // Get unique users from analytics events
    const { data: events } = await supabase
      .from('analytics_events')
      .select('user_email')
      .not('user_email', 'is', null)
      .limit(1000);

    const uniqueUsers = events ? [...new Set(events.map(e => e.user_email))] : [];

    // Get recent analysis counts
    const { data: analyses } = await supabase
      .from('analysis_results')
      .select('score, plan, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    const totalAnalyses = analyses ? analyses.length : 0;
    const avgScore = analyses && analyses.length > 0
      ? Math.round(analyses.reduce((sum, a) => sum + a.score, 0) / analyses.length)
      : 0;

    return {
      uniqueUsers: uniqueUsers.length,
      totalAnalyses,
      averageScore: avgScore
    };
  } catch (err) {
    return { error: err.message };
  }
}
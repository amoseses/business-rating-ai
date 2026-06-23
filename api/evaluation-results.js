/**
 * Evaluation results API endpoint.
 * GET /api/evaluation-results - Get evaluation history and summary
 * DELETE /api/evaluation-results - Clear evaluation history (admin only)
 */
const { getEvaluationHistory, getLatestEvaluationSummary } = require('../lib/evaluations');
const { getSupabase } = require('../lib/supabase');
const { sendError } = require('./stripe-helpers');

function requireAdmin(req) {
  const adminToken = (process.env.ADMIN_API_KEY || '').trim();
  if (!adminToken) {
    if (process.env.VERCEL_ENV === 'production') {
      const error = new Error('Admin API key not configured.');
      error.statusCode = 500;
      throw error;
    }
    return;
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${adminToken}`) {
    const error = new Error('Unauthorized.');
    error.statusCode = 401;
    throw error;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return handleGetResults(req, res);
  }
  if (req.method === 'DELETE') {
    return handleClearResults(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleGetResults(req, res) {
  try {
    requireAdmin(req);
  } catch (error) {
    return sendError(res, error);
  }

  try {
    const { limit, onlyFailed, pitchType } = req.query || {};

    // Get history with optional filters
    const history = await getEvaluationHistory({
      limit: parseInt(limit) || 100,
      onlyFailed: onlyFailed === 'true'
    });

    // Filter by pitch type if specified
    const filtered = pitchType
      ? history.filter(r => r.pitch_type === pitchType)
      : history;

    // Get summary
    const summary = await getLatestEvaluationSummary();

    // Calculate per-pitch-type stats
    const byType = {};
    for (const result of filtered) {
      const type = result.pitch_type || 'unknown';
      if (!byType[type]) {
        byType[type] = { total: 0, passed: 0, scores: [], times: [] };
      }
      byType[type].total++;
      if (result.passed) byType[type].passed++;
      byType[type].scores.push(result.actual_score);
      byType[type].times.push(result.execution_time_ms);
    }

    // Add averages to per-type stats
    for (const [type, stats] of Object.entries(byType)) {
      stats.averageScore = Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length);
      stats.averageTime = Math.round(stats.times.reduce((a, b) => a + b, 0) / stats.times.length);
      stats.passRate = Math.round((stats.passed / stats.total) * 100);
      delete stats.scores;
      delete stats.times;
    }

    return res.status(200).json({
      summary,
      byType,
      results: filtered.slice(0, 50),
      totalResults: filtered.length
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function handleClearResults(req, res) {
  try {
    requireAdmin(req);
  } catch (error) {
    return sendError(res, error);
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('evaluation_results')
      .delete()
      .neq('id', 0); // Delete all

    if (error) {
      return res.status(500).json({ error: 'Failed to clear results' });
    }

    return res.status(200).json({ success: true, message: 'Evaluation history cleared.' });
  } catch (error) {
    return sendError(res, error);
  }
}
const path = require('path');
const fs = require('fs');
const { getEvaluationHistory, getLatestEvaluationSummary, TEST_PITCHES } = require('../lib/evaluations');
const { getSupabase } = require('../lib/supabase');
const { sendError } = require('./stripe-helpers');

function requireAdmin(req) {
  const adminToken = (process.env.ADMIN_API_KEY || '').trim();
  if (!adminToken) {
    if (process.env.VERCEL_ENV === 'production') {
      const error = new Error('Admin API key not configured. Set ADMIN_API_KEY environment variable.');
      error.statusCode = 500;
      throw error;
    }
    return;
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${adminToken}`) {
    const error = new Error('Unauthorized. Provide valid Admin API key.');
    error.statusCode = 401;
    throw error;
  }
}

function serveAdminPage(req, res) {
  try {
    const htmlPath = path.join(__dirname, '..', 'admin.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    return sendError(res, error);
  }
}

async function safeQuery(label, query, fallback = { data: [], count: 0 }) {
  try {
    const result = await query;
    if (result?.error) {
      console.warn(`[Admin] ${label} unavailable:`, result.error.message || result.error);
      return fallback;
    }
    return result || fallback;
  } catch (error) {
    console.warn(`[Admin] ${label} unavailable:`, error.message);
    return fallback;
  }
}

async function getUserCount(supabase) {
  const listUsers = supabase?.auth?.admin?.listUsers;
  if (typeof listUsers !== 'function') return 0;
  const result = await safeQuery('users', listUsers.call(supabase.auth.admin, { page: 1, perPage: 1 }), { data: { users: [] } });
  return result?.data?.total || result?.data?.users?.length || 0;
}

async function handleAnalyticsSummary(req, res) {
  try { requireAdmin(req); } catch (error) { return sendError(res, error); }
  try {
    const supabase = getSupabase();
    const [eventsResult, errorsResult, perfResult, totalUsers] = await Promise.all([
      safeQuery('analytics events', supabase.from('analytics_events').select('*', { count: 'exact', head: true })),
      safeQuery('error logs', supabase.from('error_logs').select('*', { count: 'exact', head: true }).eq('resolved', false)),
      safeQuery('performance metrics', supabase.from('performance_metrics').select('response_time_ms').limit(100)),
      getUserCount(supabase)
    ]);
    const perfTimes = (perfResult.data || []).map(r => Number(r.response_time_ms)).filter(Number.isFinite).sort((a, b) => a - b);
    const n = perfTimes.length;
    return res.status(200).json({
      totalEvents: eventsResult.count || 0,
      unresolvedErrors: errorsResult.count || 0,
      totalUsers,
      activeSessions: 0,
      performance: n > 0 ? { avg: Math.round(perfTimes.reduce((a, b) => a + b, 0) / n), p95: perfTimes[Math.min(Math.ceil(n * 0.95) - 1, n - 1)] || 0, count: n } : { avg: 0, p95: 0, count: 0 }
    });
  } catch (error) { return sendError(res, error); }
}

async function handleEvaluateRun(req, res) {
  try { requireAdmin(req); } catch (error) { return sendError(res, error); }
  try {
    const { type, pitchText, expectedScoreMin, expectedScoreMax, plan, pitchTypes } = req.body || {};
    const { runEvaluationSuite, runSingleEvaluation } = require('../lib/evaluations');
    if (type === 'single' && pitchText) {
      const result = await runSingleEvaluation(req.body.testName || 'manual_test', pitchText, expectedScoreMin || 1, expectedScoreMax || 99, plan || 'data');
      return res.status(200).json({ type: 'single', result, testPitches: Object.keys(TEST_PITCHES) });
    }
    const { results, summary } = await runEvaluationSuite({ plan: plan || 'data', persist: true, pitchTypes });
    return res.status(200).json({ type: 'suite', summary, results, testPitches: Object.keys(TEST_PITCHES) });
  } catch (error) { return sendError(res, error); }
}

async function handleEvaluateGet(req, res) {
  try { requireAdmin(req); } catch (error) { return sendError(res, error); }
  try {
    const { limit, onlyFailed } = req.query || {};
    const history = await getEvaluationHistory({ limit: parseInt(limit) || 50, onlyFailed: onlyFailed === 'true' });
    const summary = await getLatestEvaluationSummary();
    return res.status(200).json({ summary, history, testPitches: Object.keys(TEST_PITCHES) });
  } catch (error) { return sendError(res, error); }
}

async function handleEvaluationResultsGet(req, res) {
  try { requireAdmin(req); } catch (error) { return sendError(res, error); }
  try {
    const { limit, onlyFailed, pitchType } = req.query || {};
    const history = await getEvaluationHistory({ limit: parseInt(limit) || 100, onlyFailed: onlyFailed === 'true' });
    const filtered = pitchType ? history.filter(r => r.pitch_type === pitchType) : history;
    const summary = await getLatestEvaluationSummary();
    const byType = {};
    for (const result of filtered) {
      const type = result.pitch_type || 'unknown';
      if (!byType[type]) byType[type] = { total: 0, passed: 0, scores: [], times: [] };
      byType[type].total++;
      if (result.passed) byType[type].passed++;
      byType[type].scores.push(result.actual_score);
      byType[type].times.push(result.execution_time_ms);
    }
    for (const [type, stats] of Object.entries(byType)) {
      stats.averageScore = Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length);
      stats.averageTime = Math.round(stats.times.reduce((a, b) => a + b, 0) / stats.times.length);
      stats.passRate = Math.round((stats.passed / stats.total) * 100);
      delete stats.scores; delete stats.times;
    }
    return res.status(200).json({ summary, byType, results: filtered.slice(0, 50), totalResults: filtered.length });
  } catch (error) { return sendError(res, error); }
}

async function handleEvaluationResultsDelete(req, res) {
  try { requireAdmin(req); } catch (error) { return sendError(res, error); }
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('evaluation_results').delete().neq('id', 0);
    if (error) return res.status(500).json({ error: 'Failed to clear results' });
    return res.status(200).json({ success: true, message: 'Evaluation history cleared.' });
  } catch (error) { return sendError(res, error); }
}

module.exports = async (req, res) => {
  const pathParam = (req.query.path || '').toString().trim();

  if (req.method === 'GET' && !pathParam) {
    return serveAdminPage(req, res);
  }

  if (pathParam === 'evaluation-results') {
    if (req.method === 'GET') return handleEvaluationResultsGet(req, res);
    if (req.method === 'DELETE') return handleEvaluationResultsDelete(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (pathParam === 'evaluate') {
    if (req.method === 'POST') return handleEvaluateRun(req, res);
    if (req.method === 'GET') return handleEvaluateGet(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (pathParam === 'analytics-summary') {
    if (req.method === 'GET') return handleAnalyticsSummary(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: 'Not found' });
};

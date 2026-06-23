/**
 * Evaluation API endpoint.
 * POST /api/evaluate - Run evaluation suite or single evaluation
 * GET /api/evaluate - Get evaluation history/results
 */
const { runEvaluationSuite, runSingleEvaluation, getEvaluationHistory, getLatestEvaluationSummary, TEST_PITCHES } = require('../lib/evaluations');
const { sendError } = require('./stripe-helpers');
const { analysisRateLimiter } = require('../lib/backup');

// Require admin token for evaluations
function requireAdmin(req) {
  const adminToken = (process.env.ADMIN_API_KEY || '').trim();
  if (!adminToken) {
    // If no admin token configured, only allow in dev
    if (process.env.VERCEL_ENV === 'production') {
      const error = new Error('Admin API key not configured. Set ADMIN_API_KEY environment variable.');
      error.statusCode = 500;
      throw error;
    }
    return; // Allow in dev without token
  }

  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${adminToken}`) {
    const error = new Error('Unauthorized. Provide valid Admin API key.');
    error.statusCode = 401;
    throw error;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    return handleRunEvaluation(req, res);
  }
  if (req.method === 'GET') {
    return handleGetEvaluation(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function handleRunEvaluation(req, res) {
  try {
    requireAdmin(req);
  } catch (error) {
    return sendError(res, error);
  }

  try {
    const { type, pitchText, expectedScoreMin, expectedScoreMax, plan, pitchTypes } = req.body || {};

    // Apply rate limiting
    const rateLimit = analysisRateLimiter.check('evaluate:' + (req.body?.email || 'anonymous'));
    res.setHeader('X-RateLimit-Limit', rateLimit.remaining);

    if (type === 'single' && pitchText) {
      // Run a single evaluation against a provided pitch
      const result = await runSingleEvaluation(
        req.body.testName || 'manual_test',
        pitchText,
        expectedScoreMin || 1,
        expectedScoreMax || 99,
        plan || 'data'
      );

      return res.status(200).json({
        type: 'single',
        result,
        testPitches: Object.keys(TEST_PITCHES)
      });
    }

    // Run full evaluation suite
    const { results, summary } = await runEvaluationSuite({
      plan: plan || 'data',
      persist: true,
      pitchTypes
    });

    return res.status(200).json({
      type: 'suite',
      summary,
      results,
      testPitches: Object.keys(TEST_PITCHES)
    });
  } catch (error) {
    return sendError(res, error);
  }
}

async function handleGetEvaluation(req, res) {
  try {
    requireAdmin(req);
  } catch (error) {
    return sendError(res, error);
  }

  try {
    const { limit, onlyFailed } = req.query || {};
    const history = await getEvaluationHistory({
      limit: parseInt(limit) || 50,
      onlyFailed: onlyFailed === 'true'
    });
    const summary = await getLatestEvaluationSummary();

    return res.status(200).json({
      summary,
      history,
      testPitches: Object.keys(TEST_PITCHES)
    });
  } catch (error) {
    return sendError(res, error);
  }
}
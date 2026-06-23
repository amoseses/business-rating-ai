const { analyzePitch } = require('../lib/analyze');
const { requireAuth } = require('./auth-helpers');
const { getCustomerPlanStatus, getStripe, normalizePlan, sendError } = require('./stripe-helpers');
const { withPerformanceTracking } = require('../lib/performance');
const { logApiError } = require('../lib/error-logger');
const { trackAnalysisEvent } = require('../lib/analytics');
const { analysisCache } = require('../lib/cache');
const { analysisRateLimiter, sanitizeInput } = require('../lib/backup');

module.exports = withPerformanceTracking(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pitch, plan, email } = req.body || {};
    const normalizedPlan = normalizePlan(plan);
    const normalizedEmail = (email || '').trim().toLowerCase();

    // Input sanitization
    const sanitizedPitch = sanitizeInput(pitch || '');

    // Rate limiting
    const rateLimit = analysisRateLimiter.check(`analyze:${normalizedEmail}`);
    res.setHeader('X-RateLimit-Limit', 20);
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);

    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Too many analysis requests. Please wait before trying again.',
        retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000)
      });
    }

    // Auth check
    requireAuth(req, normalizedEmail);
    const stripe = getStripe();
    const status = await getCustomerPlanStatus(stripe, normalizedEmail, normalizedPlan);

    if (!status.hasActivePlan) {
      return res.status(402).json({
        error: `Log in and purchase the ${normalizedPlan} plan before running this analysis.`,
        requiresCheckout: true,
        plan: normalizedPlan
      });
    }

    // Check cache first
    const cacheKey = analysisCache.constructor.makeKey(sanitizedPitch, normalizedPlan);
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      return res.status(200).json({
        ...cached,
        cached: true,
        cachedAt: cached._cachedAt
      });
    }

    // Run analysis
    const startTime = Date.now();
    const result = analyzePitch(sanitizedPitch, normalizedPlan);
    const responseTimeMs = Date.now() - startTime;

    if (result.error) {
      await logApiError(
        new Error(result.error),
        req,
        'analysis_error',
        'warning'
      );
      return res.status(400).json(result);
    }

    // Cache the result (without sensitive data)
    const cacheEntry = { ...result, _cachedAt: new Date().toISOString() };
    analysisCache.set(cacheKey, cacheEntry);

    // Track analytics event (non-blocking)
    trackAnalysisEvent({
      userEmail: normalizedEmail,
      plan: normalizedPlan,
      score: result.score,
      wordCount: result.wordCount,
      modelUsed: result.usedModel,
      responseTimeMs,
      success: true
    }).catch(() => {});

    return res.status(200).json(result);
  } catch (error) {
    // Log error to Supabase
    await logApiError(error, req, 'analysis_error', 'error');

    // Track failed analysis
    trackAnalysisEvent({
      userEmail: (req.body?.email || '').trim().toLowerCase(),
      plan: normalizePlan(req.body?.plan),
      success: false,
      errorMessage: error.message
    }).catch(() => {});

    return sendError(res, error);
  }
}, { endpointName: 'POST /api/analyze' });

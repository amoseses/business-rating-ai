const { analyzePitch } = require('../lib/analyze');
const { requireAuth } = require('./auth-helpers');
const { getCustomerPlanStatus, getStripe, normalizePlan, sendError } = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { pitch, plan, email } = req.body || {};
    const normalizedPlan = normalizePlan(plan);
    requireAuth(req, email);
    const stripe = getStripe();
    const status = await getCustomerPlanStatus(stripe, email, normalizedPlan);

    if (!status.hasActivePlan) {
      return res.status(402).json({
        error: `Log in and purchase the ${normalizedPlan} plan before running this analysis.`,
        requiresCheckout: true,
        plan: normalizedPlan
      });
    }

    const result = analyzePitch(pitch, normalizedPlan);
    if (result.error) return res.status(400).json(result);

    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error);
  }
};

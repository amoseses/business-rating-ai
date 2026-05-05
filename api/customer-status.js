const { getCustomerPlanStatus, getStripe, normalizePlan, sendError } = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = getStripe();
    const { email, plan } = req.body || {};
    const normalizedPlan = normalizePlan(plan);
    const status = await getCustomerPlanStatus(stripe, email, normalizedPlan);

    return res.status(200).json({
      email: status.email,
      plan: normalizedPlan,
      hasActivePlan: status.hasActivePlan,
      subscriptionStatus: status.subscription ? status.subscription.status : null
    });
  } catch (error) {
    return sendError(res, error);
  }
};

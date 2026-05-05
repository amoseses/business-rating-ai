const {
  findCustomerByEmail,
  getCustomerPlanStatus,
  getOrigin,
  getStripe,
  normalizeEmail,
  normalizePlan,
  sendError
} = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const stripe = getStripe();
    const { plan, email } = req.body || {};
    const normalizedPlan = normalizePlan(plan);
    const normalizedEmail = normalizeEmail(email);
    const origin = getOrigin(req);

    if (!origin) return res.status(500).json({ error: 'Missing APP_URL or request origin' });

    const status = await getCustomerPlanStatus(stripe, normalizedEmail, normalizedPlan);
    if (status.hasActivePlan) {
      return res.status(200).json({
        alreadySubscribed: true,
        plan: normalizedPlan,
        message: `You're already subscribed to the ${normalizedPlan} plan.`
      });
    }

    const existingCustomer = await findCustomerByEmail(stripe, normalizedEmail);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: existingCustomer ? existingCustomer.id : undefined,
      customer_email: existingCustomer ? undefined : normalizedEmail,
      line_items: [{ price: status.priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success&plan=${normalizedPlan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { plan: normalizedPlan, email: normalizedEmail },
      subscription_data: {
        metadata: { plan: normalizedPlan, email: normalizedEmail }
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    return sendError(res, error);
  }
};

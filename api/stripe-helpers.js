const Stripe = require('stripe');

const PLANS = {
  data: {
    name: 'Data plan',
    envVar: 'STRIPE_DATA_PRICE_ID'
  },
  plus: {
    name: 'Plus plan',
    envVar: 'STRIPE_PLUS_PRICE_ID'
  }
};

function normalizePlan(plan) {
  return plan === 'plus' ? 'plus' : 'data';
}

function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    const error = new Error('Missing STRIPE_SECRET_KEY');
    error.statusCode = 500;
    throw error;
  }

  return new Stripe(secret);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getOrigin(req) {
  return (req.headers.origin || process.env.APP_URL || '').replace(/\/$/, '');
}

async function resolvePriceId(stripe, plan) {
  const normalizedPlan = normalizePlan(plan);
  const envVar = PLANS[normalizedPlan].envVar;
  const configuredId = process.env[envVar];

  if (!configuredId) {
    const error = new Error(`Missing ${envVar}`);
    error.statusCode = 500;
    throw error;
  }

  if (configuredId.startsWith('price_')) {
    return configuredId;
  }

  if (configuredId.startsWith('prod_')) {
    const product = await stripe.products.retrieve(configuredId, { expand: ['default_price'] });
    const defaultPrice = product && product.default_price;

    if (!defaultPrice) {
      const error = new Error(`${envVar} is a product ID (${configuredId}), but that product has no default price. Use a Stripe price_ ID or set a default price on the product.`);
      error.statusCode = 500;
      throw error;
    }

    if (typeof defaultPrice === 'string') {
      return defaultPrice;
    }

    return defaultPrice.id;
  }

  const error = new Error(`${envVar} must be a Stripe price_ ID. Product prod_ IDs are only supported when the product has a default price.`);
  error.statusCode = 500;
  throw error;
}

async function findCustomerByEmail(stripe, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
  return customers.data[0] || null;
}

async function getPlanSubscription(stripe, customerId, priceId) {
  if (!customerId || !priceId) return null;

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
    expand: ['data.items.data.price']
  });

  return subscriptions.data.find((subscription) => {
    if (!['active', 'trialing'].includes(subscription.status)) return false;
    return subscription.items.data.some((item) => item.price && item.price.id === priceId);
  }) || null;
}

async function getCustomerPlanStatus(stripe, email, plan) {
  const normalizedPlan = normalizePlan(plan);
  const normalizedEmail = normalizeEmail(email);

  if (!isValidEmail(normalizedEmail)) {
    const error = new Error('Enter a valid email address to log in.');
    error.statusCode = 400;
    throw error;
  }

  const priceId = await resolvePriceId(stripe, normalizedPlan);
  const customer = await findCustomerByEmail(stripe, normalizedEmail);
  const subscription = customer ? await getPlanSubscription(stripe, customer.id, priceId) : null;

  return {
    email: normalizedEmail,
    plan: normalizedPlan,
    priceId,
    customer,
    subscription,
    hasActivePlan: Boolean(subscription)
  };
}

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({ error: error.message || 'Unexpected server error' });
}

module.exports = {
  PLANS,
  findCustomerByEmail,
  getCustomerPlanStatus,
  getOrigin,
  getStripe,
  isValidEmail,
  normalizeEmail,
  normalizePlan,
  resolvePriceId,
  sendError
};

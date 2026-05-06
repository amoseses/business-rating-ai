const Stripe = require('stripe');

const PLANS = {
  data: {
    name: 'Data plan',
    envVar: 'STRIPE_DATA_PRICE_ID',
    aliases: ['DATA_PRICE_ID', 'STRIPE_PRICE_ID_DATA', 'STRIPE_DATA_PLAN_PRICE_ID']
  },
  plus: {
    name: 'Plus plan',
    envVar: 'STRIPE_PLUS_PRICE_ID',
    aliases: ['PLUS_PRICE_ID', 'STRIPE_PRICE_ID_PLUS', 'STRIPE_PLUS_PLAN_PRICE_ID']
  }
};

const STRIPE_SECRET_ENV_NAMES = ['STRIPE_SECRET_KEY', 'STRIPE_SECRET', 'STRIPE_API_KEY'];

function normalizePlan(plan) {
  return plan === 'plus' ? 'plus' : 'data';
}

function normalizeEnvName(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function unwrapEnvValue(value, envNames = []) {
  let cleaned = String(value || '').replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  cleaned = cleaned.replace(/^export\s+/i, '').trim();

  const normalizedNames = envNames.map(normalizeEnvName);
  const equalsIndex = cleaned.indexOf('=');
  if (equalsIndex > 0) {
    const possibleName = cleaned.slice(0, equalsIndex).trim();
    if (normalizedNames.includes(normalizeEnvName(possibleName))) {
      cleaned = cleaned.slice(equalsIndex + 1).trim();
    }
  }

  while ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

function getEnvValue(envNames) {
  const normalizedNames = envNames.map(normalizeEnvName);
  const exactName = envNames.find((name) => String(process.env[name] || '').trim());
  if (exactName) {
    return {
      name: exactName,
      value: unwrapEnvValue(process.env[exactName], envNames),
      matchedBy: 'exact'
    };
  }

  const fuzzyName = Object.keys(process.env).find((name) => {
    return normalizedNames.includes(normalizeEnvName(name)) && String(process.env[name] || '').trim();
  });

  if (!fuzzyName) return null;

  return {
    name: fuzzyName,
    value: unwrapEnvValue(process.env[fuzzyName], envNames),
    matchedBy: 'normalized'
  };
}

function missingEnvError(message, setupHint = true) {
  const suffix = setupHint
    ? ' In Vercel, add it under Project Settings → Environment Variables for the environment you deploy (Production/Preview/Development), then redeploy.'
    : '';
  const error = new Error(`${message}${suffix}`);
  error.statusCode = 500;
  return error;
}

function getStripeSecret() {
  const found = getEnvValue(STRIPE_SECRET_ENV_NAMES);

  if (!found || !found.value) {
    throw missingEnvError('Missing Stripe secret key. Add STRIPE_SECRET_KEY with your Stripe sk_test_... or sk_live_... value.');
  }

  const secret = found.value;

  if (!secret.startsWith('sk_') && !secret.startsWith('rk_')) {
    const pastedWholeLine = secret.includes('STRIPE_SECRET_KEY=');
    const hint = pastedWholeLine
      ? ' Paste only the key value, not the full STRIPE_SECRET_KEY=... line.'
      : ' Do not use a publishable pk_ key, product prod_ ID, or price_ ID here.';
    const error = new Error(`${found.name} must be a Stripe secret key that starts with sk_ (or a restricted key that starts with rk_).${hint}`);
    error.statusCode = 500;
    throw error;
  }

  return secret;
}

function getStripe() {
  return new Stripe(getStripeSecret());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getOrigin(req) {
  const rawOrigin = req.headers.origin || process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
  if (!rawOrigin) return '';
  const origin = String(rawOrigin).trim().replace(/\/$/, '');
  return /^https?:\/\//i.test(origin) ? origin : `https://${origin}`;
}

function getPlanEnvValue(plan) {
  const normalizedPlan = normalizePlan(plan);
  const envNames = [PLANS[normalizedPlan].envVar, ...(PLANS[normalizedPlan].aliases || [])];
  return getEnvValue(envNames);
}

async function resolvePriceId(stripe, plan) {
  const normalizedPlan = normalizePlan(plan);
  const envVar = PLANS[normalizedPlan].envVar;
  const found = getPlanEnvValue(normalizedPlan);
  const configuredId = found && found.value;

  if (!configuredId) {
    throw missingEnvError(`Missing ${envVar}. Add the recurring Stripe Price ID for the ${PLANS[normalizedPlan].name}.`);
  }

  if (configuredId.startsWith('price_')) {
    return configuredId;
  }

  if (configuredId.startsWith('prod_')) {
    const product = await stripe.products.retrieve(configuredId, { expand: ['default_price'] });
    const defaultPrice = product && product.default_price;

    if (!defaultPrice) {
      const error = new Error(`${found.name} is a product ID (${configuredId}), but that product has no default price. Use a Stripe price_ ID or set a default price on the product.`);
      error.statusCode = 500;
      throw error;
    }

    if (typeof defaultPrice === 'string') {
      return defaultPrice;
    }

    return defaultPrice.id;
  }

  const error = new Error(`${found.name} must be a Stripe price_ ID. Product prod_ IDs are only supported when the product has a default price.`);
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

function envPresence(envNames) {
  const found = getEnvValue(envNames);
  return {
    configured: Boolean(found && found.value),
    name: found ? found.name : envNames[0],
    matchedBy: found ? found.matchedBy : null
  };
}

function getSetupStatus() {
  return {
    stripeSecret: envPresence(STRIPE_SECRET_ENV_NAMES),
    prices: Object.fromEntries(Object.keys(PLANS).map((plan) => {
      const config = PLANS[plan];
      return [plan, envPresence([config.envVar, ...(config.aliases || [])])];
    })),
    authSecret: envPresence(['AUTH_SECRET', 'SESSION_SECRET', ...STRIPE_SECRET_ENV_NAMES]),
    appUrl: envPresence(['APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL']),
    resend: envPresence(['RESEND_API_KEY'])
  };
}

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({ error: error.message || 'Unexpected server error' });
}

module.exports = {
  PLANS,
  STRIPE_SECRET_ENV_NAMES,
  findCustomerByEmail,
  getCustomerPlanStatus,
  getEnvValue,
  getOrigin,
  getPlanEnvValue,
  getSetupStatus,
  getStripe,
  getStripeSecret,
  isValidEmail,
  normalizeEmail,
  normalizeEnvName,
  normalizePlan,
  resolvePriceId,
  sendError,
  unwrapEnvValue
};

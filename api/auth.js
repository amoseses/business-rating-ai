const { authenticatePassword, createSessionToken, createResetToken, getOrCreateCustomer, passwordConfigured, sendPasswordResetEmail, setCustomerPassword, storeResetToken, validateEmail, verifyResetToken } = require('./auth-helpers');
const { findCustomerByEmail, getStripe, sendError } = require('./stripe-helpers');

async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  const normalizedEmail = validateEmail(email);
  const stripe = getStripe();
  const customer = await findCustomerByEmail(stripe, normalizedEmail);

  if (!customer) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  await authenticatePassword(customer, password);
  return res.status(200).json({ email: normalizedEmail, token: createSessionToken(normalizedEmail) });
}

async function handleSignup(req, res) {
  const { email, password } = req.body || {};
  const normalizedEmail = validateEmail(email);
  const stripe = getStripe();
  const customer = await getOrCreateCustomer(stripe, normalizedEmail);

  if (passwordConfigured(customer)) {
    return res.status(409).json({ error: 'An account already exists for this email. Log in or reset your password.' });
  }

  await setCustomerPassword(stripe, customer.id, password);
  return res.status(200).json({ email: normalizedEmail, token: createSessionToken(normalizedEmail) });
}

async function handleRequestReset(req, res) {
  const { email } = req.body || {};
  const normalizedEmail = validateEmail(email);
  const stripe = getStripe();
  const customer = await findCustomerByEmail(stripe, normalizedEmail);
  const message = 'If that email is registered, a password reset link has been sent.';

  if (!customer) {
    return res.status(200).json({ message });
  }

  const reset = createResetToken();
  await storeResetToken(stripe, customer.id, reset.tokenHash, reset.expiresAt);
  await sendPasswordResetEmail(normalizedEmail, buildResetUrl(req, normalizedEmail, reset.token));

  return res.status(200).json({ message });
}

async function handleResetPassword(req, res) {
  const { email, token, password } = req.body || {};
  const normalizedEmail = validateEmail(email);
  const stripe = getStripe();
  const customer = await findCustomerByEmail(stripe, normalizedEmail);

  if (!customer) {
    return res.status(400).json({ error: 'Password reset link is invalid or expired.' });
  }

  await verifyResetToken(customer, token);
  await setCustomerPassword(stripe, customer.id, password);

  return res.status(200).json({ email: normalizedEmail, token: createSessionToken(normalizedEmail) });
}

function buildResetUrl(req, email, token) {
  const origin = process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
  if (!origin) {
    const error = new Error('Missing APP_URL or request origin');
    error.statusCode = 500;
    throw error;
  }
  const params = new URLSearchParams({ reset: '1', email, token });
  return `${origin}/?${params.toString()}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const action = req.query.action || 'login';

    switch (action) {
      case 'signup':
        return handleSignup(req, res);
      case 'request-reset':
        return handleRequestReset(req, res);
      case 'reset-password':
        return handleResetPassword(req, res);
      case 'login':
      default:
        return handleLogin(req, res);
    }
  } catch (error) {
    return sendError(res, error);
  }
};
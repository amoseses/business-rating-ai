const { createSessionToken, getOrCreateCustomer, passwordConfigured, setCustomerPassword, validateEmail } = require('./auth-helpers');
const { getStripe, sendError } = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    const normalizedEmail = validateEmail(email);
    const stripe = getStripe();
    const customer = await getOrCreateCustomer(stripe, normalizedEmail);

    if (passwordConfigured(customer)) {
      return res.status(409).json({ error: 'An account already exists for this email. Log in or reset your password.' });
    }

    await setCustomerPassword(stripe, customer.id, password);
    return res.status(200).json({ email: normalizedEmail, token: createSessionToken(normalizedEmail) });
  } catch (error) {
    return sendError(res, error);
  }
};

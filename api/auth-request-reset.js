const { buildResetUrl, createResetToken, sendPasswordResetEmail, storeResetToken, validateEmail } = require('./auth-helpers');
const { findCustomerByEmail, getStripe, sendError } = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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
  } catch (error) {
    return sendError(res, error);
  }
};

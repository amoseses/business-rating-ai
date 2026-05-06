const { createSessionToken, setCustomerPassword, validateEmail, verifyResetToken } = require('./auth-helpers');
const { findCustomerByEmail, getStripe, sendError } = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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
  } catch (error) {
    return sendError(res, error);
  }
};

const Stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });

  const stripe = new Stripe(secret);
  const { plan } = req.body || {};

  const priceId = plan === 'plus' ? process.env.STRIPE_PLUS_PRICE_ID : process.env.STRIPE_DATA_PRICE_ID;
  if (!priceId) return res.status(500).json({ error: 'Missing Stripe price ID env var for selected plan' });

  const origin = req.headers.origin || process.env.APP_URL;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?checkout=success&plan=${plan || 'data'}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    metadata: { plan: plan || 'data' }
  });

  return res.status(200).json({ url: session.url });
};

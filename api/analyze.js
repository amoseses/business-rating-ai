const { analyzePitch } = require('../lib/analyze');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pitch, plan } = req.body || {};
  const normalizedPlan = plan === 'plus' ? 'plus' : 'data';

  const result = analyzePitch(pitch, normalizedPlan);
  if (result.error) return res.status(400).json(result);

  return res.status(200).json(result);
};

const { getSetupStatus, sendError } = require('./stripe-helpers');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    return res.status(200).json(getSetupStatus());
  } catch (error) {
    return sendError(res, error);
  }
};

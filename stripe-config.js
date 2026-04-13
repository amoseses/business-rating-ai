window.ASTRA_STRIPE = {
  plans: [],
  currency: 'usd',
  publishableKeyConfigured: false,

  async load(apiBase) {
    const response = await fetch(`${apiBase}/api/payments/plans`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to load payment plans');
    }
    this.plans = data.plans || [];
    this.currency = data.currency || 'usd';
    this.publishableKeyConfigured = Boolean(data.publishable_key_configured);
    return data;
  },

  formatUsd(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }
};

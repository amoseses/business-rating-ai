const crypto = require('crypto');
const { findCustomerByEmail, getEnvValue, getOrigin, isValidEmail, normalizeEmail } = require('./stripe-helpers');

const PASSWORD_MIN_LENGTH = 8;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function jsonBase64url(value) {
  return base64url(JSON.stringify(value));
}

function getAuthSecret() {
  const found = getEnvValue(['AUTH_SECRET', 'SESSION_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_SECRET', 'STRIPE_API_KEY']);
  const secret = found && found.value;
  if (!secret) {
    const error = new Error('Missing AUTH_SECRET. Add a long random AUTH_SECRET environment variable in Vercel, then redeploy.');
    error.statusCode = 500;
    throw error;
  }
  return secret;
}

function sign(value) {
  return crypto.createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

function createSessionToken(email) {
  const payload = {
    email: normalizeEmail(email),
    exp: Date.now() + SESSION_TTL_MS
  };
  const encoded = jsonBase64url(payload);
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.email || payload.exp < Date.now()) return null;
    return { email: normalizeEmail(payload.email) };
  } catch (_error) {
    return null;
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function requireAuth(req, email) {
  const normalizedEmail = normalizeEmail(email);
  const session = verifySessionToken(getBearerToken(req));

  if (!session || session.email !== normalizedEmail) {
    const error = new Error('Log in with your email and password before continuing.');
    error.statusCode = 401;
    throw error;
  }

  return session;
}

function validatePassword(password) {
  if (String(password || '').length < PASSWORD_MIN_LENGTH) {
    const error = new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    error.statusCode = 400;
    throw error;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('base64url');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  return hash.length === expectedHash.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

async function getOrCreateCustomer(stripe, email) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await findCustomerByEmail(stripe, normalizedEmail);
  if (existing) return existing;
  return stripe.customers.create({ email: normalizedEmail, metadata: { authEmail: normalizedEmail } });
}

function passwordConfigured(customer) {
  return Boolean(customer && customer.metadata && customer.metadata.authPasswordHash && customer.metadata.authPasswordSalt);
}

async function setCustomerPassword(stripe, customerId, password) {
  validatePassword(password);
  const { salt, hash } = hashPassword(password);
  return stripe.customers.update(customerId, {
    metadata: {
      authPasswordSalt: salt,
      authPasswordHash: hash,
      authPasswordUpdatedAt: new Date().toISOString(),
      resetTokenHash: '',
      resetTokenExpiresAt: ''
    }
  });
}

async function authenticatePassword(customer, password) {
  if (!passwordConfigured(customer)) {
    const error = new Error('No password is set for this email yet. Create an account first.');
    error.statusCode = 404;
    throw error;
  }

  if (!verifyPassword(password, customer.metadata.authPasswordSalt, customer.metadata.authPasswordHash)) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }
}

function createResetToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('base64url');
  return { token, tokenHash, expiresAt: Date.now() + RESET_TTL_MS };
}

function getFromEmail() {
  return process.env.FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'Business Rating AI <onboarding@resend.dev>';
}

async function sendPasswordResetEmail(email, resetUrl) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Missing RESEND_API_KEY. Add it so password reset emails can be sent.');
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: getFromEmail(),
      to: email,
      subject: 'Reset your Business Rating AI password',
      html: `<p>Click the link below to reset your Business Rating AI password. This link expires in 1 hour.</p><p><a href="${resetUrl}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
      text: `Reset your Business Rating AI password: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Password reset email could not be sent.');
    error.statusCode = 502;
    throw error;
  }

  return data;
}

function buildResetUrl(req, email, token) {
  const origin = getOrigin(req);
  if (!origin) {
    const error = new Error('Missing APP_URL or request origin');
    error.statusCode = 500;
    throw error;
  }
  const params = new URLSearchParams({ reset: '1', email, token });
  return `${origin}/?${params.toString()}`;
}

async function storeResetToken(stripe, customerId, tokenHash, expiresAt) {
  return stripe.customers.update(customerId, {
    metadata: {
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: String(expiresAt)
    }
  });
}

async function verifyResetToken(customer, token) {
  const expectedHash = customer && customer.metadata && customer.metadata.resetTokenHash;
  const expiresAt = Number(customer && customer.metadata && customer.metadata.resetTokenExpiresAt);
  if (!expectedHash || !expiresAt || expiresAt < Date.now()) {
    const error = new Error('Password reset link is invalid or expired.');
    error.statusCode = 400;
    throw error;
  }

  const actualHash = crypto.createHash('sha256').update(String(token || '')).digest('base64url');
  if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash))) {
    const error = new Error('Password reset link is invalid or expired.');
    error.statusCode = 400;
    throw error;
  }
}

function validateEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    const error = new Error('Enter a valid email address.');
    error.statusCode = 400;
    throw error;
  }
  return normalizedEmail;
}

module.exports = {
  authenticatePassword,
  buildResetUrl,
  createResetToken,
  createSessionToken,
  getOrCreateCustomer,
  passwordConfigured,
  requireAuth,
  sendPasswordResetEmail,
  setCustomerPassword,
  storeResetToken,
  validateEmail,
  validatePassword,
  verifyResetToken
};

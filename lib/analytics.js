/**
 * Analytics event tracking module.
 * Tracks user events, page views, feature usage, and analysis events.
 * All events are stored in Supabase `analytics_events` table.
 * When Supabase is not configured, events are silently dropped.
 */
const { getSupabase } = require('./supabase');

/**
 * Track a user event.
 * @param {object} params
 * @param {string} params.eventName - Name of the event (e.g. 'page_view', 'analysis_started', 'analysis_completed', 'checkout_started', 'login')
 * @param {string} [params.userEmail] - User's email if authenticated
 * @param {string} [params.sessionId] - Session identifier
 * @param {object} [params.properties] - Additional event properties
 * @param {string} [params.pageUrl] - Current page URL
 * @param {string} [params.userAgent] - User agent string
 * @param {string} [params.ipAddress] - Client IP address
 * @returns {Promise<boolean>} True if event was recorded
 */
async function trackEvent({ eventName, userEmail, sessionId, properties = {}, pageUrl, userAgent, ipAddress }) {
  if (!eventName) return false;

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('analytics_events')
      .insert([{
        event_name: eventName,
        user_email: userEmail || null,
        session_id: sessionId || null,
        properties: properties,
        page_url: pageUrl || null,
        user_agent: userAgent || null,
        ip_address: ipAddress || null
      }]);

    if (error) {
      console.warn('[Analytics] Failed to track event:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Analytics] Error tracking event:', err.message);
    return false;
  }
}

/**
 * Track a pitch analysis event with detailed properties.
 * @param {object} params
 * @param {string} params.userEmail
 * @param {string} params.plan - The plan used (data/plus)
 * @param {number} params.score - Analysis score
 * @param {number} params.wordCount - Pitch word count
 * @param {string} params.modelUsed - Which model was used
 * @param {number} params.responseTimeMs - Response time in ms
 * @param {boolean} [params.success] - Whether analysis succeeded
 * @param {string} [params.errorMessage] - Error message if failed
 */
async function trackAnalysisEvent({ userEmail, plan, score, wordCount, modelUsed, responseTimeMs, success = true, errorMessage }) {
  return trackEvent({
    eventName: success ? 'analysis_completed' : 'analysis_failed',
    userEmail,
    properties: {
      plan,
      score,
      wordCount,
      modelUsed,
      responseTimeMs,
      errorMessage
    }
  });
}

/**
 * Track a page view.
 * @param {object} params
 * @param {string} params.pageUrl
 * @param {string} [params.userEmail]
 * @param {string} [params.userAgent]
 * @param {string} [params.ipAddress]
 */
async function trackPageView({ pageUrl, userEmail, userAgent, ipAddress }) {
  return trackEvent({
    eventName: 'page_view',
    userEmail,
    pageUrl,
    userAgent,
    ipAddress
  });
}

/**
 * Track authentication events (login, signup, logout, password_reset).
 * @param {string} eventName - 'login' | 'signup' | 'logout' | 'password_reset'
 * @param {string} email
 * @param {object} [properties]
 */
async function trackAuthEvent(eventName, email, properties = {}) {
  return trackEvent({
    eventName: `auth_${eventName}`,
    userEmail: email,
    properties
  });
}

/**
 * Generate a simple session ID (crypto-random).
 * @returns {string} A random session identifier
 */
function generateSessionId() {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  trackEvent,
  trackAnalysisEvent,
  trackPageView,
  trackAuthEvent,
  generateSessionId
};
/**
 * Structured error logging module.
 * Logs errors to Supabase `error_logs` table for monitoring and debugging.
 * Falls back to console.error when Supabase is not configured.
 */
const { getSupabase } = require('./supabase');

const SEVERITY_LEVELS = ['debug', 'info', 'warning', 'error', 'critical'];

/**
 * Log an error to Supabase and console.
 * @param {object} params
 * @param {string} params.errorType - Error category (e.g. 'auth_error', 'stripe_error', 'analysis_error', 'validation_error')
 * @param {string} params.errorMessage - Human-readable error message
 * @param {string} [params.stackTrace] - Error stack trace
 * @param {string} [params.endpoint] - API endpoint where the error occurred
 * @param {string} [params.userEmail] - User email if authenticated
 * @param {object} [params.requestBody] - The request body that caused the error (sanitized)
 * @param {number} [params.statusCode] - HTTP status code
 * @param {string} [params.severity] - 'debug' | 'info' | 'warning' | 'error' | 'critical'
 * @param {Error} [params.error] - Native Error object (will extract message + stack)
 * @returns {Promise<boolean>}
 */
async function logError({ errorType, errorMessage, stackTrace, endpoint, userEmail, requestBody, statusCode, severity = 'error', error }) {
  // Extract from native Error object if provided
  if (error) {
    errorMessage = errorMessage || error.message;
    stackTrace = stackTrace || error.stack;
  }

  if (!errorMessage) {
    errorMessage = 'Unknown error';
  }

  // Validate severity
  if (!SEVERITY_LEVELS.includes(severity)) {
    severity = 'error';
  }

  // Always log to console for immediate visibility
  const logFn = severity === 'critical' ? console.error : severity === 'warning' ? console.warn : console.error;
  logFn(`[${severity.toUpperCase()}] [${errorType || 'unknown'}] ${errorMessage}${endpoint ? ` (${endpoint})` : ''}`);

  // Sanitize request body: remove sensitive fields
  let sanitizedBody = null;
  if (requestBody) {
    sanitizedBody = { ...requestBody };
    delete sanitizedBody.password;
    delete sanitizedBody.token;
    delete sanitizedBody.secret;
    delete sanitizedBody.apiKey;
    delete sanitizedBody.authorization;
    if (Object.keys(sanitizedBody).length === 0) sanitizedBody = null;
  }

  try {
    const supabase = getSupabase();
    const { error: dbError } = await supabase
      .from('error_logs')
      .insert([{
        error_type: errorType || 'unknown',
        error_message: errorMessage,
        stack_trace: stackTrace || null,
        endpoint: endpoint || null,
        user_email: userEmail || null,
        request_body: sanitizedBody,
        status_code: statusCode || null,
        severity: severity
      }]);

    if (dbError) {
      console.warn('[ErrorLogger] Failed to persist error:', dbError.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[ErrorLogger] Exception while logging:', err.message);
    return false;
  }
}

/**
 * Convenience wrapper to log errors from API handlers.
 * @param {Error} error - The caught error
 * @param {object} req - Express-like request object
 * @param {string} errorType - Error category
 * @param {string} [severity]
 * @returns {Promise<boolean>}
 */
async function logApiError(error, req, errorType = 'api_error', severity = 'error') {
  return logError({
    errorType,
    errorMessage: error.message,
    stackTrace: error.stack,
    endpoint: req ? `${req.method} ${req.url}` : undefined,
    userEmail: req && req.body ? req.body.email : undefined,
    requestBody: req ? req.body : undefined,
    statusCode: error.statusCode || error.status || 500,
    severity,
    error
  });
}

/**
 * Get recent errors for dashboard/monitoring.
 * @param {object} params
 * @param {number} [params.limit=50]
 * @param {string} [params.severity] - Filter by severity
 * @param {string} [params.errorType] - Filter by error type
 * @param {boolean} [params.unresolvedOnly]
 * @returns {Promise<Array>}
 */
async function getRecentErrors({ limit = 50, severity, errorType, unresolvedOnly = false } = {}) {
  try {
    const supabase = getSupabase();
    let query = supabase
      .from('error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (severity) {
      query = query.eq('severity', severity);
    }
    if (errorType) {
      query = query.eq('error_type', errorType);
    }
    if (unresolvedOnly) {
      query = query.eq('resolved', false);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('[ErrorLogger] Failed to fetch errors:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('[ErrorLogger] Exception fetching errors:', err.message);
    return [];
  }
}

/**
 * Mark an error as resolved.
 * @param {number} errorId - Error log ID
 * @returns {Promise<boolean>}
 */
async function resolveError(errorId) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('error_logs')
      .update({ resolved: true })
      .eq('id', errorId);

    if (error) {
      console.warn('[ErrorLogger] Failed to resolve error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[ErrorLogger] Exception resolving error:', err.message);
    return false;
  }
}

module.exports = {
  logError,
  logApiError,
  getRecentErrors,
  resolveError,
  SEVERITY_LEVELS
};
/**
 * Supabase client module for analytics, error logging, and performance monitoring.
 * Uses the service role key for server-side operations only — never expose to the client.
 */
const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;

/**
 * Get the Supabase client singleton.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.
 */
function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

  // Prefer service key for backend, fall back to anon key
  const key = serviceKey || anonKey;

  if (!url || !key) {
    // Return a mock client that silently logs when Supabase is not configured
    return createNullClient();
  }

  supabaseClient = createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: 'public' }
  });

  return supabaseClient;
}

/**
 * Create a null-object client that silently no-ops when Supabase is not configured.
 * This lets the app work without Supabase — analytics/errors are simply dropped.
 */
function createNullClient() {
  const noop = () => Promise.resolve({ data: null, error: null });
  return {
    from: () => ({
      insert: noop,
      select: noop,
      update: noop,
      delete: noop,
      eq: () => ({
        single: noop,
        order: noop,
        limit: noop,
        gte: noop,
        lte: noop
      }),
      gte: noop,
      lte: noop,
      order: noop,
      limit: noop,
      single: noop
    }),
    rpc: noop,
    auth: { signIn: noop, signOut: noop }
  };
}

/**
 * Check if Supabase is actually configured (not using null client).
 */
function isSupabaseConfigured() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  return Boolean(url && key);
}

module.exports = { getSupabase, isSupabaseConfigured };
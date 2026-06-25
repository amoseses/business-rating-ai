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
 * Create a chainable null-object query that behaves like Supabase query builders.
 */
function createNullQuery() {
  const result = { data: [], error: null, count: 0 };
  const query = {
    insert: () => Promise.resolve({ data: null, error: null }),
    select: () => query,
    update: () => query,
    delete: () => query,
    eq: () => query,
    neq: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    limit: () => query,
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
    finally: (callback) => Promise.resolve(result).finally(callback)
  };
  return query;
}

/**
 * Create a null-object client that silently no-ops when Supabase is not configured.
 * This lets the app work without Supabase — analytics/errors are simply dropped.
 */
function createNullClient() {
  const noop = () => Promise.resolve({ data: null, error: null, count: 0 });
  return {
    from: () => createNullQuery(),
    rpc: noop,
    auth: {
      signIn: noop,
      signOut: noop,
      admin: { listUsers: noop }
    }
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
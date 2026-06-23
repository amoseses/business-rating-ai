# Business Rating AI (Vercel + Stripe + Supabase)

## Setup
1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and set Stripe keys.
3. Run locally: `npm run dev`

## Vercel env vars
- `STRIPE_SECRET_KEY` — your Stripe secret key, usually `sk_test_...` or `sk_live_...`.
- `STRIPE_DATA_PRICE_ID` — recurring Stripe Price ID for the Data plan.
- `STRIPE_PLUS_PRICE_ID` — recurring Stripe Price ID for the Plus plan.
- `APP_URL` — deployed site URL.
- `AUTH_SECRET` — long random string used to sign login sessions.
- `RESEND_API_KEY` — Resend API key used to send password reset emails.
- `FROM_EMAIL` — verified sender address for password reset emails.

### Optional (Analytics, Monitoring, Evaluations)
- `SUPABASE_URL` — Supabase project URL (from Project Settings > API)
- `SUPABASE_SERVICE_KEY` — Supabase service role key (backend only)
- `SUPABASE_ANON_KEY` — Supabase anon/public key
- `ADMIN_API_KEY` — Random key to protect admin/evaluation endpoints

## New Features (v1.1.0)

### Analytics & User Tracking
- Event tracking via Supabase `analytics_events` table
- Tracks: page views, analysis completions, auth events, errors
- Non-blocking: silently drops events if Supabase is not configured

### Error Logging
- Structured error logging to Supabase `error_logs` table
- Captures: error type, message, stack trace, endpoint, user, severity
- Severity levels: debug, info, warning, error, critical
- Supports marking errors as resolved

### Performance Monitoring
- Automatic response time tracking for all API handlers
- Wraps handlers via `withPerformanceTracking()`
- Records: endpoint, method, response time, status code, user
- Summary statistics: avg, p50, p95, p99

### Scoring Consistency
- Multi-pass normalization pipeline (6 passes):
  1. Word count penalty (short pitches)
  2. Section score balance (variance penalty/consistency bonus)
  3. Red flag de-duplication and penalty
  4. Missing proof penalty
  5. Plan-specific adjustments (Plus boost)
  6. Clamp to 1-99 range
- Deterministic pitch hashing for deduplication
- Score similarity comparison for A/B testing

### Test Evaluation Suite
- Pre-defined test pitches across 6 types: SaaS, hardware, marketplace, biotech, consumer app, weak pitch
- CLI runner: `npm run evaluate`
- API endpoints for programmatic evaluation
- Results stored in Supabase `evaluation_results` table

### Rate Limiting
- Per-email analysis rate limit: 20 requests/minute
- Auth rate limit: 10 requests/minute
- General API rate limit: 60 requests/minute
- Returns 429 with retry-after headers

### Caching
- In-memory result cache (10 min TTL, 200 entries max)
- MD5-based cache keys for pitch deduplication
- Cache hit/miss tracking

### Backup & Security
- Input sanitization (HTML tag removal, shell metacharacter removal)
- Sanitize objects recursively
- JSON export for analysis data backup
- Secure API key generation and hashing
- CSP header generation
- Environment variable validation

## Endpoints
- `GET /api/config-status` — verify deployed environment variables
- `POST /api/auth-signup` — `{ email, password }`
- `POST /api/auth-login` — `{ email, password }`
- `POST /api/auth-request-reset` — `{ email }`
- `POST /api/auth-reset-password` — `{ email, token, password }`
- `POST /api/analyze` — `{ pitch, plan, email }` (requires Bearer token)
- `POST /api/create-checkout-session` — `{ plan, email }` (requires Bearer token)
- `POST /api/customer-status` — `{ plan, email }` (requires Bearer token)

### New Endpoints
- `POST /api/analytics` — Track client-side event `{ eventName, properties? }`
- `GET /api/analytics` — Analytics summary (requires `ADMIN_API_KEY`)
- `POST /api/evaluate` — Run evaluation suite or single test (requires `ADMIN_API_KEY`)
- `GET /api/evaluate` — Get evaluation history (requires `ADMIN_API_KEY`)
- `GET /api/evaluation-results` — Detailed results with per-type stats (requires `ADMIN_API_KEY`)
- `DELETE /api/evaluation-results` — Clear history (requires `ADMIN_API_KEY`)
- `GET /api/admin/analytics-summary` — Full admin dashboard data (requires `ADMIN_API_KEY`)

## Evaluation Suite
```bash
# Run all evaluations (data plan)
npm run evaluate

# Run with specific plan
node scripts/run-evaluations.js --plan plus

# Run specific pitch types
node scripts/run-evaluations.js --types saas,marketplace

# Skip persisting to Supabase
node scripts/run-evaluations.js --no-persist

# System health check
npm run check
```

## Supabase Setup
See `SUPABASE_SETUP.md` for table schemas, indexes, and RLS policies.

Plans supported:
- `data`
- `plus`
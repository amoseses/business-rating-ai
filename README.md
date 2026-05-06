# Business Rating AI (Vercel + Stripe)

## Setup
1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and set Stripe keys.
3. Run locally: `npm run dev`

## Vercel env vars
- `STRIPE_SECRET_KEY` — your Stripe secret key, usually `sk_test_...` or `sk_live_...`. The app trims accidental spaces/quotes and also accepts `STRIPE_SECRET` or `STRIPE_API_KEY` as fallbacks, but `STRIPE_SECRET_KEY` is preferred.
- `STRIPE_DATA_PRICE_ID` — recurring Stripe Price ID for the Data plan. Prefer `price_...`.
- `STRIPE_PLUS_PRICE_ID` — recurring Stripe Price ID for the Plus plan. Prefer `price_...`.
- `APP_URL` — deployed site URL, with or without a trailing slash.
- `AUTH_SECRET` — long random string used to sign login sessions.
- `RESEND_API_KEY` — Resend API key used to send password reset emails.
- `FROM_EMAIL` — verified sender address for password reset emails, for example `Business Rating AI <noreply@example.com>`.

If you accidentally paste a Stripe Product ID (`prod_...`) instead of a Price ID, the app will try to use that product's default price. If the product has no default price, set one in Stripe or replace the env var with the recurring `price_...` ID.

## Endpoints
- `POST /api/auth-signup` with `{ email, password }`
- `POST /api/auth-login` with `{ email, password }`
- `POST /api/auth-request-reset` with `{ email }`
- `POST /api/auth-reset-password` with `{ email, token, password }`
- `POST /api/analyze` with `{ pitch, plan, email }` and `Authorization: Bearer <token>`
- `POST /api/create-checkout-session` with `{ plan, email }` and `Authorization: Bearer <token>`
- `POST /api/customer-status` with `{ plan, email }` and `Authorization: Bearer <token>`

Plans supported:
- `data`
- `plus`

## Login, password reset, and duplicate purchase prevention
The frontend now uses email/password accounts with browser password-manager autocomplete support and an optional "keep me logged in" session. Password hashes and reset-token hashes are stored on the matching Stripe Customer metadata, so no separate database is required for this app. Password reset requests send an email through Resend with a one-hour reset link.

Before creating a Checkout Session or running an analysis, the API requires the signed login token and checks Stripe for an active or trialing subscription for that email and selected plan. If the subscription already exists, Checkout is skipped so the customer does not pay for the same plan again.

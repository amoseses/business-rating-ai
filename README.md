# Business Rating AI (Vercel + Stripe)

## Setup
1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and set Stripe keys.
3. Run locally: `npm run dev`

## Vercel env vars
- `STRIPE_SECRET_KEY` — your Stripe secret key, usually `sk_test_...` or `sk_live_...`.
- `STRIPE_DATA_PRICE_ID` — recurring Stripe Price ID for the Data plan. Prefer `price_...`.
- `STRIPE_PLUS_PRICE_ID` — recurring Stripe Price ID for the Plus plan. Prefer `price_...`.
- `APP_URL` — deployed site URL, with or without a trailing slash.

If you accidentally paste a Stripe Product ID (`prod_...`) instead of a Price ID, the app will try to use that product's default price. If the product has no default price, set one in Stripe or replace the env var with the recurring `price_...` ID.

## Endpoints
- `POST /api/analyze` with `{ pitch, plan, email }`
- `POST /api/create-checkout-session` with `{ plan, email }`
- `POST /api/customer-status` with `{ plan, email }`

Plans supported:
- `data`
- `plus`

## Login and duplicate purchase prevention
The frontend stores the customer's email in the browser as a lightweight login. Before creating a Checkout Session or running an analysis, the API checks Stripe for an active or trialing subscription for that email and selected plan. If the subscription already exists, Checkout is skipped so the customer does not pay for the same plan again.

# Business Rating AI (Vercel + Stripe)

## Setup
1. Install: `npm install`
2. Copy `.env.example` to `.env.local` and set Stripe keys.
3. Run locally: `npm run dev`

## Vercel env vars
- `STRIPE_SECRET_KEY`
- `STRIPE_DATA_PRICE_ID`
- `STRIPE_PLUS_PRICE_ID`
- `APP_URL`

## Endpoints
- `POST /api/analyze` with `{ pitch, plan }`
- `POST /api/create-checkout-session` with `{ plan }`

Plans supported:
- `data`
- `plus`

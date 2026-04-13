"""Stripe pricing catalog and checkout helpers for AstraPitch."""

from __future__ import annotations

import os


STRIPE_CONFIG = {
    "publishable_key": os.environ.get("STRIPE_PUBLISHABLE_KEY", ""),
    "currency": "usd",
    "plans": [
        {
            "id": "pro_monthly",
            "name": "Pro",
            "price_usd": 49,
            "interval": "month",
            "description": "Deterministic API-grade scoring for teams shipping investor updates weekly.",
            "features": [
                "Deterministic text + video scoring",
                "Dataset alignment and benchmark matches",
                "Execution summary and prioritized fix plan",
            ],
            "payment_link": os.environ.get("STRIPE_PAYMENT_LINK_PRO", ""),
            "price_id": os.environ.get("STRIPE_PRICE_ID_PRO", ""),
        },
        {
            "id": "plus_monthly",
            "name": "Plus",
            "price_usd": 149,
            "interval": "month",
            "description": "Everything in Pro, plus LLM investor-style narrative and adaptive feedback loop.",
            "features": [
                "LLM enrichment when configured",
                "Investor readout + rewrite suggestions",
                "Feedback-powered dataset learning hooks",
            ],
            "payment_link": os.environ.get("STRIPE_PAYMENT_LINK_PLUS", ""),
            "price_id": os.environ.get("STRIPE_PRICE_ID_PLUS", ""),
        },
    ],
}


def public_stripe_config():
    return {
        "publishable_key_configured": bool(STRIPE_CONFIG["publishable_key"]),
        "currency": STRIPE_CONFIG["currency"],
        "plans": [
            {
                "id": plan["id"],
                "name": plan["name"],
                "price_usd": plan["price_usd"],
                "interval": plan["interval"],
                "description": plan["description"],
                "features": plan["features"],
                "payment_link_configured": bool(plan["payment_link"]),
                "price_id_configured": bool(plan["price_id"]),
            }
            for plan in STRIPE_CONFIG["plans"]
        ],
    }


def get_plan(plan_id: str):
    for plan in STRIPE_CONFIG["plans"]:
        if plan["id"] == plan_id:
            return plan
    return None

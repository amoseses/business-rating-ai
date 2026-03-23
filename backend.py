#!/usr/bin/env python3
import json
import math
import os
import re
from collections import Counter
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "index.html"

# ---------------------------------------------------------------------------
# OPTIONAL PLUS / LLM BACKEND SECTION
# Add your hosted model credentials here if you want the backend to enrich the
# free rules-based analysis with an external LLM. This is intentionally kept in
# backend code only so the frontend UX stays clean and does not expose API-key
# fields to end users.
#
# Supported setup:
#   export PITCH_LLM_ENDPOINT="https://your-api-domain/v1/pitch/analyze"
#   export PITCH_LLM_API_KEY="sk_live_xxx"
#
# The endpoint should accept JSON with:
#   {"mode": "text|video", "input": {...free analysis payload...}, "analysis": {...}}
# and may return fields like:
#   {
#     "summary": "...",
#     "investor_readout": ["..."],
#     "rewrite": "...",
#     "next_steps": ["..."],
#     "score_delta": 3
#   }
# ---------------------------------------------------------------------------
LLM_ENDPOINT = os.environ.get("PITCH_LLM_ENDPOINT", "").strip()
LLM_API_KEY = os.environ.get("PITCH_LLM_API_KEY", "").strip()
LLM_TIMEOUT_SECONDS = float(os.environ.get("PITCH_LLM_TIMEOUT", "8"))

SECTOR_KEYWORDS = {
    "saas": ["arr", "mrr", "churn", "retention", "seat", "subscription", "pipeline", "expansion"],
    "fintech": ["compliance", "risk", "fraud", "payment", "underwriting", "capital", "apr", "interchange"],
    "healthtech": ["clinical", "provider", "patient", "outcome", "hipaa", "ehr", "reimbursement"],
    "ai": ["model", "inference", "latency", "training", "dataset", "accuracy", "hallucination", "fine-tune"],
    "consumer": ["engagement", "retention", "cohort", "virality", "ltv", "cac", "nps"],
    "general": ["market", "growth", "revenue", "customer", "traction", "margin", "expansion"],
}

CATEGORY_TERMS = {
    "problem_definition": ["problem", "pain", "friction", "inefficient", "broken", "manual"],
    "solution_quality": ["solution", "platform", "workflow", "automation", "product", "we built"],
    "market_strength": ["tam", "sam", "som", "market", "segment", "growth rate", "industry"],
    "business_model": ["pricing", "revenue", "margin", "gross margin", "subscription", "contract", "upsell"],
    "traction": ["customers", "arr", "mrr", "pilot", "retention", "growth", "conversion", "renewal"],
    "competition_moat": ["competitor", "alternative", "different", "advantage", "moat", "network effect", "defensible"],
    "fundraise_clarity": ["raising", "use of funds", "runway", "ask", "valuation", "milestone"],
    "risk_awareness": ["risk", "mitigation", "regulatory", "execution", "dependency", "contingency"],
}

STOPWORDS = {
    "the", "a", "an", "and", "or", "to", "of", "in", "is", "for", "on", "with", "that", "this", "we", "our", "by", "as",
    "be", "are", "it", "from", "at", "you", "your", "can", "will", "have", "has", "their", "they", "but", "not", "into"
}

STAGE_EXPECTATIONS = {
    "idea": ["problem", "solution", "market", "raise", "milestone"],
    "mvp": ["pilot", "feedback", "pricing", "market", "raise"],
    "early": ["revenue", "retention", "growth", "unit economics", "raise"],
    "growth": ["expansion", "net retention", "efficiency", "pipeline", "moat"],
}

TRAINING_DATASET = [
    {
        "id": "fintech-growth-01",
        "sector": "fintech",
        "stage": "growth",
        "rating": 92,
        "quality": "excellent",
        "pitch": "We help vertical SaaS platforms launch embedded payments in 14 days instead of 4 months. Our orchestration layer routes transactions across processors, automates KYC and chargeback workflows, and gives finance teams an audit-ready ledger. We serve 46 software platforms, processed $182M annualized volume last quarter, and grew ARR from $1.1M to $2.8M in 11 months with 121% net revenue retention. We charge a SaaS subscription plus interchange share, maintain 81% gross margin, and are raising $4M to expand enterprise sales and bank partnerships while holding compliance risk low through quarterly external reviews."
    },
    {
        "id": "ai-early-01",
        "sector": "ai",
        "stage": "early",
        "rating": 88,
        "quality": "strong",
        "pitch": "Customer support leaders use our AI agent quality platform to catch hallucinations before they reach users. We ingest transcripts, score every response against policy, and recommend safer prompts and fine-tunes in one workflow. Eight design partners converted to paid contracts, ARR reached $420k after six months, and gross retention is 96%. We sell annual software subscriptions to B2B SaaS companies, expand through seat growth, and are raising $2.2M to reach $120k MRR, deepen our proprietary evaluation dataset, and complete SOC 2."
    },
    {
        "id": "healthtech-mvp-01",
        "sector": "healthtech",
        "stage": "mvp",
        "rating": 84,
        "quality": "strong",
        "pitch": "Care coordinators spend hours calling patients who miss follow-up visits. Our HIPAA-ready workflow engine identifies high-risk patients from the EHR, texts them in their preferred language, and routes escalations back to providers. Three clinics piloted the product, no-show rates fell 19%, and two sites agreed to annual contracts after a 60-day test. We price per clinic plus usage, target outpatient groups with high readmission penalties, and are raising $1.5M to scale implementation and prove multi-site retention."
    },
    {
        "id": "saas-idea-01",
        "sector": "saas",
        "stage": "idea",
        "rating": 72,
        "quality": "promising",
        "pitch": "Mid-market RevOps teams still update pipeline reports manually across CRM, billing, and product systems. We are building a revenue operations workspace that unifies those records, explains forecast changes, and highlights churn risk before renewal. Early interviews with 34 operators show teams spend 9 hours a week on spreadsheet cleanup. We expect a subscription model priced by account volume and are raising $900k to ship the first workflow automation release and convert six pilot customers."
    },
    {
        "id": "consumer-early-01",
        "sector": "consumer",
        "stage": "early",
        "rating": 67,
        "quality": "mixed",
        "pitch": "We built a habit app for independent fitness coaches to keep clients engaged between sessions. The app combines streaks, lightweight social accountability, and coach prompts in one mobile workflow. Our beta has 2,400 monthly active users and 18% month-one paid conversion, but retention is uneven and we are still refining our pricing. We plan to monetize through subscriptions and premium analytics, and we are raising $750k to improve cohort retention and prove coach-led acquisition."
    },
    {
        "id": "general-idea-weak-01",
        "sector": "general",
        "stage": "idea",
        "rating": 41,
        "quality": "weak",
        "pitch": "We are building a revolutionary platform for everyone. The market is huge and there is basically no competition. Our product will change the world very fast and we expect explosive growth soon. We are raising money to build more features."
    },
]

FIX_LIBRARY = {
    "problem_definition": {"priority": "high", "fix": "State one clear customer pain and quantify it with time or money lost.", "example": "Finance teams lose 11 hours per week reconciling payouts manually."},
    "solution_quality": {"priority": "high", "fix": "Describe the product workflow in one sentence, not just the vision.", "example": "Our engine auto-matches payouts to ledger entries with 96% precision."},
    "market_strength": {"priority": "high", "fix": "Add TAM, wedge market, and exact buyer.", "example": "TAM is $9.4B, SAM is $1.3B, and we target 2,000 mid-market fintech firms."},
    "business_model": {"priority": "medium", "fix": "Explain pricing, gross margin assumptions, and sales motion.", "example": "$6k per month plus usage, 78% gross margin, 45-day sales cycle."},
    "traction": {"priority": "high", "fix": "Show proof over time: revenue, growth, retention, conversion, or pilots.", "example": "MRR grew from $18k to $38k in four months with 94% gross retention."},
    "competition_moat": {"priority": "medium", "fix": "Compare the status quo and say why your advantage compounds.", "example": "Only platform with a real-time fraud graph plus bank-grade audit trail."},
    "fundraise_clarity": {"priority": "high", "fix": "Specify the amount raised, runway target, and milestones unlocked.", "example": "Raising $2.5M for 24 months runway to reach $150k MRR and SOC 2."},
    "risk_awareness": {"priority": "medium", "fix": "Name the top execution risk and the mitigation plan.", "example": "Regulatory risk is mitigated through quarterly external compliance audits."},
    "sector_alignment": {"priority": "medium", "fix": "Use the sector metrics investors expect to hear.", "example": "For SaaS, include CAC, LTV, churn, and expansion revenue."},
}


def clamp(value, low=0, high=100):
    return max(low, min(high, round(value)))


def tokenize(text):
    return re.findall(r"[a-zA-Z][a-zA-Z\-']+", text.lower())


def count_matches(text, phrases):
    lower = text.lower()
    return sum(1 for p in phrases if p in lower)


def sentence_stats(text):
    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    words = tokenize(text)
    avg_words = len(words) / max(1, len(sentences))
    return len(words), len(sentences), avg_words


def extract_numeric_signals(text):
    matches = re.findall(r"\$?\d+(?:\.\d+)?(?:%|k|m|b|x)?", text.lower())
    perc = len([m for m in matches if "%" in m])
    money = len([m for m in matches if "$" in m or m.endswith(("k", "m", "b"))])
    return len(matches), perc, money


def top_keywords(text, n=12):
    freq = Counter(tok for tok in tokenize(text) if len(tok) >= 4 and tok not in STOPWORDS)
    return [f"{term} ({count})" for term, count in freq.most_common(n)]


def category_score(text, terms, words):
    hits = count_matches(text, terms)
    density_bonus = min(20, words / 24)
    return clamp(22 + hits * 12 + density_bonus)


def phrase_density_score(text, terms):
    words, _, _ = sentence_stats(text)
    hits = count_matches(text, terms)
    density = (hits * 1000) / max(60, words)
    return clamp(20 + (hits * 10) + density)


def get_size_band(words):
    if words < 60:
        return "very_short"
    if words < 180:
        return "short"
    if words <= 650:
        return "standard"
    if words <= 1500:
        return "long"
    return "very_long"


def size_adjustment(words):
    return {"very_short": -16, "short": -6, "standard": 6, "long": 2, "very_long": -8}[get_size_band(words)]


def stage_alignment_score(text, stage):
    expected = STAGE_EXPECTATIONS.get(stage, STAGE_EXPECTATIONS["early"])
    lower = text.lower()
    hits = sum(1 for term in expected if term in lower)
    missing = [term for term in expected if term not in lower]
    return clamp(30 + hits * 14), expected, missing


def build_dataset_profile(dataset):
    docs = []
    doc_freq = Counter()
    for example in dataset:
        tokens = [tok for tok in tokenize(example["pitch"]) if len(tok) >= 4 and tok not in STOPWORDS]
        counts = Counter(tokens)
        docs.append({"example": example, "counts": counts, "norm": 0.0})
        for token in counts:
            doc_freq[token] += 1

    count_docs = len(dataset)
    idf = {token: math.log((1 + count_docs) / (1 + freq)) + 1.0 for token, freq in doc_freq.items()}
    weights = {}
    weighted_rating_sum = Counter()
    weighted_inverse_sum = Counter()

    for entry in docs:
        vector = {}
        for token, count in entry["counts"].items():
            weight = count * idf[token]
            vector[token] = weight
            weighted_rating_sum[token] += weight * entry["example"]["rating"]
            weighted_inverse_sum[token] += weight * (100 - entry["example"]["rating"])
        entry["vector"] = vector
        entry["norm"] = math.sqrt(sum(value * value for value in vector.values())) or 1.0

    for token in idf:
        pos = weighted_rating_sum[token]
        neg = weighted_inverse_sum[token]
        total = pos + neg
        weights[token] = round(((pos - neg) / total) * 18, 4) if total else 0.0

    ratings = sorted(example["rating"] for example in dataset)
    return {
        "docs": docs,
        "idf": idf,
        "weights": weights,
        "stats": {
            "rows": len(dataset),
            "avg_rating": round(sum(ratings) / len(ratings), 1),
            "best_rating": max(ratings),
            "worst_rating": min(ratings),
            "sectors": sorted({example["sector"] for example in dataset}),
            "stages": sorted({example["stage"] for example in dataset}),
        },
    }


DATASET_PROFILE = build_dataset_profile(TRAINING_DATASET)


def dataset_vector(text):
    counts = Counter(tok for tok in tokenize(text) if len(tok) >= 4 and tok not in STOPWORDS)
    vector = {token: count * DATASET_PROFILE["idf"].get(token, 0.0) for token, count in counts.items()}
    norm = math.sqrt(sum(value * value for value in vector.values())) or 1.0
    return counts, vector, norm


def nearest_training_examples(text, sector=None, limit=3):
    _, vector, norm = dataset_vector(text)
    matches = []
    for entry in DATASET_PROFILE["docs"]:
        example = entry["example"]
        if sector and sector != "general" and example["sector"] != sector:
            continue
        dot = sum(vector.get(token, 0.0) * entry["vector"].get(token, 0.0) for token in vector)
        similarity = dot / (norm * entry["norm"])
        matches.append({
            "id": example["id"],
            "sector": example["sector"],
            "stage": example["stage"],
            "rating": example["rating"],
            "quality": example["quality"],
            "similarity": round(similarity, 3),
            "pitch": example["pitch"],
        })
    ordered = sorted(matches, key=lambda item: (item["similarity"], item["rating"]), reverse=True)
    return ordered[:limit]


def dataset_training_signals(text, sector=None):
    counts, _, _ = dataset_vector(text)
    score = 50.0
    contributors = []
    for token, count in counts.items():
        weight = DATASET_PROFILE["weights"].get(token)
        if weight is None:
            continue
        impact = weight * count
        score += impact
        if abs(impact) >= 3:
            contributors.append({"token": token, "impact": round(impact, 2)})

    examples = nearest_training_examples(text, sector=sector, limit=3)
    if examples:
        weighted = [max(item["similarity"], 0.05) for item in examples]
        avg_neighbor = sum(item["rating"] * weight for item, weight in zip(examples, weighted)) / sum(weighted)
        score = (score * 0.55) + (avg_neighbor * 0.45)
    contributors.sort(key=lambda item: abs(item["impact"]), reverse=True)
    return {"score": clamp(score), "contributors": contributors[:8], "nearest_examples": examples}


def accuracy_checker(text, category_scores):
    words, sentences, avg_words = sentence_stats(text)
    numeric, perc, money = extract_numeric_signals(text)
    size_band = get_size_band(words)
    structure = 52 + (10 if words > 120 else 0) + (8 if sentences > 6 else 0) + (10 if 11 <= avg_words <= 28 else 0) + size_adjustment(words)
    evidence = 30 + min(40, numeric * 4) + min(10, perc * 2) + min(10, money * 2)
    consistency = 38 + (sum(category_scores.values()) / len(category_scores)) * 0.5
    specificity = clamp(28 + min(26, len(top_keywords(text)) * 2.6) + min(24, count_matches(text, ["tam", "sam", "som", "icp", "cohort", "retention"]) * 6))
    balance = clamp(35 + min(35, count_matches(text, ["risk", "mitigation", "assumption", "dependency"]) * 8) + min(20, sentences * 1.3))
    confidence = clamp((structure * 0.28) + (evidence * 0.30) + (consistency * 0.24) + (specificity * 0.10) + (balance * 0.08) - (8 if "guarantee" in text.lower() else 0))

    flags = []
    if "guarantee" in text.lower() or "no risk" in text.lower():
        flags.append("Avoid absolute claims like 'guarantee' or 'no risk'.")
    if size_band in ("very_short", "short"):
        flags.append("Pitch is short for investment diligence; add market, moat, and fundraise details.")
    if size_band in ("long", "very_long"):
        flags.append("Pitch is long; tighten the narrative and lead with your strongest proof.")

    reasons = []
    if evidence < 60:
        reasons.append("Low metric density detected; add concrete revenue, retention, or growth values.")
    if structure < 60:
        reasons.append("Structure is thin; clarify the problem, solution, and fundraise flow.")
    if specificity < 60:
        reasons.append("Specificity is weak; include market sizing and customer segment detail.")
    if not reasons:
        reasons.append("Signal quality is strong enough for a first-pass investor diligence review.")

    return {
        "confidence": confidence,
        "size_band": size_band,
        "detail": {
            "structure": clamp(structure),
            "evidence": clamp(evidence),
            "consistency": clamp(consistency),
            "specificity": specificity,
            "balance": balance,
            "flags": flags,
        },
        "reasons": reasons,
    }


def build_fix_plan(categories, words):
    ordered = sorted(categories.items(), key=lambda kv: kv[1])
    must_fix, improve_next, polish = [], [], []
    for name, score in ordered:
        entry = FIX_LIBRARY.get(name)
        if not entry:
            continue
        item = {"area": name, "score": score, "priority": entry["priority"], "fix": entry["fix"], "example": entry["example"]}
        if len(must_fix) < 3 and (score < 50 or entry["priority"] == "high"):
            must_fix.append(item)
        elif len(improve_next) < 3:
            improve_next.append(item)
        elif len(polish) < 2:
            polish.append(item)
    return {
        "must_fix_first": must_fix,
        "improve_next": improve_next,
        "polish_last": polish,
        "size_guidance": {
            "size_band": get_size_band(words),
            "word_count": words,
            "recommendation": "Expand to 180-450 words for stronger investor signal." if words < 180 else "Good length for most investor intros." if words <= 650 else "Consider a shorter investor version plus appendix.",
        },
    }


def generate_rewrite(text, sector, weakest_areas):
    title = sector.upper() if sector != "general" else "your company"
    focus = weakest_areas[0][0] if weakest_areas else "traction"
    playbook = {
        "problem_definition": "Open with one painful workflow and quantify the cost before describing the product.",
        "solution_quality": "Describe the product as a before/after workflow, not an abstract vision.",
        "market_strength": "Name the exact buyer, wedge, and market size in the first half of the pitch.",
        "business_model": "State how you make money with one clean pricing sentence.",
        "traction": "Lead with the strongest growth, revenue, pilot, or retention proof point.",
        "competition_moat": "Explain why incumbents or point solutions lose as you scale.",
        "fundraise_clarity": "Close with the raise amount and the milestones unlocked.",
        "risk_awareness": "Acknowledge one real risk and how you mitigate it.",
    }
    return (
        f"{title} solves an urgent problem for a clearly defined customer. "
        f"{playbook.get(focus, 'Lead with the strongest proof point and make the buyer explicit.')} "
        "Then explain why customers adopt quickly, how revenue compounds, and what milestone this round unlocks."
    )


def build_how_it_works(mode, sector, stage, words):
    return [
        f"1. Parsed the {mode} pitch into investor categories for the {sector} sector at the {stage} stage.",
        f"2. Compared wording against {DATASET_PROFILE['stats']['rows']} embedded training examples and weighted high-signal terms.",
        f"3. Checked proof density, structure quality, and pitch length across {words} words.",
        "4. Ranked the weakest sections, generated a fix plan, and produced a suggested rewrite.",
    ]


def build_execution_summary(categories, missing_stage_terms, checker):
    weakest = sorted(categories.items(), key=lambda item: item[1])[:3]
    strongest = sorted(categories.items(), key=lambda item: item[1], reverse=True)[:3]
    return {
        "strongest_areas": [name for name, _ in strongest],
        "weakest_areas": [name for name, _ in weakest],
        "biggest_gap": weakest[0][0] if weakest else None,
        "missing_stage_signals": missing_stage_terms,
        "confidence": checker["confidence"],
    }


def maybe_call_llm(mode, payload, analysis):
    if not LLM_ENDPOINT or not LLM_API_KEY:
        return {"enabled": False, "status": "not_configured"}

    body = json.dumps({"mode": mode, "input": payload, "analysis": analysis}).encode("utf-8")
    req = Request(
        LLM_ENDPOINT,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LLM_API_KEY}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=LLM_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            return {"enabled": True, "status": "ok", "output": data}
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return {"enabled": True, "status": "error", "error": str(exc)}


def apply_llm_enrichment(result, llm_result):
    enriched = dict(result)
    enriched["llm"] = {"enabled": llm_result.get("enabled", False), "status": llm_result.get("status", "not_configured")}
    output = llm_result.get("output") or {}
    if llm_result.get("status") == "ok":
        score_delta = int(output.get("score_delta", 0)) if str(output.get("score_delta", "")).lstrip("-").isdigit() else 0
        enriched["overall_score"] = clamp(enriched["overall_score"] + max(-5, min(5, score_delta)))
        enriched["llm"]["summary"] = output.get("summary", "")
        enriched["llm"]["investor_readout"] = output.get("investor_readout") or []
        enriched["llm"]["next_steps"] = output.get("next_steps") or []
        rewrite = (output.get("rewrite") or "").strip()
        if rewrite:
            enriched["rewrite_suggestion"] = rewrite
    elif llm_result.get("status") == "error":
        enriched["llm"]["error"] = llm_result.get("error", "Unknown LLM error")
    return enriched


def analyze_text(payload):
    text = (payload.get("text") or "").strip()
    sector = (payload.get("sector") or "general").lower()
    stage = (payload.get("stage") or "early").lower()
    words, _, _ = sentence_stats(text)
    numeric, _, _ = extract_numeric_signals(text)

    categories = {name: category_score(text, terms, words) for name, terms in CATEGORY_TERMS.items()}
    categories["sector_alignment"] = phrase_density_score(text, SECTOR_KEYWORDS.get(sector, SECTOR_KEYWORDS["general"]))
    stage_alignment, stage_terms, missing_stage_terms = stage_alignment_score(text, stage)
    categories["stage_alignment"] = stage_alignment

    trained = dataset_training_signals(text, sector=sector)
    categories["keyword_training"] = trained["score"]

    if stage == "idea":
        categories["traction"] = max(categories["traction"] - 8, 18)
    if stage == "growth":
        categories["business_model"] = clamp(categories["business_model"] + 8)

    checker = accuracy_checker(text, categories)
    overall = clamp((sum(categories.values()) / len(categories)) * 0.72 + trained["score"] * 0.28 + size_adjustment(words) * 0.5)

    ordered = sorted(categories.items(), key=lambda kv: kv[1], reverse=True)
    strengths = [f"{name.replace('_', ' ').title()}: {score}/100" for name, score in ordered[:4]]
    risks = [f"{name.replace('_', ' ').title()}: {score}/100" for name, score in ordered[-4:]]
    if numeric < 4:
        risks.insert(0, "Low quantitative evidence. Add revenue, growth, retention, CAC/LTV, or conversion metrics.")
    if missing_stage_terms:
        risks.insert(1, f"Stage mismatch for {stage}: missing {', '.join(missing_stage_terms[:3])} signals.")

    weakest = sorted(categories.items(), key=lambda kv: kv[1])[:3]
    result = {
        "mode": "text",
        "overall_score": overall,
        "accuracy_checker": checker,
        "categories": categories,
        "strengths": strengths,
        "risks": risks,
        "training_keywords": top_keywords(text),
        "stage_expectations": stage_terms,
        "missing_stage_signals": missing_stage_terms,
        "dataset_training_detail": trained,
        "fix_plan": build_fix_plan(categories, words),
        "rewrite_suggestion": generate_rewrite(text, sector, weakest),
        "project_summary": {
            "dataset_rows": DATASET_PROFILE["stats"]["rows"],
            "avg_rating": DATASET_PROFILE["stats"]["avg_rating"],
            "available_sectors": DATASET_PROFILE["stats"]["sectors"],
            "available_stages": DATASET_PROFILE["stats"]["stages"],
        },
        "how_it_works": build_how_it_works("text", sector, stage, words),
        "execution_summary": build_execution_summary(categories, missing_stage_terms, checker),
    }
    return apply_llm_enrichment(result, maybe_call_llm("text", payload, result))


def analyze_video(payload):
    transcript = (payload.get("transcript") or "").strip()
    base = analyze_text({"text": transcript, "sector": payload.get("sector", "general"), "stage": payload.get("stage", "early")})
    metrics = payload.get("image_metrics") or {}
    brightness = float(metrics.get("brightness", 0.55))
    contrast = float(metrics.get("contrast", 0.5))
    sharpness = float(metrics.get("sharpness", 0.5))
    text_density = float(metrics.get("text_density", 0.5))
    stability = float(metrics.get("stability", 0.5))
    delivery = payload.get("delivery") or {}
    energy = float(delivery.get("energy", 0.7))
    pace = float(delivery.get("pace", 0.7))

    visual_categories = {
        "visual_clarity": clamp(35 + sharpness * 45 + contrast * 15),
        "slide_readability": clamp(30 + text_density * 35 + contrast * 15),
        "camera_stability": clamp(30 + stability * 60),
        "lighting_quality": clamp(30 + brightness * 55),
        "delivery_presence": clamp(38 + energy * 38 + pace * 18),
    }

    merged = dict(base["categories"])
    merged.update(visual_categories)
    base["mode"] = "video"
    base["categories"] = merged
    visual_avg = sum(visual_categories.values()) / len(visual_categories)
    base["overall_score"] = clamp(base["overall_score"] * 0.72 + visual_avg * 0.28)
    base["visual_metrics"] = {"brightness": round(brightness, 3), "contrast": round(contrast, 3), "sharpness": round(sharpness, 3), "text_density": round(text_density, 3), "stability": round(stability, 3), "energy": round(energy, 3), "pace": round(pace, 3)}
    base["accuracy_checker"]["detail"]["visual_readiness"] = clamp(visual_avg)
    base["accuracy_checker"]["confidence"] = clamp(base["accuracy_checker"]["confidence"] * 0.78 + visual_avg * 0.22)
    base["fix_plan"]["improve_next"] = base["fix_plan"].get("improve_next", []) + [
        {"area": "slide_readability", "score": visual_categories["slide_readability"], "priority": "medium", "fix": "Increase slide font size and contrast so the sampled frame text stays readable.", "example": "Use 6 lines or fewer per slide with strong foreground/background contrast."},
        {"area": "camera_stability", "score": visual_categories["camera_stability"], "priority": "medium", "fix": "Keep the framing stable during key points.", "example": "Use a tripod or fixed laptop framing during the pitch."},
    ]
    base["how_it_works"] = build_how_it_works("video", payload.get("sector", "general"), payload.get("stage", "early"), sentence_stats(transcript)[0]) + [
        "5. Added transcript delivery and visual heuristics to estimate on-camera clarity.",
    ]
    base["execution_summary"] = build_execution_summary(base["categories"], base["missing_stage_signals"], base["accuracy_checker"])
    return apply_llm_enrichment(base, maybe_call_llm("video", payload, base))


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json_response(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length) if length else b"{}"
        return json.loads(data.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ["/", "/index.html"]:
            html = INDEX_PATH.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        if parsed.path == "/api/health":
            return self._json_response({
                "status": "ok",
                "dataset_rows": DATASET_PROFILE["stats"]["rows"],
                "llm_configured": bool(LLM_ENDPOINT and LLM_API_KEY),
            })
        if parsed.path == "/api/training/dataset":
            preview = [{**{key: example[key] for key in ["id", "sector", "stage", "rating", "quality"]}, "pitch_preview": example["pitch"][:220]} for example in TRAINING_DATASET]
            return self._json_response({"stats": DATASET_PROFILE["stats"], "examples": preview})
        self._json_response({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self._read_json()
        except Exception:
            return self._json_response({"error": "Invalid JSON"}, 400)

        if parsed.path in ("/api/analyze/free/text", "/api/analyze/text"):
            text = (payload.get("text") or "").strip()
            if len(text) < 12:
                return self._json_response({"error": "Pitch is too short to analyze.", "fix": "Provide at least 12 characters and ideally 180+ words."}, 400)
            return self._json_response(analyze_text(payload))

        if parsed.path in ("/api/analyze/free/video", "/api/analyze/video"):
            transcript = (payload.get("transcript") or "").strip()
            if len(transcript) < 12:
                return self._json_response({"error": "Transcript is too short to analyze.", "fix": "Provide at least 12 characters and ideally 180+ words."}, 400)
            return self._json_response(analyze_video(payload))

        self._json_response({"error": "Not found"}, 404)


def run(host="127.0.0.1", port=8080):
    server = HTTPServer((host, port), Handler)
    print(f"AstraPitch backend running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()

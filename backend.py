#!/usr/bin/env python3
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "index.html"

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
    "fundraise_clarity": ["raising", "use of funds", "runway", "milestone", "ask", "valuation"],
    "risk_awareness": ["risk", "mitigation", "regulatory", "execution", "dependency", "contingency"],
}

STOPWORDS = {
    "the", "a", "an", "and", "or", "to", "of", "in", "is", "for", "on", "with", "that", "this", "we", "our", "by", "as",
    "be", "are", "it", "from", "at", "you", "your", "can", "will", "have", "has", "their", "they", "but", "not", "into"
}

FIX_LIBRARY = {
    "problem_definition": {
        "priority": "high",
        "fix": "State one clear customer pain and quantify it (time/money loss).",
        "example": "'Finance teams lose 11 hours/week reconciling payouts manually.'"
    },
    "solution_quality": {
        "priority": "high",
        "fix": "Explain exactly how your product solves that pain in one workflow.",
        "example": "'Our engine auto-matches payouts to ledger entries with 96% precision.'"
    },
    "market_strength": {
        "priority": "high",
        "fix": "Include TAM/SAM/SOM and ideal customer profile.",
        "example": "'TAM $9.4B, SAM $1.3B, targeting 2k mid-market fintech firms.'"
    },
    "business_model": {
        "priority": "medium",
        "fix": "Add pricing model, gross margin assumption, and sales cycle.",
        "example": "'$6k/month base + usage, 78% gross margin, 45-day sales cycle.'"
    },
    "traction": {
        "priority": "high",
        "fix": "Show momentum metrics across time (growth, retention, conversion).",
        "example": "'MRR grew from $18k to $38k in 4 months with 94% gross retention.'"
    },
    "competition_moat": {
        "priority": "medium",
        "fix": "Compare against alternatives and define your defensible moat.",
        "example": "'Only platform with real-time fraud graph + bank-grade audit trail.'"
    },
    "fundraise_clarity": {
        "priority": "high",
        "fix": "Specify raise amount, runway target, and milestone outcomes.",
        "example": "'Raising $2.5M for 24 months runway to reach $150k MRR and SOC2.'"
    },
    "risk_awareness": {
        "priority": "medium",
        "fix": "Name top execution risks and mitigation actions.",
        "example": "'Regulatory risk mitigated via quarterly external compliance audits.'"
    },
    "sector_alignment": {
        "priority": "medium",
        "fix": "Use sector-specific language and metrics investors expect.",
        "example": "'For SaaS include CAC, LTV, churn, expansion revenue.'"
    },
}

STAGE_EXPECTATIONS = {
    "idea": ["problem", "solution", "market", "raise", "milestone"],
    "mvp": ["pilot", "feedback", "pricing", "market", "raise"],
    "early": ["revenue", "retention", "growth", "unit economics", "raise"],
    "growth": ["expansion", "net retention", "efficiency", "pipeline", "moat"],
}

INVESTOR_SIGNAL_LIBRARY = {
    "positive": {
        "evidence": ["arr", "mrr", "retention", "conversion", "cohort", "gross margin", "payback"],
        "clarity": ["we solve", "our customer", "we charge", "we are raising", "use of funds"],
        "defensibility": ["proprietary", "data moat", "network effect", "switching cost", "regulatory edge"],
    },
    "negative": {
        "hype": ["revolutionary", "disrupt everything", "guaranteed", "no competition", "world changing"],
        "vague": ["huge market", "everyone", "all industries", "soon", "very fast"],
    }
}


def clamp(value, low=0, high=100):
    return max(low, min(high, round(value)))


def tokenize(text):
    return re.findall(r"[a-zA-Z][a-zA-Z\-']+", text.lower())


def top_keywords(text, n=10):
    freq = {}
    for tok in tokenize(text):
        if len(tok) < 4 or tok in STOPWORDS:
            continue
        freq[tok] = freq.get(tok, 0) + 1
    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
    return [f"{k} ({v})" for k, v in ranked]


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
    band = get_size_band(words)
    if band == "very_short":
        return -16
    if band == "short":
        return -6
    if band == "standard":
        return 6
    if band == "long":
        return 2
    return -8


def category_score(text, terms, words):
    hits = count_matches(text, terms)
    density_bonus = min(20, words / 24)
    return clamp(22 + hits * 12 + density_bonus)


def phrase_density_score(text, terms):
    words, _, _ = sentence_stats(text)
    hits = count_matches(text, terms)
    density = (hits * 1000) / max(60, words)
    return clamp(20 + (hits * 10) + density)


def stage_alignment_score(text, stage):
    expected = STAGE_EXPECTATIONS.get(stage, STAGE_EXPECTATIONS["early"])
    lower = text.lower()
    hits = sum(1 for term in expected if term in lower)
    missing = [term for term in expected if term not in lower]
    return clamp(30 + hits * 14), expected, missing


def keyword_training_signals(text):
    positive = INVESTOR_SIGNAL_LIBRARY["positive"]
    negative = INVESTOR_SIGNAL_LIBRARY["negative"]
    pos_hits = {bucket: count_matches(text, terms) for bucket, terms in positive.items()}
    neg_hits = {bucket: count_matches(text, terms) for bucket, terms in negative.items()}
    score = clamp(50 + sum(pos_hits.values()) * 8 - sum(neg_hits.values()) * 10)
    return {
        "score": score,
        "positive_hits": pos_hits,
        "negative_hits": neg_hits,
    }


def accuracy_checker(text, category_scores):
    words, sents, avg_words = sentence_stats(text)
    numeric, perc, money = extract_numeric_signals(text)
    size_band = get_size_band(words)

    structure = 52
    if words > 120:
        structure += 10
    if sents > 6:
        structure += 8
    if 11 <= avg_words <= 28:
        structure += 10
    structure += size_adjustment(words)

    evidence = 30 + min(40, numeric * 4) + min(10, perc * 2) + min(10, money * 2)
    consistency = 38 + (sum(category_scores.values()) / len(category_scores)) * 0.5
    specificity = clamp(28 + min(26, len(top_keywords(text)) * 2.6) + min(24, count_matches(text, ["tam", "sam", "som", "icp", "cohort", "retention"]) * 6))
    balance = clamp(35 + min(35, count_matches(text, ["risk", "mitigation", "assumption", "dependency"]) * 8) + min(20, sents * 1.3))

    flags = []
    if "guarantee" in text.lower() or "no risk" in text.lower():
        flags.append("Avoid absolute claims like 'guarantee' or 'no risk'.")
    if size_band in ("very_short", "short"):
        flags.append("Pitch is short for investment diligence; add market, moat, and fundraise details.")
    if size_band in ("long", "very_long"):
        flags.append("Pitch is long; tighten narrative and lead with strongest proof first.")

    confidence = clamp((structure * 0.28) + (evidence * 0.30) + (consistency * 0.24) + (specificity * 0.10) + (balance * 0.08) - (8 if "guarantee" in text.lower() else 0))

    reasons = []
    if evidence < 60:
        reasons.append("Low metric density detected; add concrete revenue/retention values.")
    if structure < 60:
        reasons.append("Structure is thin; add clearer problem, solution, and fundraise flow.")
    if specificity < 60:
        reasons.append("Specificity is weak; include market sizing and customer segment detail.")
    if not reasons:
        reasons.append("Strong signal quality for investor diligence review.")

    return {
        "confidence": confidence,
        "size_band": size_band,
        "detail": {
            "structure": clamp(structure),
            "evidence": clamp(evidence),
            "consistency": clamp(consistency),
            "specificity": specificity,
            "balance": balance,
            "flags": flags
        },
        "reasons": reasons,
    }


def build_fix_plan(categories, words):
    ordered = sorted(categories.items(), key=lambda kv: kv[1])
    must_fix = []
    improve_next = []
    polish = []

    for name, score in ordered:
        entry = FIX_LIBRARY.get(name)
        if not entry:
            continue
        item = {
            "area": name,
            "score": score,
            "priority": entry["priority"],
            "fix": entry["fix"],
            "example": entry["example"],
        }
        if len(must_fix) < 3 and (score < 50 or entry["priority"] == "high"):
            must_fix.append(item)
        elif len(improve_next) < 3:
            improve_next.append(item)
        elif len(polish) < 2:
            polish.append(item)

    size_guidance = {
        "size_band": get_size_band(words),
        "word_count": words,
        "recommendation": (
            "Expand to 180-450 words for stronger investor signal." if words < 180 else
            "Good length for most investor intros." if words <= 650 else
            "Consider a shorter investor version (250-600 words) plus appendix."
        )
    }

    return {
        "must_fix_first": must_fix,
        "improve_next": improve_next,
        "polish_last": polish,
        "size_guidance": size_guidance,
    }


def analyze_text(payload):
    text = (payload.get("text") or "").strip()
    sector = (payload.get("sector") or "general").lower()
    stage = (payload.get("stage") or "early").lower()
    words, _, _ = sentence_stats(text)
    numeric, _, _ = extract_numeric_signals(text)

    categories = {k: category_score(text, v, words) for k, v in CATEGORY_TERMS.items()}

    sector_terms = SECTOR_KEYWORDS.get(sector, SECTOR_KEYWORDS["general"])
    categories["sector_alignment"] = phrase_density_score(text, sector_terms)
    stage_alignment, stage_terms, missing_stage_terms = stage_alignment_score(text, stage)
    categories["stage_alignment"] = stage_alignment
    trained = keyword_training_signals(text)
    categories["keyword_training"] = trained["score"]

    if stage == "idea":
        categories["traction"] = max(categories["traction"] - 8, 18)
    if stage == "growth":
        categories["business_model"] = clamp(categories["business_model"] + 8)

    checker = accuracy_checker(text, categories)
    overall = clamp((sum(categories.values()) / len(categories)) + size_adjustment(words) * 0.5)

    ordered = sorted(categories.items(), key=lambda kv: kv[1], reverse=True)
    strengths = [f"{k.replace('_', ' ').title()}: {v}/100" for k, v in ordered[:4]]
    risks = [f"{k.replace('_', ' ').title()}: {v}/100" for k, v in ordered[-4:]]

    if numeric < 4:
        risks.insert(0, "Low quantitative evidence. Add concrete metrics (% growth, revenue, retention, CAC/LTV).")
    if missing_stage_terms:
        risks.insert(1, f"Stage mismatch for {stage}: missing {', '.join(missing_stage_terms[:3])} signals.")

    return {
        "mode": "text",
        "overall_score": overall,
        "accuracy_checker": checker,
        "categories": categories,
        "strengths": strengths,
        "risks": risks,
        "training_keywords": top_keywords(text),
        "stage_expectations": stage_terms,
        "missing_stage_signals": missing_stage_terms,
        "keyword_training_detail": trained,
        "fix_plan": build_fix_plan(categories, words),
    }


def analyze_video(payload):
    transcript = (payload.get("transcript") or "").strip()
    base = analyze_text({
        "text": transcript,
        "sector": payload.get("sector", "general"),
        "stage": payload.get("stage", "early"),
    })

    metrics = payload.get("image_metrics") or {}
    brightness = float(metrics.get("brightness", 0.55))
    contrast = float(metrics.get("contrast", 0.50))
    sharpness = float(metrics.get("sharpness", 0.50))
    text_density = float(metrics.get("text_density", 0.50))
    stability = float(metrics.get("stability", 0.50))

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
    base["overall_score"] = clamp((base["overall_score"] * 0.72) + ((sum(visual_categories.values()) / len(visual_categories)) * 0.28))
    base["visual_metrics"] = {
        "brightness": round(brightness, 3),
        "contrast": round(contrast, 3),
        "sharpness": round(sharpness, 3),
        "text_density": round(text_density, 3),
        "stability": round(stability, 3),
    }

    base["accuracy_checker"]["detail"]["visual_readiness"] = clamp(sum(visual_categories.values()) / len(visual_categories))
    base["accuracy_checker"]["confidence"] = clamp(base["accuracy_checker"]["confidence"] * 0.78 + base["accuracy_checker"]["detail"]["visual_readiness"] * 0.22)

    # Add clear visual fixes for video mode.
    base["fix_plan"]["improve_next"] = base["fix_plan"].get("improve_next", []) + [
        {
            "area": "slide_readability",
            "score": visual_categories["slide_readability"],
            "priority": "medium",
            "fix": "Increase slide font size and boost contrast for readability.",
            "example": "Use dark text on light background, with max 6 lines per slide."
        },
        {
            "area": "camera_stability",
            "score": visual_categories["camera_stability"],
            "priority": "medium",
            "fix": "Keep framing stable and centered during key points.",
            "example": "Use tripod or fixed laptop position to reduce frame shake."
        }
    ]
    return base


class Handler(BaseHTTPRequestHandler):
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
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = self._read_json()
        except Exception:
            return self._json_response({"error": "Invalid JSON"}, 400)

        if parsed.path == "/api/analyze/free/text":
            text = (payload.get("text") or "").strip()
            if len(text) < 12:
                return self._json_response({
                    "error": "Pitch is too short to analyze.",
                    "fix": "Provide at least 12 characters (preferably 180+ words for quality analysis)."
                }, 400)
            return self._json_response(analyze_text(payload))

        if parsed.path == "/api/analyze/free/video":
            transcript = (payload.get("transcript") or "").strip()
            if len(transcript) < 12:
                return self._json_response({
                    "error": "Transcript is too short to analyze.",
                    "fix": "Provide at least 12 characters (preferably 180+ words for quality analysis)."
                }, 400)
            return self._json_response(analyze_video(payload))

        if parsed.path == "/api/analyze/pro":
            # TODO: Pro backend hookup placeholder.
            # 1) Validate customer API key + subscription tier.
            # 2) Route to your hosted LLM/video-model endpoint.
            # 3) Merge paid model result with local reliability + fix_plan output.
            # 4) Return same schema as free endpoints for UI compatibility.
            return self._json_response({
                "error": "Pro API backend is not connected yet.",
                "todo": "Wire this endpoint to your paid model service when ready.",
                "fix": "Use free endpoints now; keep same response schema when enabling Pro."
            }, 501)

        self._json_response({"error": "Not found"}, 404)


def main():
    server = HTTPServer(("0.0.0.0", 8080), Handler)
    print("AstraPitch backend running on http://0.0.0.0:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()

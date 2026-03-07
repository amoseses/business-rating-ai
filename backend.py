#!/usr/bin/env python3
import json
import math
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


def clamp(value, low=0, high=100):
    return max(low, min(high, round(value)))


def tokenize(text):
    return re.findall(r"[a-zA-Z][a-zA-Z\-']+", text.lower())


def top_keywords(text, n=8):
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


def category_score(text, terms, words):
    hits = count_matches(text, terms)
    density_bonus = min(20, words / 22)
    return clamp(25 + hits * 13 + density_bonus)


def accuracy_checker(text, category_scores):
    words, sents, avg_words = sentence_stats(text)
    numeric, perc, money = extract_numeric_signals(text)

    structure = 55
    if words > 160:
        structure += 12
    if sents > 8:
        structure += 10
    if 12 <= avg_words <= 28:
        structure += 10

    evidence = 35 + min(35, numeric * 4) + min(10, perc * 2) + min(8, money * 2)
    consistency = 40 + (sum(category_scores.values()) / len(category_scores)) * 0.45
    caution_penalty = 8 if "guarantee" in text.lower() or "no risk" in text.lower() else 0

    confidence = clamp((structure * 0.3) + (evidence * 0.35) + (consistency * 0.35) - caution_penalty)
    return {
        "confidence": confidence,
        "detail": {
            "structure": clamp(structure),
            "evidence": clamp(evidence),
            "consistency": clamp(consistency),
            "flags": ["Avoid absolute claims like 'guarantee' or 'no risk'."] if caution_penalty else []
        }
    }


def build_actions(lowest_categories):
    fixes = {
        "problem_definition": "Open with one painful customer moment and quantify the pain in dollars or time.",
        "solution_quality": "Add a before/after workflow and one proof of why your approach works better.",
        "market_strength": "Include TAM/SAM/SOM with source and a clear ICP definition.",
        "business_model": "Show pricing tiers, gross margin assumptions, and sales cycle.",
        "traction": "Add retention, conversion, and growth trend over at least 3 periods.",
        "competition_moat": "Use a competitor matrix and define your moat in one sentence.",
        "fundraise_clarity": "State the exact raise amount, runway, and milestone outcomes.",
        "risk_awareness": "Name top 3 risks and your mitigation plan with owners.",
    }
    return [fixes.get(cat, "Improve clarity and proof density.") for cat in lowest_categories]


def analyze_text(payload):
    text = payload.get("text", "").strip()
    sector = (payload.get("sector") or "general").lower()
    stage = (payload.get("stage") or "early").lower()
    words, _, _ = sentence_stats(text)
    numeric, _, _ = extract_numeric_signals(text)

    categories = {
        key: category_score(text, terms, words)
        for key, terms in CATEGORY_TERMS.items()
    }

    sector_terms = SECTOR_KEYWORDS.get(sector, SECTOR_KEYWORDS["general"])
    sector_alignment = clamp(30 + count_matches(text, sector_terms) * 10)
    categories["sector_alignment"] = sector_alignment

    if stage == "idea":
        categories["traction"] = max(categories["traction"] - 10, 20)
    if stage == "growth":
        categories["business_model"] = clamp(categories["business_model"] + 8)

    overall = clamp(sum(categories.values()) / len(categories))
    checker = accuracy_checker(text, categories)

    ordered = sorted(categories.items(), key=lambda kv: kv[1], reverse=True)
    strengths = [f"{k.replace('_', ' ').title()}: {v}/100" for k, v in ordered[:4]]
    risks = [f"{k.replace('_', ' ').title()}: {v}/100" for k, v in ordered[-4:]]

    if numeric < 4:
        risks.insert(0, "Low quantitative evidence. Add more concrete metrics.")

    return {
        "mode": "text",
        "overall_score": overall,
        "accuracy_checker": checker,
        "categories": categories,
        "strengths": strengths,
        "risks": risks,
        "training_keywords": top_keywords(text),
        "actions": build_actions([k for k, _ in ordered[-3:]]),
    }


def analyze_video(payload):
    transcript = payload.get("transcript", "").strip()
    base = analyze_text({
        "text": transcript,
        "sector": payload.get("sector", "general"),
        "stage": payload.get("stage", "early"),
    })
    metrics = payload.get("image_metrics") or {}

    brightness = float(metrics.get("brightness", 0.55))
    contrast = float(metrics.get("contrast", 0.5))
    sharpness = float(metrics.get("sharpness", 0.5))
    text_density = float(metrics.get("text_density", 0.5))
    stability = float(metrics.get("stability", 0.5))

    visual_categories = {
        "visual_clarity": clamp(40 + (sharpness * 40) + (contrast * 20)),
        "slide_readability": clamp(35 + (text_density * 25) + (contrast * 20)),
        "camera_stability": clamp(30 + stability * 60),
        "lighting_quality": clamp(30 + brightness * 50),
    }

    delivery = payload.get("delivery") or {}
    energy = float(delivery.get("energy", 0.7))
    pace = float(delivery.get("pace", 0.7))
    presence = clamp(40 + energy * 35 + pace * 20)
    visual_categories["delivery_presence"] = presence

    merged = dict(base["categories"])
    merged.update(visual_categories)
    overall = clamp(sum(merged.values()) / len(merged))

    base["mode"] = "video"
    base["categories"] = merged
    base["overall_score"] = overall
    base["visual_metrics"] = {
        "brightness": round(brightness, 3),
        "contrast": round(contrast, 3),
        "sharpness": round(sharpness, 3),
        "text_density": round(text_density, 3),
        "stability": round(stability, 3),
    }
    base["actions"] = base["actions"] + [
        "Tighten slide contrast and increase font size for readability.",
        "Stabilize camera framing and maintain consistent lighting.",
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
            if len(text) < 40:
                return self._json_response({"error": "Please provide at least 40 characters."}, 400)
            return self._json_response(analyze_text(payload))

        if parsed.path == "/api/analyze/free/video":
            transcript = (payload.get("transcript") or "").strip()
            if len(transcript) < 40:
                return self._json_response({"error": "Please provide a transcript with at least 40 characters."}, 400)
            return self._json_response(analyze_video(payload))

        if parsed.path == "/api/analyze/pro":
            # TODO: Pro backend hookup placeholder.
            # 1) Validate customer API key + subscription tier.
            # 2) Call your hosted LLM/video intelligence endpoint.
            # 3) Merge external model output with local reliability checks.
            # 4) Return final schema matching free endpoints.
            return self._json_response({
                "error": "Pro API backend is not connected yet.",
                "todo": "Wire this endpoint to your paid model service when ready."
            }, 501)

        self._json_response({"error": "Not found"}, 404)


def main():
    server = HTTPServer(("0.0.0.0", 8080), Handler)
    print("AstraPitch backend running on http://0.0.0.0:8080")
    server.serve_forever()


if __name__ == "__main__":
    main()

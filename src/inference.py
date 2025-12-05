import json, re
try:
    from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
    HF_AVAILABLE = True
except Exception:
    HF_AVAILABLE = False
from src.schema import validate_rating
DEFAULT_PROMPT = '''You are an extremely critical investor. Rate the pitch from 1-10 (1=very poor, 10=excellent) harshly.\nReturn JSON only with keys: scores (team, market, product, financials, risk, overall) and justification.\n'''
def _heuristic_score(text):
    words = len(re.findall(r"\\w+", text or ""))
    sentences = max(1, len(re.findall(r"[.!?]", text or "")))
    traction = 1 if 'MRR' in text.upper() or '$' in text else 0
    team = 4 + min(3, words // 200)
    market = 4 + min(3, words // 250)
    product = 4 + traction
    financials = 3 + min(4, words // 400)
    risk = max(1, 8 - (words // 300))
    overall = round((team + market + product + financials) / 4, 2)
    return {
        'scores': {
            'team': float(team), 'market': float(market), 'product': float(product), 'financials': float(financials), 'risk': float(risk), 'overall': float(overall)
        },
        'justification': 'Heuristic scorer: limited model; treat as baseline.'
    }
def _parse_json_from_text(out_text):
    start = out_text.find('{')
    end = out_text.rfind('}')
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(out_text[start:end+1])
    except Exception:
        return None
def hf_generate_rating(model_name, text):
    if not HF_AVAILABLE:
        raise RuntimeError('HF transformers not installed')
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map='auto')
    pipe = pipeline('text-generation', model=model, tokenizer=tokenizer, return_full_text=False)
    prompt = DEFAULT_PROMPT + "\n\nPitch:\n" + text + "\n\nJSON:"
    out = pipe(prompt, max_length=512, do_sample=False)[0]['generated_text']
    parsed = _parse_json_from_text(out)
    if parsed:
        return parsed
    return {'scores': {}, 'justification': out}
def rate_text(text, model='gpt2'):
    text = text or ''
    if not text.strip():
        raise ValueError('Empty pitch text')
    if HF_AVAILABLE:
        try:
            raw = hf_generate_rating(model, text)
        except Exception:
            raw = _heuristic_score(text)
    else:
        raw = _heuristic_score(text)
    try:
        return validate_rating(raw)
    except Exception:
        return validate_rating(_heuristic_score(text))

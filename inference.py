import os, json, argparse
from typing import Dict
from transformers import AutoTokenizer, AutoModelForCausalLM, pipeline

DEFAULT_PROMPT = '''You are an extremely critical investor. Rate the pitch from 1-10 (1=very poor, 10=excellent) harshly.
Return JSON only with keys: scores (team, market, product, financials, risk, overall) and justification.
'''

def hf_infer(model_name, pitch_text, max_length=512):
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map='auto')
    pipe = pipeline("text-generation", model=model, tokenizer=tokenizer, return_full_text=False)
    prompt = DEFAULT_PROMPT + "\n\nPitch:\n" + pitch_text + "\n\nJSON:"
    out = pipe(prompt, max_length=max_length, do_sample=False)[0]['generated_text']
    # try to find JSON in output
    start = out.find('{')
    end = out.rfind('}')
    if start != -1 and end != -1:
        try:
            return json.loads(out[start:end+1])
        except:
            pass
    # fallback: return text
    return {"raw": out}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='gpt2', help='Hugging Face model id or local path')
    parser.add_argument('--pitch', required=True, help='Path to pitch text file')
    args = parser.parse_args()
    with open(args.pitch, 'r', encoding='utf-8') as f:
        pitch_text = f.read()
    res = hf_infer(args.model, pitch_text)
    print(json.dumps(res, indent=2))

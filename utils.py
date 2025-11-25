import os, json, uuid
from typing import Dict

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def save_jsonl(path, obj):
    ensure_dir(os.path.dirname(path))
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

def load_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]

def make_pitch_id():
    return uuid.uuid4().hex

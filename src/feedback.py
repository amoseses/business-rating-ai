from .utils import save_jsonl, make_pitch_id
import time

DEFAULT_FEEDBACK_FILE = "data/training/corrections.jsonl"

def store_correction(pitch_text, ai_scores, corrected_scores, notes, pitch_id=None):
    if pitch_id is None:
        pitch_id = make_pitch_id()
    obj = {
        "timestamp": int(time.time()),
        "pitch_id": pitch_id,
        "pitch_text": pitch_text,
        "ai_scores": ai_scores,
        "corrected_scores": corrected_scores,
        "notes": notes
    }
    save_jsonl(DEFAULT_FEEDBACK_FILE, obj)
    return obj

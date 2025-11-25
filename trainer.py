# Trainer template for supervised fine-tuning (LoRA) using HuggingFace + PEFT.
# WARNING: Fine-tuning large models requires GPUs and careful resource management.
# This script prepares a Dataset and shows the TrainingArguments; adjust for your infra.

import json, os
from datasets import Dataset
from transformers import AutoTokenizer

DEFAULT_CORRECTIONS = "data/training/corrections.jsonl"

def load_corrections(path=DEFAULT_CORRECTIONS):
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    with open(path, 'r', encoding='utf-8') as f:
        return [json.loads(l) for l in f if l.strip()]

def prepare_supervised_examples(corrections):
    examples = []
    for item in corrections:
        prompt = "Rate this pitch harshly. Return JSON with scores and justification.\n\nPitch:\n" + item['pitch_text']
        # Target is the corrected_scores plus a short rationale
        target = json.dumps({
            "scores": item['corrected_scores'],
            "justification": item.get('notes','')
        })
        examples.append({"prompt": prompt, "target": target})
    return examples

def build_dataset(examples, tokenizer_name='gpt2'):
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
    texts = [e['prompt'] + "\n\n" + e['target'] for e in examples]
    ds = Dataset.from_dict({'text': texts})
    return ds

if __name__ == '__main__':
    corrections = load_corrections()
    examples = prepare_supervised_examples(corrections)
    ds = build_dataset(examples)
    print("Prepared dataset with", len(ds), "examples")
    print(ds[0])
    print("\nNext steps:")
    print(" - Configure PEFT/LoRA and TrainingArguments.")
    print(" - Use Trainer from transformers or accelerate to run fine-tuning on GPU.")

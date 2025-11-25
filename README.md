# Business Rating AI - Full Repo (Starter)

This repository contains a complete starter project for a standalone **Business Rating AI** engine
that runs on Linux. It includes:

- Inference engine (`src/inference.py`) that rates pitches (OpenAI or HuggingFace)
- Feedback collector (`src/feedback.py`) to store human corrections
- Trainer (`src/trainer.py`) that prepares data for LoRA-style fine-tuning
- Utilities (`src/utils.py`, `src/extract_text.py`)
- Minimal FastAPI app (`app/api.py`) to expose inference (optional)
- Example data and scripts

**Important notes**
- This starter is intentionally framework-agnostic: you can use OpenAI API or a local HF model.
- Training/fine-tuning large models requires GPUs and additional configuration. The trainer is a template.
- Read the README for setup and running instructions.

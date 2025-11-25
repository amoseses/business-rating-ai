#!/usr/bin/env bash
# Create venv, install, run FastAPI for local testing
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.api:app --reload --host 0.0.0.0 --port 8000

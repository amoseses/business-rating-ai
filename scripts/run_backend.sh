#!/usr/bin/env bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.api:app --reload --port 8000

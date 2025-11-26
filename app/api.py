from fastapi import FastAPI, Form
import uvicorn
from src.inference import hf_infer

app = FastAPI(title="Business Rating AI")

@app.post("/rate/")
async def rate_text(pitch: str = Form(...), model: str = Form("gpt2")):
    # Simple endpoint to rate a pitch string
    res = hf_infer(model, pitch)
    return res

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000)

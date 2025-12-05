from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import tempfile, shutil, os, uuid, threading
from pathlib import Path
from src.media_extract import extract_text_from_file
from src.inference import rate_text
from typing import Optional

app = FastAPI(title="Business Rating AI")
# Change allow_origins to your frontend origin in production
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Simple in-memory job store (for dev). Use Redis/DB in production.
JOB_STORE = {}

def _background_job(job_id: str, file_path: Optional[str], pitch_text: Optional[str], model: str):
    try:
        JOB_STORE[job_id]['status'] = 'processing'
        JOB_STORE[job_id]['progress'] = 'extracting_text'
        if file_path:
            txt = extract_text_from_file(file_path)
        else:
            txt = pitch_text
        JOB_STORE[job_id]['progress'] = 'running_inference'
        res = rate_text(txt, model=model)
        JOB_STORE[job_id]['status'] = 'completed'
        JOB_STORE[job_id]['result'] = res
    except Exception as e:
        JOB_STORE[job_id]['status'] = 'failed'
        JOB_STORE[job_id]['error'] = str(e)
    finally:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass

@app.post('/rate/')
async def rate_endpoint(pitch: str = Form(None), model: str = Form('gpt2'), file: UploadFile = File(None), async_job: bool = Form(False)):
    """Accepts either pitch text or an uploaded file. Returns JSON rating or a job_id for async processing."""
    if not pitch and not file:
        raise HTTPException(status_code=400, detail='Provide pitch text or upload a file.')

    temp_path = None
    if file:
        suffix = Path(file.filename).suffix
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        temp_path = tmp.name
        with tmp as f:
            shutil.copyfileobj(file.file, f)

    # Decide sync vs async
    # Force async for large video files or if async_job=True
    if async_job or (temp_path and Path(temp_path).suffix.lower() in ['.mp4', '.mov', '.mkv']):
        job_id = uuid.uuid4().hex
        JOB_STORE[job_id] = {'status': 'accepted', 'progress': 'queued'}
        thread = threading.Thread(target=_background_job, args=(job_id, temp_path, pitch, model), daemon=True)
        thread.start()
        return JSONResponse({'job_id': job_id, 'status': 'accepted'}, status_code=202)

    # synchronous path
    try:
        text = extract_text_from_file(temp_path) if temp_path else pitch
        res = rate_text(text, model=model)
        return JSONResponse(res)
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass

@app.get('/status/{job_id}')
def status(job_id: str):
    job = JOB_STORE.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')
    return job

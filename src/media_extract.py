import os, subprocess, tempfile
from pathlib import Path
from pdfminer.high_level import extract_text as pdf_extract_text
try:
    import docx
except Exception:
    docx = None
try:
    import openai
    OPENAI_AVAILABLE = True
except Exception:
    OPENAI_AVAILABLE = False

def extract_text_from_pdf(path):
    return pdf_extract_text(path)

def extract_text_from_docx(path):
    if docx is None:
        raise RuntimeError('python-docx not installed')
    doc = docx.Document(path)
    paras = [p.text for p in doc.paragraphs if p.text.strip()]
    return '\n'.join(paras)

def extract_text_from_txt(path):
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()

def extract_text_from_audio(path):
    # Use OpenAI whisper-1 if OPENAI_API_KEY is set and openai installed
    if OPENAI_AVAILABLE and os.environ.get('OPENAI_API_KEY'):
        openai.api_key = os.environ.get('OPENAI_API_KEY')
        with open(path, 'rb') as af:
            try:
                resp = openai.Audio.transcriptions.create(file=af, model='whisper-1')
            except Exception:
                resp = openai.Audio.transcribe(model='whisper-1', file=af)
            if isinstance(resp, dict) and 'text' in resp:
                return resp['text']
            try:
                return resp.text
            except Exception:
                return str(resp)
    # If OpenAI not available, raise instructive error
    raise RuntimeError('No speech-to-text available. Set OPENAI_API_KEY and install openai, or plug a local STT.')

def extract_text_from_video(path):
    # extract audio to wav and transcribe
    tmp_fd, tmp_audio = tempfile.mkstemp(suffix='.wav')
    os.close(tmp_fd)
    cmd = ['ffmpeg', '-y', '-i', path, '-ar', '16000', '-ac', '1', '-vn', '-f', 'wav', tmp_audio]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        txt = extract_text_from_audio(tmp_audio)
    finally:
        try:
            os.remove(tmp_audio)
        except:
            pass
    return txt

def extract_text_from_file(path):
    path = str(path)
    suffix = Path(path).suffix.lower()
    if suffix in ['.txt']:
        return extract_text_from_txt(path)
    if suffix in ['.pdf']:
        return extract_text_from_pdf(path)
    if suffix in ['.docx', '.doc']:
        return extract_text_from_docx(path)
    if suffix in ['.wav', '.mp3', '.m4a', '.flac']:
        return extract_text_from_audio(path)
    if suffix in ['.mp4', '.mov', '.mkv', '.avi', '.webm']:
        return extract_text_from_video(path)
    # fallback: try to read as text
    try:
        return extract_text_from_txt(path)
    except Exception as e:
        raise RuntimeError(f'Unsupported file type {suffix}: {e}')

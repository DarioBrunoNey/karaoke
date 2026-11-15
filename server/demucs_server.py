"""
Optionaler lokaler Dienst für Gesangstrennung in Studioqualität mit Demucs (Meta, MIT-Lizenz).
Läuft auf dem eigenen Rechner – es wird nichts ins Internet übertragen.

Einrichtung (einmalig, Python 3.10+; ffmpeg muss installiert sein):
    pip install demucs fastapi uvicorn python-multipart
Start:
    python server/demucs_server.py
In der App unter „Hilfe & Musikquellen" als Adresse eintragen:  http://localhost:8765
Hinweis: Läuft die App über https, muss auch dieser Dienst über https (oder localhost) erreichbar sein.
"""
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

OUT = Path(tempfile.gettempdir()) / "encore-stems"
OUT.mkdir(exist_ok=True)
MODEL = "htdemucs"

app = FastAPI(title="Encore Demucs-Dienst")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/separate")
async def separate(file: UploadFile = File(...)):
    job = uuid.uuid4().hex
    work = OUT / job
    work.mkdir()
    src = work / "song"
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    cmd = [sys.executable, "-m", "demucs", "-n", MODEL, "--two-stems", "vocals", "--mp3", "--mp3-bitrate", "256", "-o", str(work), str(src)]
    run = subprocess.run(cmd, capture_output=True, text=True)
    if run.returncode != 0:
        raise HTTPException(500, run.stderr[-800:])
    res = work / MODEL / "song"
    if not (res / "vocals.mp3").exists():
        raise HTTPException(500, "Demucs hat keine Stems erzeugt")
    return {"vocals": f"/stems/{job}/vocals.mp3", "instrumental": f"/stems/{job}/no_vocals.mp3"}


@app.get("/stems/{job}/{name}")
def stem(job: str, name: str):
    if not job.isalnum() or name not in ("vocals.mp3", "no_vocals.mp3"):
        raise HTTPException(404)
    path = OUT / job / MODEL / "song" / name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="audio/mpeg")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)

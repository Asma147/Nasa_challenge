import os
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

import project

MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", "/data")).resolve()
MAX_JOBS = int(os.environ.get("MAX_JOBS", "2"))
QUEUE_TIMEOUT = float(os.environ.get("QUEUE_TIMEOUT", "5"))

_slots = threading.BoundedSemaphore(MAX_JOBS)

COLOR_MODES = {
    "ndvi": (project.video_to_ndvi, project.ndvi_range),
    "co": (project.video_to_co, project.co_range),
    "temp": (project.video_to_temperature, project.temp_range),
}
DEFAULT_FILES = {
    "ndvi": "video3.webm",
    "co": "video2.webm",
    "temp": "video1.webm",
    "lightning": "lightning.mp4",
    "aerosol": "aerosol.jpeg",
}
MODES = list(DEFAULT_FILES)

app = FastAPI(title="NASA sonification")


def parse_region(text: Optional[str]):
    if not text:
        return None
    try:
        x, y, w, h = (int(float(v)) for v in text.split(","))
    except ValueError:
        raise HTTPException(422, "region must be 'x,y,w,h' (4 numbers)")
    if x < 0 or y < 0 or w <= 0 or h <= 0:
        raise HTTPException(422, "region needs x,y >= 0 and w,h > 0")
    return (x, y, w, h)


def resolve_media(name: str) -> str:
    path = (MEDIA_DIR / name).resolve()
    if MEDIA_DIR not in path.parents:  # blocks ../ tricks
        raise HTTPException(400, "Invalid file name")
    if not path.is_file():
        raise HTTPException(404, f"File not found in media folder: {name}")
    return str(path)


@app.get("/health")
def health():
    return {"status": "ok", "media_dir": str(MEDIA_DIR), "modes": MODES}


@app.get("/files")
def files():
    return sorted(p.name for p in MEDIA_DIR.iterdir() if p.is_file())


@app.get("/project")
def project_endpoint(
    mode: str = Query(..., description="ndvi | co | temp | lightning | aerosol"),
    video: Optional[str] = Query(None, description="file name in the media folder"),
    region: Optional[str] = Query(None, description="x,y,w,h in original pixels"),
    position: bool = False,
    every_n: int = Query(10, ge=1, le=200),
):
    mode = mode.lower()
    if mode not in MODES:
        raise HTTPException(422, f"mode must be one of {MODES}")

    media = resolve_media(video or DEFAULT_FILES[mode])
    roi = parse_region(region)

    if not _slots.acquire(timeout=QUEUE_TIMEOUT):
        raise HTTPException(503, "Server busy, try again shortly")

    workdir = tempfile.mkdtemp(prefix="project_")
    wav = os.path.join(workdir, "out.wav")
    mid = os.path.join(workdir, "out.mid")

    try:
        if mode in COLOR_MODES:
            func, rng = COLOR_MODES[mode]
            project.generate_sound(
                video=media, extraction_function=func, value_range=rng,
                region=roi, output=wav, midi_path=mid,
            )
        elif mode == "lightning":
            project.generate_lightning_sound(
                video=media, region=roi, output=wav, midi_path=mid,
                position=position, every_n=every_n,
            )
        else:  # aerosol
            project.generate_aerosol_sound(
                media=media, region=roi, output=wav, midi_path=mid,
                every_n=every_n,
            )
    except (RuntimeError, ValueError) as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(422, str(exc))
    except Exception as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")
    finally:
        _slots.release()

    return FileResponse(
        wav,
        media_type="audio/wav",
        filename=f"{mode}_sonification.wav",
        background=BackgroundTask(shutil.rmtree, workdir, ignore_errors=True),
    )
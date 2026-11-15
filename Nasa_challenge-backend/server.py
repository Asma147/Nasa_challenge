import os
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
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
    "lightning": "lightning_light.mp4",
    "aerosol": "aerosol.jpeg",
}
MODES = list(DEFAULT_FILES)

app = FastAPI(title="NASA sonification")

_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


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


def _synthesize(mode, media, roi, wav, mid, position=False, every_n=10):
    """Run the right project.py function for the mode and write wav/mid."""
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
            media=media, region=roi, output=wav, midi_path=mid, every_n=every_n,
        )


def _audio_response(mode, media, roi, position=False, every_n=10, filename=None):
    if not _slots.acquire(timeout=QUEUE_TIMEOUT):
        raise HTTPException(503, "Server busy, try again shortly")

    workdir = tempfile.mkdtemp(prefix="project_")
    wav = os.path.join(workdir, "out.wav")
    mid = os.path.join(workdir, "out.mid")

    try:
        _synthesize(mode, media, roi, wav, mid, position=position, every_n=every_n)
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
        filename=filename,
        background=BackgroundTask(shutil.rmtree, workdir, ignore_errors=True),
    )


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

    return _audio_response(
        mode, media, roi, position=position, every_n=every_n,
        filename=f"{mode}_sonification.wav",
    )


LAYER_TO_MODE = {
    "ndvi": "ndvi", "vegetation": "ndvi",
    "co": "co",
    "temp": "temp", "temperature": "temp", "sst": "temp",
    "lightning": "lightning",
    "aerosol": "aerosol", "aerosols": "aerosol",
}

GEO_LON_MIN = float(os.environ.get("GEO_LON_MIN", "-180"))
GEO_LON_MAX = float(os.environ.get("GEO_LON_MAX", "180"))
GEO_LAT_MIN = float(os.environ.get("GEO_LAT_MIN", "-90"))
GEO_LAT_MAX = float(os.environ.get("GEO_LAT_MAX", "90"))


class SoundRequest(BaseModel):
    layer: str
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float


def geo_to_region(media, lat_min, lat_max, lon_min, lon_max):
    height, width = project.read_first_frame(media).shape[:2]
    lon_span = GEO_LON_MAX - GEO_LON_MIN
    lat_span = GEO_LAT_MAX - GEO_LAT_MIN

    x0 = (max(lon_min, GEO_LON_MIN) - GEO_LON_MIN) / lon_span * width
    x1 = (min(lon_max, GEO_LON_MAX) - GEO_LON_MIN) / lon_span * width
    y0 = (GEO_LAT_MAX - min(lat_max, GEO_LAT_MAX)) / lat_span * height
    y1 = (GEO_LAT_MAX - max(lat_min, GEO_LAT_MIN)) / lat_span * height

    x, y = int(x0), int(y0)
    w, h = int(x1) - x, int(y1) - y
    if w < 4 or h < 4:
        raise HTTPException(422, "The selected area is too small or outside the data")
    return (x, y, w, h)


@app.post("/sound")
def sound(req: SoundRequest):
    mode = LAYER_TO_MODE.get(req.layer.lower())
    if mode is None:
        raise HTTPException(
            422, f"Unknown layer '{req.layer}'. Known layers: {sorted(LAYER_TO_MODE)}")

    media = resolve_media(DEFAULT_FILES[mode])
    roi = geo_to_region(media, req.lat_min, req.lat_max, req.lon_min, req.lon_max)

    return _audio_response(mode, media, roi)
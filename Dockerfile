FROM python:3.11-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         fluidsynth fluid-soundfont-gm \
         ffmpeg build-essential pkg-config \
         libcairo2-dev libpango1.0-dev fonts-dejavu-core \
         libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sonify.py server.py render_video.py manim_scene.py ./

ENV MEDIA_DIR=/data \
    MAX_JOBS=2

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s \
  CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
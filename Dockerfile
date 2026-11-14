FROM python:3.11-slim

# fluidsynth renders MIDI -> WAV, fluid-soundfont-gm installs
# /usr/share/sounds/sf2/FluidR3_GM.sf2 (the path sonify.py expects)
RUN apt-get update \
    && apt-get install -y --no-install-recommends fluidsynth fluid-soundfont-gm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY project.py server.py ./

ENV MEDIA_DIR=/data \
    MAX_JOBS=2

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s \
  CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
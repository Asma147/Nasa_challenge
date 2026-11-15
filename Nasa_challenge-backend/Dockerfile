
FROM python:3.11-slim

# 1. Installation des outils système nécessaires
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fluidsynth \
        fluid-soundfont-gm \
    && rm -rf /var/lib/apt/lists/*

# 2. Dossier de travail
WORKDIR /app

# 3. Installation des dépendances Python
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# 4. Copie du backend
COPY project.py server.py ./

# 5. Configuration
ENV PYTHONUNBUFFERED=1 \
    MEDIA_DIR=/data \
    MAX_JOBS=2 \
    QUEUE_TIMEOUT=5 \
    CORS_ORIGINS=*

# 6. Port API
EXPOSE 8000

# 7. Vérification de santé
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1

# 8. Lancement FastAPI
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

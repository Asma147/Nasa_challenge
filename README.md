# Earth Jukebox (NASA Challenge)

Earth Jukebox turns NASA Earth-observation visualizations into sound. Explore a 3D globe, choose a data layer and a region, then listen to and download a generated sonification.

## Project layout

- `Nasa_challenge-frontend/` — static browser application served by Nginx. It renders the globe, visualization controls, region selection, accessibility options and audio player.
- `Nasa_challenge-backend/` — FastAPI service that analyzes the supplied media and generates WAV audio (and intermediate MIDI files).
- `Nasa_challenge-backend/resources/` — media used by the API: `video1.webm`, `video2.webm`, `video3.webm`, `lightning_light.mp4` and `aerosol.jpeg`.
- `Nasa_challenge-frontend/media/` — globe textures and media used for display in the browser.

## Features

The interface includes five visualizations:

| Layer | What it represents | Sound mapping |
| --- | --- | --- |
| Ocean currents / temperature | Sea-surface temperature | Warmer values map to higher notes; colder values to lower notes. |
| Carbon monoxide | Atmospheric carbon monoxide | Color-legend values map to notes; changes affect note dynamics. |
| Planet health / vegetation | Vegetation index (NDVI) | Denser vegetation maps to higher notes. |
| Lightning | Lightning detected in imagery | Detected activity triggers percussive sounds; activity affects intensity. |
| Aerosols | Black carbon, dust, sea salt and sulfate | Particle categories use different instrumental voices; abundance affects volume. |

Choose a preset geographic region or draw a custom area on the globe. The browser sends the selected geographic bounds to the backend, which maps them to a region of the source image/video. The audio player supports play/pause, seeking, playback speed and WAV download. An entry screen offers voice mode or normal navigation.

## Run with Docker Compose

Docker Compose files are maintained separately for the frontend and backend. Start each service in its own terminal from the repository root:

```sh
cd Nasa_challenge-backend
docker compose up --build
```

```sh
cd Nasa_challenge-frontend
docker compose up --build
```

The frontend is available at [http://localhost:8080](http://localhost:8080). The API is available at [http://localhost:8000](http://localhost:8000), with interactive API documentation at [http://localhost:8000/docs](http://localhost:8000/docs).

The backend Compose configuration mounts `Nasa_challenge-backend/resources` read-only at `/data`. The frontend currently calls `http://localhost:8000`; when hosting the frontend and backend on different machines or domains, update the `SERVEUR` constant in `Nasa_challenge-frontend/app.js` and configure backend CORS accordingly. The frontend loads `globe.gl` from `unpkg.com`, so the browser needs network access to that CDN.

Stop either service by running `docker compose down` in that service's directory.

## Run without Docker (backend)

The backend's Docker image is based on Python 3.11. A local Python setup also needs the packages in `Nasa_challenge-backend/requirements.txt`, the FluidSynth executable and a General MIDI SoundFont. On Debian/Ubuntu, install the system audio dependencies with:

```sh
sudo apt-get update
sudo apt-get install -y fluidsynth fluid-soundfont-gm
```

Then start the API:

```sh
cd Nasa_challenge-backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export MEDIA_DIR="$PWD/resources"
uvicorn server:app --host 0.0.0.0 --port 8000
```

Serve the frontend directory with any static web server on port 8080 (or another port). Opening `index.html` directly as a `file://` URL is not recommended because the app fetches its JSON catalog and media assets.

## API overview

### `GET /health`

Returns service status, configured media directory and supported modes.

### `GET /files`

Lists files in the configured media directory.

### `GET /project`

Generates a WAV from a selected mode. Query parameters:

- `mode` (required): `ndvi`, `co`, `temp`, `lightning` or `aerosol`.
- `video` (optional): media filename from the configured media directory; otherwise the mode's default file is used.
- `region` (optional): pixel rectangle in source-media coordinates, formatted `x,y,w,h`.
- `position` (optional, default `false`): use detected lightning position for pitch/panning.
- `every_n` (optional, default `10`, range 1–200): sample interval for lightning and aerosol processing.

The response is `audio/wav`.

### `POST /sound`

Generates sound for a geographic selection. Send JSON with numeric `lat_min`, `lat_max`, `lon_min` and `lon_max`, plus `layer`. Supported layer names include `vegetation`/`ndvi`, `co`, `temperature`/`temp`/`sst`, `lightning`, and `aerosol`/`aerosols`. The response is a WAV file. The geographic-to-pixel mapping defaults to longitude −180°…180° and latitude −90°…90°.

## Configuration

Backend environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MEDIA_DIR` | `/data` | Directory containing backend input media. |
| `MAX_JOBS` | `2` | Maximum concurrent audio-generation jobs. |
| `QUEUE_TIMEOUT` | `5` seconds | How long to wait for an available generation slot before returning HTTP 503. |
| `CORS_ORIGINS` | `*` | Comma-separated allowed browser origins. |
| `GEO_LON_MIN`, `GEO_LON_MAX` | `-180`, `180` | Longitude range used to map geographic selections to source pixels. |
| `GEO_LAT_MIN`, `GEO_LAT_MAX` | `-90`, `90` | Latitude range used to map geographic selections to source pixels. |

## Notes

- The backend's default inputs must exist in `Nasa_challenge-backend/resources/`: `video3.webm` (NDVI), `video2.webm` (CO), `video1.webm` (temperature), `lightning_light.mp4` (lightning) and `aerosol.jpeg` (aerosols).
- Audio rendering uses FluidSynth with `/usr/share/sounds/sf2/FluidR3_GM.sf2`; the backend Docker image installs FluidSynth and the General MIDI soundfont.
- Input media is read-only in the backend Compose setup. Generated WAV and MIDI files are written to temporary working directories; the API returns the WAV and removes the temporary files afterward.
- Requests may return HTTP 422 for invalid selections or media that cannot be analyzed, HTTP 503 when all generation slots remain occupied past the queue timeout, or HTTP 500 for unexpected processing errors.

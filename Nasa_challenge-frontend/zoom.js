
/* =========================================
   EARTH Jukebox - Region Zoom & Video Preview
   ========================================= */

window.EarthSenseZoom = (() => {
    let globe = null;
    let zone = null;
    let audio = null;

    let currentVisualization = null;
    let initialized = false;
    let previewClosed = false;

    let preview = null;
    let previewVideo = null;
    let previewTitle = null;

    // ----- INITIALISATION -----

    function init(options) {
        if (initialized) return;

        globe = options.globe;
        zone = options.zone;
        audio = options.audio;

        if (!globe || !zone || !audio) {
            console.error("EarthSenseZoom: missing initialization parameters.");
            return;
        }

        createPreview();
        connectAudio();

        initialized = true;
    }

    // ----- CRÉER LA FENÊTRE VIDÉO -----

    function createPreview() {
        preview = document.createElement("div");

        preview.id = "region-preview";
        preview.className = "region-preview";
        preview.hidden = true;

        preview.innerHTML = `
            <div class="region-preview-header">
                <span id="region-preview-title">
                    Selected region
                </span>

                <button
                    id="region-preview-close"
                    type="button"
                    aria-label="Close video preview">
                    &times;
                </button>
            </div>

            <video
                id="region-preview-video"
                playsinline
                muted
                loop
                preload="auto">
            </video>
        `;

        document.body.appendChild(preview);

        previewVideo = preview.querySelector(
            "#region-preview-video"
        );

        previewTitle = preview.querySelector(
            "#region-preview-title"
        );

        const closeButton = preview.querySelector(
            "#region-preview-close"
        );

        closeButton.addEventListener("click", () => {
            previewClosed = true;
            preview.hidden = true;
            previewVideo.pause();
        });
    }

    // ----- CHANGER DE VISUALISATION -----

    function setVisualization(disque) {
        currentVisualization = disque;
        previewClosed = false;

        previewVideo.pause();
        previewVideo.removeAttribute("src");
        previewVideo.load();

        preview.hidden = true;

        if (!disque || !disque.video) {
            return;
        }

        previewVideo.src = disque.video;
        previewTitle.textContent =
            disque.label + " — Selected region";

        previewVideo.load();
    }

    // ----- ZOOM SUR UNE RÉGION -----

    function zoomToRegion(region) {
        if (!globe || !region) return;

        const latitude =
            (region.lat_min + region.lat_max) / 2;

        const longitude =
            (region.lon_min + region.lon_max) / 2;

        globe.controls().autoRotate = false;

        globe.pointOfView({
            lat: latitude,
            lng: longitude,
            altitude: 1.45
        }, 1200);
    }

    // ----- AFFICHER L'APERÇU -----

    function showRegion(region) {
        if (!currentVisualization) return;

        zoomToRegion(region);
        previewClosed = false;

        if (!currentVisualization.video) {
            preview.hidden = true;
            return;
        }

        previewTitle.textContent =
            (region.name || "Custom area") +
            " — " + currentVisualization.label;

        preview.hidden = false;

        synchronizeVideo();
    }

    // ----- SYNCHRONISATION AUDIO / VIDÉO -----

    function synchronizeVideo() {
        if (
            !audio ||
            !previewVideo ||
            !currentVisualization ||
            !currentVisualization.video ||
            previewClosed
        ) {
            return;
        }

        preview.hidden = false;

        if (previewVideo.readyState < 1) {
            return;
        }

        const duration = previewVideo.duration;

        if (Number.isFinite(duration) && duration > 0) {
            const targetTime = audio.currentTime % duration;

            if (
                Math.abs(previewVideo.currentTime - targetTime) > 0.5
            ) {
                previewVideo.currentTime = targetTime;
            }
        }

        previewVideo.playbackRate = audio.playbackRate || 1;

        if (!audio.paused) {
            previewVideo.play().catch(() => {});
        }
    }

    function connectAudio() {
        audio.addEventListener("play", () => {
            synchronizeVideo();
        });

        audio.addEventListener("pause", () => {
            previewVideo.pause();
        });

        audio.addEventListener("timeupdate", () => {
            if (
                !preview.hidden &&
                !previewVideo.paused
            ) {
                synchronizeVideo();
            }
        });

        audio.addEventListener("ratechange", () => {
            previewVideo.playbackRate =
                audio.playbackRate || 1;
        });

        previewVideo.addEventListener(
            "loadedmetadata",
            synchronizeVideo
        );
    }

    // ----- MASQUER L'APERÇU -----

    function hide() {
        if (!preview) return;

        preview.hidden = true;
        previewVideo.pause();
    }

    // ----- API PUBLIQUE -----

    return {
        init,
        setVisualization,
        showRegion,
        hide
    };
})();

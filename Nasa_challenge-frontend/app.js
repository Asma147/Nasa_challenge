
// ----- GLOBE -----
const zone = document.getElementById("globe");

const globe = new Globe(zone)
  .globeImageUrl("media/earth.jpg")
  .backgroundColor("#070b14");

function ajusterTaille() {
  globe.width(zone.clientWidth).height(zone.clientHeight);
}

window.addEventListener("resize", ajusterTaille);
ajusterTaille();

// Rotation lente automatique
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.5;

// ----- ÉLÉMENTS DE LA PAGE -----
const filtres = document.getElementById("filters");
const description = document.getElementById("description");
const zoneRegions = document.getElementById("regions");
const statut = document.getElementById("status");
const pause = document.getElementById("pause");
const boutonSelection = document.getElementById("select");
const panneau = document.querySelector("aside");

const SERVEUR = "http://localhost:8000";

const audio = new Audio();
audio.loop = true;

let boutonActif = null;
let disqueActif = null;
let regions = [];
let modeSelection = false;

// Vidéo affichée sur le globe
let videoActuelle = null;
let textureVideo = null;
let videoFrameCallback = null;
let animationTextureId = null;
let selectionVideoId = 0;

// Demandes de son envoyées au serveur
let numeroDemande = 0;
let demandeEnCours = null;

// ----- APERÇU VIDÉO FLOTTANT -----

// Création automatique de la fenêtre vidéo
const apercu = document.createElement("div");
apercu.id = "region-preview";
apercu.className = "region-preview";
apercu.hidden = true;

apercu.innerHTML = `
  <div class="region-preview-header">
    <span id="region-preview-title">Selected region</span>
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

document.body.appendChild(apercu);

const videoApercu = apercu.querySelector("#region-preview-video");
const titreApercu = apercu.querySelector("#region-preview-title");
const fermerApercu = apercu.querySelector("#region-preview-close");

let apercuFerme = false;

// Fermer uniquement la fenêtre flottante
fermerApercu.addEventListener("click", () => {
  apercuFerme = true;
  apercu.hidden = true;
  videoApercu.pause();
});

// Préparer la vidéo correspondant au filtre actif
function preparerApercu(disque) {
  videoApercu.pause();
  apercu.hidden = true;
  videoApercu.removeAttribute("src");
  videoApercu.load();

  if (!disque || !disque.video) return;

  videoApercu.src = disque.video;
  videoApercu.load();

  titreApercu.textContent = disque.label + " — Selected region";
}

// Afficher et synchroniser la vidéo avec l'audio
function synchroniserApercu() {
  if (!disqueActif || !disqueActif.video || apercuFerme) {
    return;
  }

  if (apercu.hidden) {
    apercu.hidden = false;
  }

  videoApercu.playbackRate = audio.playbackRate || 1;

  if (videoApercu.readyState >= 1) {
    const duree = videoApercu.duration;

    if (Number.isFinite(duree) && duree > 0) {
      const tempsVideo = audio.currentTime % duree;

      if (Math.abs(videoApercu.currentTime - tempsVideo) > 0.5) {
        videoApercu.currentTime = tempsVideo;
      }
    }
  }

  videoApercu.play().catch(() => {});
}

// Synchronisation lors des actions du lecteur audio
audio.addEventListener("play", synchroniserApercu);

audio.addEventListener("pause", () => {
  videoApercu.pause();
});

audio.addEventListener("timeupdate", () => {
  if (!apercu.hidden && !videoApercu.paused) {
    const duree = videoApercu.duration;

    if (Number.isFinite(duree) && duree > 0) {
      const tempsVideo = audio.currentTime % duree;

      if (Math.abs(videoApercu.currentTime - tempsVideo) > 0.8) {
        videoApercu.currentTime = tempsVideo;
      }
    }
  }
});

audio.addEventListener("ratechange", () => {
  videoApercu.playbackRate = audio.playbackRate || 1;
});

// Quand les métadonnées de la vidéo sont disponibles
videoApercu.addEventListener("loadedmetadata", () => {
  if (!audio.paused) {
    synchroniserApercu();
  }
});

// ----- ZOOM SUR UNE RÉGION -----

function zoomerVersRegion(region) {
  const lat = (region.lat_min + region.lat_max) / 2;
  const lng = (region.lon_min + region.lon_max) / 2;

  globe.controls().autoRotate = false;

  globe.pointOfView({
    lat: lat,
    lng: lng,
    altitude: 1.45
  }, 1200);
}

// ----- VIDÉO SUR LE GLOBE -----

function arreterTextureVideo() {
  selectionVideoId++;

  if (videoActuelle) {
    videoActuelle.pause();

    if (
      videoFrameCallback !== null &&
      videoActuelle.cancelVideoFrameCallback
    ) {
      videoActuelle.cancelVideoFrameCallback(videoFrameCallback);
    }
  }

  if (animationTextureId !== null) {
    cancelAnimationFrame(animationTextureId);
  }

  if (textureVideo) {
    textureVideo.dispose();
  }

  videoActuelle = null;
  textureVideo = null;
  videoFrameCallback = null;
  animationTextureId = null;
}

function afficherVideo(disque) {
  arreterTextureVideo();

  const idSelection = selectionVideoId;
  const video = document.createElement("video");

  video.src = disque.video;
  video.preload = "auto";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;

  videoActuelle = video;

  video.addEventListener("error", () => {
    if (idSelection === selectionVideoId) {
      statut.textContent =
        "Could not load the video texture: " + disque.video;
    }
  }, { once: true });

  video.addEventListener("loadeddata", () => {
    if (idSelection !== selectionVideoId) return;

    const installerTexture = () => {
      if (idSelection !== selectionVideoId) return;

      const materiau = globe.globeMaterial();
      const textureBase = materiau.map;

      if (
        !textureBase ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        animationTextureId = requestAnimationFrame(installerTexture);
        return;
      }

      const toileVideo = document.createElement("canvas");
      toileVideo.width = video.videoWidth;
      toileVideo.height = video.videoHeight;

      const contexteVideo = toileVideo.getContext("2d");

      contexteVideo.drawImage(
        video,
        0,
        0,
        toileVideo.width,
        toileVideo.height
      );

      textureVideo = new textureBase.constructor(toileVideo);

      [
        "mapping",
        "wrapS",
        "wrapT",
        "magFilter",
        "anisotropy",
        "colorSpace",
        "flipY"
      ].forEach(propriete => {
        textureVideo[propriete] = textureBase[propriete];
      });

      textureVideo.minFilter = textureBase.magFilter;
      textureVideo.generateMipmaps = false;

      materiau.map = textureVideo;
      materiau.needsUpdate = true;

      const actualiserTexture = () => {
        if (
          idSelection !== selectionVideoId ||
          !textureVideo
        ) {
          return;
        }

        const materiauActuel = globe.globeMaterial();

        if (materiauActuel.map !== textureVideo) {
          materiauActuel.map = textureVideo;
          materiauActuel.needsUpdate = true;
        }

        contexteVideo.drawImage(
          video,
          0,
          0,
          toileVideo.width,
          toileVideo.height
        );

        textureVideo.needsUpdate = true;

        if (video.requestVideoFrameCallback) {
          videoFrameCallback =
            video.requestVideoFrameCallback(actualiserTexture);
        } else {
          animationTextureId =
            requestAnimationFrame(actualiserTexture);
        }
      };

      actualiserTexture();
    };

    installerTexture();
  }, { once: true });

  video.play().catch(() => {
    if (idSelection === selectionVideoId) {
      statut.textContent =
        "The video could not start. Try selecting the visualization again.";
    }
  });
}

// ----- FILTRES (VISUALISATIONS) -----

fetch("catalog.json")
  .then(reponse => {
    if (!reponse.ok) {
      throw new Error("Could not load catalog.json");
    }

    return reponse.json();
  })
  .then(catalogue => {
    for (const disque of catalogue) {
      const bouton = document.createElement("button");

      bouton.textContent = disque.label;
      bouton.setAttribute("aria-pressed", "false");

      bouton.addEventListener("click", () => {
        choisir(disque, bouton);
      });

      filtres.appendChild(bouton);
    }
  })
  .catch(erreur => {
    statut.textContent = erreur.message;
  });

function choisir(disque, bouton) {
  // Annuler une demande de son précédente
  if (demandeEnCours) {
    demandeEnCours.abort();
  }

  numeroDemande++;
  marquerRegion(null);

  // Recliquer sur le filtre actif : retour au globe neutre
  if (boutonActif === bouton) {
    arreterTextureVideo();

    globe.globeImageUrl("media/earth.jpg");

    audio.pause();

    videoApercu.pause();
    apercu.hidden = true;

    bouton.setAttribute("aria-pressed", "false");

    boutonActif = null;
    disqueActif = null;

    description.textContent =
      "Choose a visualization to hear it.";

    statut.textContent = "";
    pause.hidden = true;

    return;
  }

  // Activer le nouveau filtre
  if (boutonActif) {
    boutonActif.setAttribute("aria-pressed", "false");
  }

  boutonActif = bouton;
  disqueActif = disque;

  bouton.setAttribute("aria-pressed", "true");

  // Préparer l'aperçu vidéo
  apercuFerme = false;
  preparerApercu(disque);

  // Afficher la vidéo sur le globe ou l'image fixe
  if (disque.video) {
    afficherVideo(disque);
  } else {
    arreterTextureVideo();
    globe.globeImageUrl(disque.texture);
  }

  description.textContent =
    disque.description + " " + disque.hear;

  audio.pause();
  pause.hidden = true;

  statut.textContent =
    "Choose a region or select an area to hear this visualization.";
}

// ----- PAUSE -----

pause.addEventListener("click", () => {
  if (audio.paused) {
    audio.play().catch(() => {});
    pause.textContent = "Pause sound";
  } else {
    audio.pause();
    pause.textContent = "Play sound";
  }
});

// ----- RÉGIONS -----

fetch("regions.json")
  .then(reponse => {
    if (!reponse.ok) {
      throw new Error("Could not load regions.json");
    }

    return reponse.json();
  })
  .then(liste => {
    regions = liste;

    for (const region of regions) {
      const bouton = document.createElement("button");

      bouton.textContent = region.name;
      bouton.dataset.region = region.id;
      bouton.setAttribute("aria-pressed", "false");

      bouton.addEventListener("click", () => {
        jouerRegion(region);
      });

      zoneRegions.appendChild(bouton);
    }
  })
  .catch(erreur => {
    statut.textContent = erreur.message;
  });

// Colorer le bouton de la région choisie
function marquerRegion(id) {
  for (const bouton of zoneRegions.querySelectorAll("button")) {
    bouton.setAttribute(
      "aria-pressed",
      bouton.dataset.region === id ? "true" : "false"
    );
  }
}

// ----- ZONE PERSONNALISÉE : CADRE -----

const cadre = document.createElement("div");
cadre.id = "box";
cadre.hidden = true;
zone.appendChild(cadre);

let depart = null;

// Quitter le mode sélection
function arreterSelection() {
  if (!modeSelection) return;

  modeSelection = false;

  boutonSelection.setAttribute("aria-pressed", "false");

  globe.controls().enabled = true;
  zone.style.cursor = "";

  cadre.hidden = true;
}

// ----- JOUER UNE RÉGION -----

function jouerRegion(region) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }

  arreterSelection();

  marquerRegion(region.id);

  // Zoom sur la région
  zoomerVersRegion(region);

  // Réouvrir l'aperçu si l'utilisateur l'avait fermé
  apercuFerme = false;

  // Envoyer une seule demande audio au serveur
  zonePersonnalisee(region);
}

// Clic sur le globe : trouver la région correspondante
globe.onGlobeClick(({ lat, lng }) => {
  if (modeSelection) return;

  const region = regions.find(r =>
    lat >= r.lat_min &&
    lat <= r.lat_max &&
    lng >= r.lon_min &&
    lng <= r.lon_max
  );

  if (region) {
    jouerRegion(region);
  } else {
    statut.textContent = "No region here. Try another place.";
  }
});

// ----- SÉLECTION D'UNE ZONE PERSONNALISÉE -----

boutonSelection.addEventListener("click", () => {
  modeSelection = !modeSelection;

  boutonSelection.setAttribute(
    "aria-pressed",
    modeSelection
  );

  if (modeSelection) {
    marquerRegion(null);
    audio.pause();
  }

  globe.controls().enabled = !modeSelection;
  globe.controls().autoRotate = false;

  zone.style.cursor = modeSelection ? "crosshair" : "";

  cadre.hidden = true;

  statut.textContent = modeSelection
    ? "Drag on the globe to draw an area."
    : "";
});

function positionDans(e) {
  const r = zone.getBoundingClientRect();

  return {
    x: e.clientX - r.left,
    y: e.clientY - r.top
  };
}

function dessinerCadre(a, b) {
  cadre.style.left = Math.min(a.x, b.x) + "px";
  cadre.style.top = Math.min(a.y, b.y) + "px";

  cadre.style.width = Math.abs(a.x - b.x) + "px";
  cadre.style.height = Math.abs(a.y - b.y) + "px";
}

zone.addEventListener("pointerdown", e => {
  if (!modeSelection) return;

  depart = positionDans(e);

  cadre.hidden = false;

  dessinerCadre(depart, depart);
});

zone.addEventListener("pointermove", e => {
  if (depart) {
    dessinerCadre(depart, positionDans(e));
  }
});

zone.addEventListener("pointerup", e => {
  if (!depart) return;

  const fin = positionDans(e);

  const a = globe.toGlobeCoords(depart.x, depart.y);
  const b = globe.toGlobeCoords(fin.x, fin.y);

  depart = null;

  if (!a || !b) {
    cadre.hidden = true;

    statut.textContent =
      "The area must stay on the globe. Try again.";

    return;
  }

  const zoneChoisie = {
    lat_min: Math.min(a.lat, b.lat),
    lat_max: Math.max(a.lat, b.lat),
    lon_min: Math.min(a.lng, b.lng),
    lon_max: Math.max(a.lng, b.lng)
  };

  marquerRegion(null);

  arreterSelection();

  // Zoomer vers le centre de la zone personnalisée
  zoomerVersRegion(zoneChoisie);

  apercuFerme = false;

  zonePersonnalisee(zoneChoisie);
});

// ----- ENVOI AU SERVEUR -----

async function zonePersonnalisee(s) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }

  // Annuler la demande précédente
  if (demandeEnCours) {
    demandeEnCours.abort();
  }

  demandeEnCours = new AbortController();

  const maDemande = ++numeroDemande;
  const filtre = disqueActif;

  statut.textContent =
    "Generating sound for " + (s.name || "the selected area") + "...";

  try {
    const reponse = await fetch(SERVEUR + "/sound", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        layer: filtre.id,
        ...s
      }),

      signal: demandeEnCours.signal
    });

    if (!reponse.ok) {
      let detail = "Server error";

      try {
        const erreurServeur = await reponse.json();
        detail = erreurServeur.detail || detail;
      } catch (_) {}

      throw new Error(detail);
    }

    const fichier = await reponse.blob();

    // Ignorer les anciennes réponses
    if (maDemande !== numeroDemande) return;

    audio.src = URL.createObjectURL(fichier);

    // Repartir du début de la vidéo
    if (videoActuelle) {
      videoActuelle.currentTime = 0;
    }

    videoApercu.currentTime = 0;

    // L'événement "play" synchronise automatiquement l'aperçu
    await audio.play();

    pause.hidden = false;
    pause.textContent = "Pause sound";

    statut.textContent = s.name
      ? "Playing " + s.name + ": " + filtre.label + "."
      : "Playing the selected area: latitude " +
        s.lat_min.toFixed(1) + " to " +
        s.lat_max.toFixed(1) +
        ", longitude " +
        s.lon_min.toFixed(1) + " to " +
        s.lon_max.toFixed(1) + ".";

  } catch (erreur) {
    if (
      erreur.name === "AbortError" ||
      maDemande !== numeroDemande
    ) {
      return;
    }

    const message = erreur.message === "Failed to fetch"
      ? "the sound server is not reachable. Start it with Docker and try again."
      : erreur.message;

    statut.textContent =
      "Could not generate the sound: " + message;
  }
}

// ----- NAVIGATION AUX FLÈCHES DANS LE PANNEAU -----

panneau.addEventListener("keydown", e => {
  const sens = {
    ArrowDown: 1,
    ArrowRight: 1,
    ArrowUp: -1,
    ArrowLeft: -1
  }[e.key];

  if (!sens) return;

  const boutons = [
    ...panneau.querySelectorAll("button:not([hidden])")
  ];

  const position = boutons.indexOf(document.activeElement);

  if (position === -1) return;

  e.preventDefault();

  boutons[
    (position + sens + boutons.length) % boutons.length
  ].focus();
});

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

// ----- VIDÉO SUR LE GLOBE -----
function arreterTextureVideo() {
  selectionVideoId++;
  if (videoActuelle) {
    videoActuelle.pause();
    if (videoFrameCallback !== null && videoActuelle.cancelVideoFrameCallback) {
      videoActuelle.cancelVideoFrameCallback(videoFrameCallback);
    }
  }
  if (animationTextureId !== null) cancelAnimationFrame(animationTextureId);
  if (textureVideo) textureVideo.dispose();
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
      statut.textContent = "Could not load the video texture: " + disque.video;
    }
  }, { once: true });

  video.addEventListener("loadeddata", () => {
    if (idSelection !== selectionVideoId) return;

    const installerTexture = () => {
      if (idSelection !== selectionVideoId) return;
      const materiau = globe.globeMaterial();
      const textureBase = materiau.map;
      if (!textureBase || video.videoWidth === 0 || video.videoHeight === 0) {
        animationTextureId = requestAnimationFrame(installerTexture);
        return;
      }

      const toileVideo = document.createElement("canvas");
      toileVideo.width = video.videoWidth;
      toileVideo.height = video.videoHeight;
      const contexteVideo = toileVideo.getContext("2d");
      contexteVideo.drawImage(video, 0, 0, toileVideo.width, toileVideo.height);

      textureVideo = new textureBase.constructor(toileVideo);
      ["mapping", "wrapS", "wrapT", "magFilter", "anisotropy", "colorSpace", "flipY"].forEach(propriete => {
        textureVideo[propriete] = textureBase[propriete];
      });
      textureVideo.minFilter = textureBase.magFilter;
      textureVideo.generateMipmaps = false;
      materiau.map = textureVideo;
      materiau.needsUpdate = true;

      const actualiserTexture = () => {
        if (idSelection !== selectionVideoId || !textureVideo) return;
        const materiauActuel = globe.globeMaterial();
        if (materiauActuel.map !== textureVideo) {
          materiauActuel.map = textureVideo;
          materiauActuel.needsUpdate = true;
        }
        contexteVideo.drawImage(video, 0, 0, toileVideo.width, toileVideo.height);
        textureVideo.needsUpdate = true;

        if (video.requestVideoFrameCallback) {
          videoFrameCallback = video.requestVideoFrameCallback(actualiserTexture);
        } else {
          animationTextureId = requestAnimationFrame(actualiserTexture);
        }
      };

      actualiserTexture();
    };

    installerTexture();
  }, { once: true });

  video.play().catch(() => {
    if (idSelection === selectionVideoId) {
      statut.textContent = "The video could not start. Try selecting the visualization again.";
    }
  });
}

// ----- FILTRES (VISUALISATIONS) -----
// Créer un bouton par disque du catalogue
fetch("catalog.json")
  .then(reponse => reponse.json())
  .then(catalogue => {
    for (const disque of catalogue) {
      const bouton = document.createElement("button");
      bouton.textContent = disque.label;
      bouton.setAttribute("aria-pressed", "false");
      bouton.addEventListener("click", () => choisir(disque, bouton));
      filtres.appendChild(bouton);
    }
  });

function choisir(disque, bouton) {
  // Annuler un son en cours de calcul et éteindre la région colorée
  if (demandeEnCours) demandeEnCours.abort();
  numeroDemande++;
  marquerRegion(null);

  // Recliquer sur le filtre actif : retour au globe neutre
  if (boutonActif === bouton) {
    arreterTextureVideo();
    globe.globeImageUrl("media/earth.jpg");
    audio.pause();
    bouton.setAttribute("aria-pressed", "false");
    boutonActif = null;
    disqueActif = null;
    description.textContent = "Choose a visualization to hear it.";
    statut.textContent = "";
    pause.hidden = true;
    return;
  }

  // Activer le nouveau filtre
  if (boutonActif) boutonActif.setAttribute("aria-pressed", "false");
  boutonActif = bouton;
  disqueActif = disque;
  bouton.setAttribute("aria-pressed", "true");

  // Afficher la vidéo si le filtre en a une, sinon l'image fixe
  if (disque.video) {
    afficherVideo(disque);
  } else {
    arreterTextureVideo();
    globe.globeImageUrl(disque.texture);
  }

  description.textContent = disque.description + " " + disque.hear;
  audio.pause();                 // couper le son du filtre précédent
  pause.hidden = true;           // le bouton réapparaît quand un son est prêt
  statut.textContent = "Choose a region or select an area to hear this visualization.";
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
  .then(reponse => reponse.json())
  .then(liste => {
    regions = liste;
    for (const region of regions) {
      const bouton = document.createElement("button");
      bouton.textContent = region.name;
      bouton.dataset.region = region.id;
      bouton.setAttribute("aria-pressed", "false");
      bouton.addEventListener("click", () => jouerRegion(region));
      zoneRegions.appendChild(bouton);
    }
  });

// Colorer le bouton de la région choisie, et éteindre les autres
function marquerRegion(id) {
  for (const bouton of zoneRegions.querySelectorAll("button")) {
    bouton.setAttribute("aria-pressed", bouton.dataset.region === id ? "true" : "false");
  }
}

// Quitter le mode sélection : le bouton s'éteint et le globe redevient manipulable
function arreterSelection() {
  if (!modeSelection) return;
  modeSelection = false;
  boutonSelection.setAttribute("aria-pressed", "false");
  globe.controls().enabled = true;
  zone.style.cursor = "";
  cadre.hidden = true;
}

function jouerRegion(region) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }
  
  arreterSelection();
  marquerRegion(region.id);
  zonePersonnalisee(region);
  marquerRegion(region.id);
  zonePersonnalisee(region);

  // Tourner le globe vers la région
  globe.controls().autoRotate = false;
  globe.pointOfView({
    lat: (region.lat_min + region.lat_max) / 2,
    lng: (region.lon_min + region.lon_max) / 2,
    altitude: 1.8
  }, 1000);
}

// Clic sur le globe : trouver la région qui contient ce point
globe.onGlobeClick(({ lat, lng }) => {
  if (modeSelection) return;
  const region = regions.find(r =>
    lat >= r.lat_min && lat <= r.lat_max && lng >= r.lon_min && lng <= r.lon_max);
  if (region) jouerRegion(region);
  else statut.textContent = "No region here. Try another place.";
});

// ----- ZONE PERSONNALISÉE -----
// Le cadre est créé ici, après le globe, car la bibliothèque vide le bloc #globe
const cadre = document.createElement("div");
cadre.id = "box";
cadre.hidden = true;
zone.appendChild(cadre);
let depart = null;

// Activer ou désactiver le mode sélection
boutonSelection.addEventListener("click", () => {
  modeSelection = !modeSelection;
  boutonSelection.setAttribute("aria-pressed", modeSelection);
  if (modeSelection) marquerRegion(null);
  if (modeSelection) audio.pause();
  globe.controls().enabled = !modeSelection;   // bloque la rotation pendant la sélection
  globe.controls().autoRotate = false;
  zone.style.cursor = modeSelection ? "crosshair" : "";
  cadre.hidden = true;
  statut.textContent = modeSelection ? "Drag on the globe to draw an area." : "";
});

function positionDans(e) {
  const r = zone.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function dessinerCadre(a, b) {
  cadre.style.left = Math.min(a.x, b.x) + "px";
  cadre.style.top = Math.min(a.y, b.y) + "px";
  cadre.style.width = Math.abs(a.x - b.x) + "px";
  cadre.style.height = Math.abs(a.y - b.y) + "px";
}

zone.addEventListener("pointerdown", (e) => {
  if (!modeSelection) return;
  depart = positionDans(e);
  cadre.hidden = false;
  dessinerCadre(depart, depart);
});

zone.addEventListener("pointermove", (e) => {
  if (depart) dessinerCadre(depart, positionDans(e));
});

zone.addEventListener("pointerup", (e) => {
  if (!depart) return;
  const fin = positionDans(e);
  const a = globe.toGlobeCoords(depart.x, depart.y);   // écran -> latitude/longitude
  const b = globe.toGlobeCoords(fin.x, fin.y);
  depart = null;

  if (!a || !b) {
    cadre.hidden = true;
    statut.textContent = "The area must stay on the globe. Try again.";
    return;
  }
  marquerRegion(null);
  zonePersonnalisee({
    lat_min: Math.min(a.lat, b.lat), lat_max: Math.max(a.lat, b.lat),
    lon_min: Math.min(a.lng, b.lng), lon_max: Math.max(a.lng, b.lng)
  });
});

// ----- ENVOI AU SERVEUR -----
// Envoyer la zone au serveur Python et jouer le son reçu
async function zonePersonnalisee(s) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }

  // Annuler la demande précédente : la dernière zone choisie gagne
  if (demandeEnCours) demandeEnCours.abort();
  demandeEnCours = new AbortController();
  const maDemande = ++numeroDemande;
  const filtre = disqueActif;

  statut.textContent = "Generating sound for " + (s.name || "the selected area") + "...";
  try {
    const reponse = await fetch(SERVEUR + "/sound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layer: filtre.id, ...s }),
      signal: demandeEnCours.signal
    });
    if (!reponse.ok) throw new Error((await reponse.json()).detail);

    const fichier = await reponse.blob();
    if (maDemande !== numeroDemande) return;      // une zone plus récente a été choisie

    audio.src = URL.createObjectURL(fichier);
    if (videoActuelle) videoActuelle.currentTime = 0;
    audio.play();
    pause.hidden = false;
    pause.textContent = "Pause sound";
    statut.textContent = s.name
      ? "Playing " + s.name + ": " + filtre.label + "."
      : "Playing the selected area: latitude " + s.lat_min.toFixed(1) + " to " +
        s.lat_max.toFixed(1) + ", longitude " + s.lon_min.toFixed(1) + " to " + s.lon_max.toFixed(1) + ".";
  } catch (erreur) {
    if (erreur.name === "AbortError" || maDemande !== numeroDemande) return;   // demande annulée
    const message = erreur.message === "Failed to fetch"
      ? "the sound server is not reachable. Start it with Docker and try again."
      : erreur.message;
    statut.textContent = "Could not generate the sound: " + message;
  }
}

// ----- NAVIGATION AUX FLÈCHES DANS LE PANNEAU -----
panneau.addEventListener("keydown", (e) => {
  const sens = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (!sens) return;

  const boutons = [...panneau.querySelectorAll("button:not([hidden])")];
  const position = boutons.indexOf(document.activeElement);
  if (position === -1) return;

  e.preventDefault();
  boutons[(position + sens + boutons.length) % boutons.length].focus();
});
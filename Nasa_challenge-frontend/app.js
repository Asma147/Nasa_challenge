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

// Slow automatic rotation
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.5;

// ----- PAGE ELEMENTS -----
const filtres = document.getElementById("filters");
const description = document.getElementById("description");
const zoneRegions = document.getElementById("regions");
const statut = document.getElementById("status");
const pause = document.getElementById("pause");
const boutonSelection = document.getElementById("select");
const panneau = document.querySelector("aside");

// Address of the sonification service
const SERVEUR = "http://localhost:8000";

const audio = new Audio();
audio.loop = true;

// Elements added on top of the globe. They are created here, after the globe,
// because the library empties the #globe block when it starts.
const cadre = document.createElement("div");       // rectangle drawn with the mouse
cadre.id = "box";
cadre.hidden = true;
zone.appendChild(cadre);

const loupe = document.createElement("canvas");    // magnified view of the listened area
loupe.id = "zoom";
loupe.width = 320;
loupe.height = 200;
loupe.hidden = true;
loupe.setAttribute("aria-hidden", "true");
zone.appendChild(loupe);
const contexteLoupe = loupe.getContext("2d");
const imageFixe = new Image();                     // used when the visualization has no video

// ----- STATE -----
let boutonActif = null;      // button of the selected visualization
let disqueActif = null;      // matching catalog entry
let regions = [];
let modeSelection = false;   // true while a custom area is being drawn
let depart = null;           // first corner of the rectangle being drawn
let zoneLoupe = null;        // area shown in the magnified view

// Video displayed on the globe
let videoActuelle = null;
let textureVideo = null;
let videoFrameCallback = null;
let animationTextureId = null;
let selectionVideoId = 0;

// Sound requests sent to the service
let numeroDemande = 0;
let demandeEnCours = null;

// ----- VIDEO ON THE GLOBE -----
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

// Each video frame is drawn into a canvas, which is used as the globe texture
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

      // Build a texture of the same kind as the current one, with the same settings
      textureVideo = new textureBase.constructor(toileVideo);
      ["mapping", "wrapS", "wrapT", "magFilter", "anisotropy", "colorSpace", "flipY"].forEach(propriete => {
        textureVideo[propriete] = textureBase[propriete];
      });
      textureVideo.minFilter = textureBase.magFilter;
      textureVideo.generateMipmaps = false;
      materiau.map = textureVideo;
      materiau.needsUpdate = true;

      // Redraw the canvas for every new video frame
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

// ----- MAGNIFIED VIEW AND OUTLINE OF THE LISTENED AREA -----
// Points of the rectangle, every 4 degrees, so that it follows the curve of the globe
function contourDe(s) {
  const points = [];
  for (let lon = s.lon_min; lon < s.lon_max; lon += 4) points.push([s.lat_max, lon]);
  for (let lat = s.lat_max; lat > s.lat_min; lat -= 4) points.push([lat, s.lon_max]);
  for (let lon = s.lon_max; lon > s.lon_min; lon -= 4) points.push([s.lat_min, lon]);
  for (let lat = s.lat_min; lat < s.lat_max; lat += 4) points.push([lat, s.lon_min]);
  points.push([s.lat_max, s.lon_min]);
  return points;
}

function montrerZone(s) {
  zoneLoupe = s;
  // Height of the magnified view follows the shape of the area
  const forme = (s.lat_max - s.lat_min) / (s.lon_max - s.lon_min);
  loupe.height = Math.round(Math.min(260, Math.max(70, 320 * forme)));
  loupe.hidden = false;
  cadre.hidden = true;
  globe.pathsData([contourDe(s)])
    .pathColor(() => "#ffc46b")
    .pathStroke(2)
    .pathPointAlt(0.01)
    .pathTransitionDuration(0);
}

function cacherZone() {
  zoneLoupe = null;
  loupe.hidden = true;
  globe.pathsData([]);
}

// Redraw the magnified view continuously from the video or the still image
function dessinerLoupe() {
  if (zoneLoupe) {
    const source = videoActuelle && videoActuelle.videoWidth ? videoActuelle : imageFixe;
    const L = source.videoWidth || source.naturalWidth;
    const H = source.videoHeight || source.naturalHeight;
    if (L && H) {
      // Latitude / longitude -> pixels of the flat world map
      const x = (zoneLoupe.lon_min + 180) / 360 * L;
      const y = (90 - zoneLoupe.lat_max) / 180 * H;
      const w = (zoneLoupe.lon_max - zoneLoupe.lon_min) / 360 * L;
      const h = (zoneLoupe.lat_max - zoneLoupe.lat_min) / 180 * H;
      contexteLoupe.drawImage(source, x, y, w, h, 0, 0, loupe.width, loupe.height);
    }
  }
  requestAnimationFrame(dessinerLoupe);
}
dessinerLoupe();

// ----- VISUALIZATIONS -----
// Create one button per catalog entry
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
  // Cancel a sound being generated and clear the listened area
  if (demandeEnCours) demandeEnCours.abort();
  numeroDemande++;
  marquerRegion(null);
  cacherZone();
  imageFixe.src = disque.texture;
  if (!modeSelection) globe.controls().autoRotate = true;

  // Clicking the active visualization again: back to the plain globe
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

  // Activate the new visualization
  if (boutonActif) boutonActif.setAttribute("aria-pressed", "false");
  boutonActif = bouton;
  disqueActif = disque;
  bouton.setAttribute("aria-pressed", "true");

  // Show the video if there is one, otherwise the still image
  if (disque.video) {
    afficherVideo(disque);
  } else {
    arreterTextureVideo();
    globe.globeImageUrl(disque.texture);
  }

  description.textContent = disque.description + " " + disque.hear;
  audio.pause();                 // stop the sound of the previous visualization
  pause.hidden = true;           // the button comes back when a sound is ready
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

// ----- REGIONS -----
// Create one button per region
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

// Highlight the button of the selected region and switch the others off
function marquerRegion(id) {
  for (const bouton of zoneRegions.querySelectorAll("button")) {
    bouton.setAttribute("aria-pressed", bouton.dataset.region === id ? "true" : "false");
  }
}

// Stop everything: no highlighted region, no magnified view or outline, no sound
function effacerEcoute() {
  if (demandeEnCours) demandeEnCours.abort();
  numeroDemande++;
  marquerRegion(null);
  cacherZone();
  audio.pause();
  pause.hidden = true;            // the player bar disappears with this button
  globe.controls().autoRotate = true;
  statut.textContent = "Choose a region or select an area to hear this visualization.";
}

function jouerRegion(region) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }

  // Clicking the active region again: stop everything
  const boutonRegion = zoneRegions.querySelector('button[data-region="' + region.id + '"]');
  if (boutonRegion && boutonRegion.getAttribute("aria-pressed") === "true") {
    effacerEcoute();
    return;
  }

  arreterSelection();
  marquerRegion(region.id);
  zonePersonnalisee(region);

  // Turn the globe towards the region and keep it in view
  globe.controls().autoRotate = false;
  globe.pointOfView({
    lat: (region.lat_min + region.lat_max) / 2,
    lng: (region.lon_min + region.lon_max) / 2,
    altitude: 1.8
  }, 1000);
}

// Click on the globe: find the region that contains this point
globe.onGlobeClick(({ lat, lng }) => {
  if (modeSelection) return;
  const region = regions.find(r =>
    lat >= r.lat_min && lat <= r.lat_max && lng >= r.lon_min && lng <= r.lon_max);
  if (region) jouerRegion(region);
  else statut.textContent = "No region here. Try another place.";
});

// ----- CUSTOM AREA -----
// Turn the selection mode on or off
boutonSelection.addEventListener("click", () => {
  modeSelection = !modeSelection;
  boutonSelection.setAttribute("aria-pressed", modeSelection);
  effacerEcoute();
  globe.controls().enabled = !modeSelection;      // lock the globe while drawing
  globe.controls().autoRotate = !modeSelection;   // rotate again when leaving the mode
  zone.style.cursor = modeSelection ? "crosshair" : "";
  cadre.hidden = true;
  statut.textContent = modeSelection
    ? "Drag on the globe to draw an area."
    : "Choose a region or select an area to hear this visualization.";
});

// Leave the selection mode: the button switches off and the globe can be moved again
function arreterSelection() {
  if (!modeSelection) return;
  modeSelection = false;
  boutonSelection.setAttribute("aria-pressed", "false");
  globe.controls().enabled = true;
  zone.style.cursor = "";
  cadre.hidden = true;
}

// Pointer position inside the globe block
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
  const a = globe.toGlobeCoords(depart.x, depart.y);   // screen -> latitude / longitude
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

// ----- REQUEST TO THE SONIFICATION SERVICE -----
// Send the area (named region or drawn rectangle) and play the sound that comes back
async function zonePersonnalisee(s) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }

  montrerZone(s);

  // Cancel the previous request: the last selected area wins
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
    if (maDemande !== numeroDemande) return;      // a more recent area was selected

    audio.src = URL.createObjectURL(fichier);
    if (videoActuelle) videoActuelle.currentTime = 0;   // the video restarts with the sound
    audio.play();
    pause.hidden = false;
    pause.textContent = "Pause sound";
    statut.textContent = s.name
      ? "Playing " + s.name + ": " + filtre.label + "."
      : "Playing the selected area: latitude " + s.lat_min.toFixed(1) + " to " +
        s.lat_max.toFixed(1) + ", longitude " + s.lon_min.toFixed(1) + " to " + s.lon_max.toFixed(1) + ".";
  } catch (erreur) {
    if (erreur.name === "AbortError" || maDemande !== numeroDemande) return;   // request cancelled
    const message = erreur.message === "Failed to fetch"
      ? "the sound server is not reachable. Start it with Docker and try again."
      : erreur.message;
    statut.textContent = "Could not generate the sound: " + message;
  }
}

// ----- ARROW KEY NAVIGATION IN THE PANEL -----
panneau.addEventListener("keydown", (e) => {
  const sens = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (!sens) return;

  const boutons = [...panneau.querySelectorAll("button:not([hidden])")];
  const position = boutons.indexOf(document.activeElement);
  if (position === -1) return;

  e.preventDefault();
  boutons[(position + sens + boutons.length) % boutons.length].focus();
});
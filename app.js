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

const audio = new Audio();
audio.loop = true;

let boutonActif = null;
let disqueActif = null;
let regions = [];
let modeSelection = false;

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
  // Recliquer sur le filtre actif : retour au globe neutre
  if (boutonActif === bouton) {
    globe.globeImageUrl("media/earth.jpg");
    audio.pause();
    bouton.setAttribute("aria-pressed", "false");
    boutonActif = null;
    disqueActif = null;
    description.textContent = "Choose a visualization to hear it.";
    pause.hidden = true;
    return;
  }

  // Activer le nouveau filtre
  if (boutonActif) boutonActif.setAttribute("aria-pressed", "false");
  boutonActif = bouton;
  disqueActif = disque;
  bouton.setAttribute("aria-pressed", "true");

  globe.globeImageUrl(disque.texture);                               // changer le globe
  description.textContent = disque.description + " " + disque.hear;  // annoncer
  audio.src = disque.audio;                                          // lancer le son
  audio.play().catch(() => {});                                      // pas d'erreur si le fichier manque
  pause.hidden = false;
  pause.textContent = "Pause sound";
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

// ----- RÉGIONS PRÉPARÉES -----
fetch("regions.json")
  .then(reponse => reponse.json())
  .then(liste => {
    regions = liste;
    for (const region of regions) {
      const bouton = document.createElement("button");
      bouton.textContent = region.name;
      bouton.addEventListener("click", () => jouerRegion(region));
      zoneRegions.appendChild(bouton);
    }
  });

function jouerRegion(region) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }
  statut.textContent = region.name + ": " + disqueActif.label;

  // Le fichier préparé par Python : media/visualisation_region.mp3
  audio.src = "media/" + disqueActif.id + "_" + region.id + ".mp3";
  audio.play().catch(() => {
    statut.textContent = "No sound available yet for " + region.name + ".";
  });
  pause.hidden = false;
  pause.textContent = "Pause sound";

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
const SERVEUR = "http://localhost:5000";

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
  zonePersonnalisee({
    lat_min: Math.min(a.lat, b.lat), lat_max: Math.max(a.lat, b.lat),
    lon_min: Math.min(a.lng, b.lng), lon_max: Math.max(a.lng, b.lng)
  });
});

// Envoyer la zone au serveur Python et jouer le son reçu
async function zonePersonnalisee(s) {
  if (!disqueActif) {
    statut.textContent = "Choose a visualization first.";
    return;
  }
  statut.textContent = "Generating sound for the selected area...";
  try {
    const reponse = await fetch(SERVEUR + "/sound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layer: disqueActif.id, ...s })
    });
    if (!reponse.ok) throw new Error((await reponse.json()).error);

    const fichier = await reponse.blob();
    audio.src = URL.createObjectURL(fichier);
    audio.play();
    pause.hidden = false;
    pause.textContent = "Pause sound";
    statut.textContent = "Playing the selected area: latitude " + s.lat_min.toFixed(1) + " to " +
      s.lat_max.toFixed(1) + ", longitude " + s.lon_min.toFixed(1) + " to " + s.lon_max.toFixed(1) + ".";
  } catch (erreur) {
    const message = erreur.message === "Failed to fetch"
      ? "the sound server is not reachable. Try a prepared region instead."
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

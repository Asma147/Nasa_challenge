const globe = new Globe(document.getElementById("globe"))
  .globeImageUrl("media/earth.jpg")
  .backgroundColor("#070b14")
  const zone = document.getElementById("globe");
function ajusterTaille() {
globe.width(zone.clientWidth).height(zone.clientHeight);
}
window.addEventListener("resize", ajusterTaille);
ajusterTaille();

// Rotation lente automatique
globe.controls().autoRotate = true;
globe.controls().autoRotateSpeed = 0.5;

  const filtres = document.getElementById("filters");
const description = document.getElementById("description");
const audio = new Audio();
audio.loop = true;
let boutonActif = null;
let disqueActif = null;

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
    description.textContent = "Choose a visualization to hear it.";
    pause.hidden = true;
    disqueActif = null;
    return;
  }

  // Activer le nouveau filtre
  if (boutonActif) boutonActif.setAttribute("aria-pressed", "false");
  boutonActif = bouton;
  disqueActif = disque;
  bouton.setAttribute("aria-pressed", "true");

  globe.globeImageUrl(disque.texture);                          // changer le globe
  description.textContent = disque.description + " " + disque.hear;  // annoncer
  audio.src = disque.audio;                                     // lancer le son
  audio.play().catch(() => {});
  pause.hidden = false;
pause.textContent = "Pause sound";                                 // pas d'erreur si le fichier manque
}

const pause = document.getElementById("pause");
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
let regions = [];
let modeSelection = false;
const zoneRegions = document.getElementById("regions");
const statut = document.getElementById("status");

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

  audio.src = "media/" + disqueActif.id + "_" + region.id + ".mp3";
  audio.play().catch(() => {
    statut.textContent = "No sound available yet for " + region.name + ".";
  });
  pause.hidden = false;
  pause.textContent = "Pause sound";

  globe.controls().autoRotate = false;
  globe.pointOfView({
    lat: (region.lat_min + region.lat_max) / 2,
    lng: (region.lon_min + region.lon_max) / 2,
    altitude: 1.8
  }, 1000);
}

globe.onGlobeClick(({ lat, lng }) => {
  if (modeSelection) return;
  const region = regions.find(r =>
    lat >= r.lat_min && lat <= r.lat_max && lng >= r.lon_min && lng <= r.lon_max);
  if (region) jouerRegion(region);
  else statut.textContent = "No region here. Try another place.";
});

// ----- ZONE PERSONNALISÉE -----
const boutonSelection = document.getElementById("select");
const cadre = document.createElement("div");
cadre.id = "box";
cadre.hidden = true;
zone.appendChild(cadre);
let depart = null;

boutonSelection.addEventListener("click", () => {
  modeSelection = !modeSelection;
  boutonSelection.setAttribute("aria-pressed", modeSelection);
  globe.controls().enabled = !modeSelection;
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
  const a = globe.toGlobeCoords(depart.x, depart.y);
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


const SERVEUR = "http://localhost:5000";

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
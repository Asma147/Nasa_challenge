// ===== Fond spatial animé : étoiles fines, nébuleuses douces, orbites autour de la Terre =====
(function () {
  const hote = document.getElementById("space");
  if (!hote) return;
  hote.textContent = "";

  // Le globe se peint par défaut avec un fond opaque qui cacherait le décor :
  // on le rend transparent (la variable "globe" vient de app.js, chargé avant ce fichier).
  try {
    if (typeof globe !== "undefined") globe.backgroundColor("rgba(0,0,0,0)");
  } catch (e) { /* le globe reste opaque, le décor sera simplement masqué */ }

  const toile = document.createElement("canvas");
  hote.appendChild(toile);
  const ctx = toile.getContext("2d");
  const zoneGlobe = document.getElementById("globe");
  const mouvementReduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let L = 0, H = 0;
  let etoiles = [];
  let filante = null;
  let prochaineFilante = 3;

  // Petit halo réutilisé pour les étoiles brillantes et les satellites
  const halo = document.createElement("canvas");
  halo.width = halo.height = 64;
  (function () {
    const g = halo.getContext("2d");
    const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    d.addColorStop(0, "rgba(255,255,255,0.9)");
    d.addColorStop(0.25, "rgba(200,220,255,0.25)");
    d.addColorStop(1, "rgba(200,220,255,0)");
    g.fillStyle = d;
    g.fillRect(0, 0, 64, 64);
  })();

  const TEINTES = ["255,255,255", "255,255,255", "200,220,255", "255,236,205"];

  function creerEtoiles() {
    const n = Math.min(700, Math.round(L * H / 4500));
    etoiles = [];
    for (let i = 0; i < n; i++) {
      const z = Math.random();                          // profondeur : 0 = loin, 1 = près
      etoiles.push({
        x: Math.random() * L,
        y: Math.random() * H,
        r: 0.25 + Math.pow(Math.random(), 4) * 1.2 + z * 0.25,   // surtout de très petites étoiles
        a: 0.25 + Math.random() * 0.6,
        v: 1.5 + z * 7,                                 // dérive lente en pixels par seconde
        tw: 0.4 + Math.random() * 1.4,                  // vitesse de scintillement
        ph: Math.random() * Math.PI * 2,
        couleur: "rgb(" + TEINTES[(Math.random() * TEINTES.length) | 0] + ")"
      });
    }
  }

  function redimensionner() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    L = window.innerWidth;
    H = window.innerHeight;
    toile.width = L * dpr;
    toile.height = H * dpr;
    toile.style.width = L + "px";
    toile.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    creerEtoiles();
    if (mouvementReduit) dessiner(0, 0);
  }

  function nebuleuse(x, y, rayon, rvb, opacite) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rayon);
    g.addColorStop(0, "rgba(" + rvb + "," + opacite + ")");
    g.addColorStop(1, "rgba(" + rvb + ",0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - rayon, y - rayon, rayon * 2, rayon * 2);
  }

  function fond(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#03050b");
    g.addColorStop(1, "#0a1224");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, H);

    const grand = Math.max(L, H);
    nebuleuse(L * (0.22 + 0.04 * Math.sin(t * 0.05)), H * (0.30 + 0.04 * Math.cos(t * 0.04)),
              grand * 0.45, "70,100,220", 0.13);
    nebuleuse(L * (0.78 + 0.04 * Math.cos(t * 0.045)), H * (0.72 + 0.05 * Math.sin(t * 0.05)),
              grand * 0.40, "150,80,210", 0.09);
  }

  function dessinerEtoiles(t, dt) {
    for (const s of etoiles) {
      s.x += s.v * dt;
      if (s.x > L + 4) { s.x = -4; s.y = Math.random() * H; }

      const scintille = 0.65 + 0.35 * Math.sin(t * s.tw + s.ph);
      const alpha = s.a * scintille;

      if (s.r > 0.95) {                                  // étoiles brillantes : léger halo
        const g = s.r * 6;
        ctx.globalAlpha = alpha * 0.8;
        ctx.drawImage(halo, s.x - g, s.y - g, g * 2, g * 2);
      }
      ctx.globalAlpha = Math.min(1, alpha + 0.15);
      ctx.fillStyle = s.couleur;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Deux orbites très fines autour de la Terre, avec un petit satellite lumineux chacune
  function orbites(t) {
    const r = zoneGlobe ? zoneGlobe.getBoundingClientRect() : null;
    const valide = r && r.width > 0 && r.height > 0;
    const cx = valide ? r.left + r.width / 2 : L / 2;
    const cy = valide ? r.top + r.height / 2 : H / 2;
    const base = valide ? Math.min(r.width, r.height) : Math.min(L, H);

    const anneaux = [
      { k: 0.62, vitesse: 0.12, phase: 0 },
      { k: 0.80, vitesse: -0.08, phase: 2 }
    ];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.32);
    for (const o of anneaux) {
      const rx = base * o.k;
      const ry = rx * 0.3;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(140,180,255,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const angle = t * o.vitesse + o.phase;
      const x = Math.cos(angle) * rx;
      const y = Math.sin(angle) * ry;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(halo, x - 9, y - 9, 18, 18);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#e6f0ff";
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Une étoile filante de temps en temps
  function etoileFilante(t, dt) {
    if (!filante && t > prochaineFilante) {
      filante = {
        x: Math.random() * L * 0.7,
        y: Math.random() * H * 0.35,
        vx: 700 + Math.random() * 300,
        vy: 260 + Math.random() * 140,
        vie: 0
      };
    }
    if (!filante) return;

    const f = filante;
    f.vie += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    const progres = f.vie / 0.9;
    if (progres >= 1 || f.x > L + 100 || f.y > H + 100) {
      filante = null;
      prochaineFilante = t + 7 + Math.random() * 9;
      return;
    }

    const longueur = 130;
    const norme = Math.hypot(f.vx, f.vy);
    const qx = f.x - (f.vx / norme) * longueur;
    const qy = f.y - (f.vy / norme) * longueur;
    const g = ctx.createLinearGradient(qx, qy, f.x, f.y);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255," + (0.85 * Math.sin(Math.PI * progres)).toFixed(3) + ")");
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(qx, qy);
    ctx.lineTo(f.x, f.y);
    ctx.stroke();
  }

  function dessiner(t, dt) {
    fond(t);
    dessinerEtoiles(t, dt);
    orbites(t);
    if (!mouvementReduit) etoileFilante(t, dt);
  }

  let dernier = performance.now();
  function boucle(maintenant) {
    const dt = Math.min(0.05, (maintenant - dernier) / 1000);
    dernier = maintenant;
    dessiner(maintenant / 1000, dt);
    requestAnimationFrame(boucle);
  }

  window.addEventListener("resize", redimensionner);
  redimensionner();

  if (mouvementReduit) {
    // Image fixe, sans animation ; on la redessine une fois la page en place
    window.addEventListener("load", () => dessiner(0, 0));
  } else {
    requestAnimationFrame(boucle);
  }
})();
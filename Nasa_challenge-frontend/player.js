/*
  Earth Jukebox - barre de lecture fixe sous le globe

  - lecture / pause, position dans le son, vitesse, téléchargement, petite onde sonore
  - reste visible même quand on fait défiler le panneau de droite
  - ne modifie pas app.js : elle utilise seulement la variable "audio" et le bouton #pause
    qui existent déjà (ce fichier doit donc être chargé APRÈS app.js)
*/
(() => {
  'use strict';

  if (typeof audio === 'undefined') {
    console.warn('[player.js] La variable "audio" est introuvable : charge player.js après app.js.');
    return;
  }

  const $ = (id) => document.getElementById(id);
  const globeBox = $('globe');
  const legacyPause = $('pause');          // ancien bouton du panneau : on le garde synchronisé
  const gate = $('gate');                  // écran d'accueil (accessibility.js)
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- style (injecté ici pour n'avoir qu'un seul fichier à ajouter) ---------- */
  const css = `
  #player[hidden] { display: none; }
  #player {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
    z-index: 50; box-sizing: border-box;
    display: flex; align-items: center; gap: 12px;
    width: min(680px, calc(100vw - 24px)); padding: 10px 14px;
    border: 1px solid rgba(90, 169, 255, 0.4); border-radius: 16px;
    background: rgba(10, 18, 38, 0.86);
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    color: #eaf1ff; font: inherit;
  }
  #player button { all: unset; box-sizing: border-box; cursor: pointer; }
  #player button:focus-visible, #player select:focus-visible, #player input:focus-visible {
    outline: 3px solid #ffd166; outline-offset: 3px;
  }
  #pl-toggle {
    display: grid; place-items: center; flex: none;
    width: 44px; height: 44px; border-radius: 50%;
    background: #5aa9ff; color: #04122b;
  }
  #pl-toggle:hover { background: #7bbcff; }
  #pl-toggle svg, #pl-download svg { width: 20px; height: 20px; fill: currentColor; }
  #pl-time {
    flex: none; min-width: 86px; color: #a9bad0; font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  #pl-seek { flex: 1 1 80px; min-width: 70px; margin: 0; accent-color: #5aa9ff; cursor: pointer; }
  #pl-wave { flex: none; width: 120px; height: 36px; }
  #pl-speed {
    flex: none; box-sizing: border-box; padding: 7px 8px;
    border: 1px solid rgba(90, 169, 255, 0.5); border-radius: 10px;
    background: #0f1c34; color: #eaf1ff; font: inherit; font-size: 0.9rem; cursor: pointer;
  }
  #pl-download {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    padding: 8px 12px; border: 1px solid rgba(90, 169, 255, 0.5); border-radius: 10px;
    color: #eaf1ff; font-size: 0.9rem;
  }
  #pl-download svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  #pl-download:hover { background: rgba(90, 169, 255, 0.18); }
  @media (max-width: 760px) {
    #player { flex-wrap: wrap; row-gap: 8px; }
    #pl-seek { order: 5; flex: 1 1 100%; }
    #pl-wave { width: 80px; }
    #pl-download span { display: none; }
  }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- structure ---------- */
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const ICON_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/></svg>';

  const bar = document.createElement('div');
  bar.id = 'player';
  bar.hidden = true;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Sound player');
  bar.innerHTML =
    '<button id="pl-toggle" type="button" aria-label="Pause sound">' + ICON_PAUSE + '</button>' +
    '<span id="pl-time" aria-hidden="true">0:00 / 0:00</span>' +
    '<input id="pl-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Position in the sound">' +
    '<canvas id="pl-wave" aria-hidden="true"></canvas>' +
    '<select id="pl-speed" aria-label="Playback speed, 1 times">' +
      '<option value="0.5">0.5×</option><option value="0.75">0.75×</option>' +
      '<option value="1" selected>1×</option><option value="1.25">1.25×</option>' +
      '<option value="1.5">1.5×</option><option value="2">2×</option>' +
    '</select>' +
    '<button id="pl-download" type="button" aria-label="Download this sound">' + ICON_DL + '<span>Download</span></button>';
  document.body.appendChild(bar);

  const toggle = $('pl-toggle');
  const time = $('pl-time');
  const seek = $('pl-seek');
  const wave = $('pl-wave');
  const speed = $('pl-speed');
  const download = $('pl-download');
  const g = wave.getContext ? wave.getContext('2d') : null;

  /* ---------- position : centrée sous le globe, quelle que soit la taille de la fenêtre ---------- */
  function place() {
    if (!globeBox) return;
    const r = globeBox.getBoundingClientRect();
    if (!r.width) return;
    bar.style.left = (r.left + r.width / 2) + 'px';
    bar.style.width = Math.min(680, r.width - 24) + 'px';
    bar.style.bottom = Math.max(12, window.innerHeight - r.bottom + 14) + 'px';
  }
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  window.addEventListener('load', place);
  if (globeBox && 'ResizeObserver' in window) new ResizeObserver(place).observe(globeBox);

  /* ---------- la barre n'apparaît que lorsqu'un son est chargé ---------- */
  function refresh() {
    const hasSound = !!audio.currentSrc;
    const hiddenByPage = legacyPause ? legacyPause.hidden : false;   // app.js cache #pause quand il n'y a pas de son
    bar.hidden = !(hasSound && !hiddenByPage);
    place();
    updateToggle();
    updateTime();
  }
  ['loadedmetadata', 'emptied', 'loadstart'].forEach((ev) => audio.addEventListener(ev, refresh));
  if (legacyPause) new MutationObserver(refresh).observe(legacyPause, { attributes: true, attributeFilter: ['hidden'] });

  // Derrière l'écran d'accueil, la barre ne doit pas être atteignable au clavier
  function syncGate() { bar.inert = !!(gate && !gate.hidden); }
  if (gate) new MutationObserver(syncGate).observe(gate, { attributes: true, attributeFilter: ['hidden', 'class'] });
  syncGate();

  /* ---------- lecture / pause ---------- */
  function updateToggle() {
    const playing = !audio.paused;
    toggle.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    toggle.setAttribute('aria-label', playing ? 'Pause sound' : 'Play sound');
  }

  toggle.addEventListener('click', () => {
    // On réutilise le bouton existant : sa logique (et son texte) restent identiques
    if (legacyPause) legacyPause.click();
    else if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  /* ---------- temps et position ---------- */
  let dragging = false;
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) return '-:--';
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  };

  function updateTime() {
    const d = audio.duration;
    const c = audio.currentTime || 0;
    time.textContent = fmt(c) + ' / ' + fmt(d);
    if (isFinite(d) && d > 0) {
      seek.disabled = false;
      if (!dragging) seek.value = Math.round((c / d) * 1000);
    } else {
      seek.disabled = true;
      seek.value = 0;
    }
    const spoken = fmt(c) + ' of ' + fmt(d);
    if (seek.getAttribute('aria-valuetext') !== spoken) seek.setAttribute('aria-valuetext', spoken);
  }
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('durationchange', updateTime);

  seek.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  seek.addEventListener('input', () => {
    const d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    const t = (seek.value / 1000) * d;
    audio.currentTime = t;
    try {                                   // la vidéo du globe suit la position du son
      if (typeof videoActuelle !== 'undefined' && videoActuelle &&
          isFinite(videoActuelle.duration) && videoActuelle.duration > 0) {
        videoActuelle.currentTime = (t / d) * videoActuelle.duration;
      }
    } catch (e) { /* pas de vidéo */ }
    updateTime();
  });

  /* ---------- vitesse ---------- */
  let rate = 1;
  function applyRate() {
    audio.defaultPlaybackRate = rate;       // un nouveau son garde la vitesse choisie
    audio.playbackRate = rate;
    try {
      if (typeof videoActuelle !== 'undefined' && videoActuelle) videoActuelle.playbackRate = rate;
    } catch (e) { /* pas de vidéo */ }
  }
  speed.addEventListener('change', () => {
    rate = parseFloat(speed.value) || 1;
    speed.setAttribute('aria-label', 'Playback speed, ' + rate + ' times');
    applyRate();
  });
  audio.addEventListener('loadstart', applyRate);
  audio.addEventListener('play', applyRate);

  /* ---------- téléchargement ---------- */
  download.addEventListener('click', () => {
    const url = audio.currentSrc;
    if (!url) return;
    const layer = (typeof disqueActif !== 'undefined' && disqueActif && disqueActif.id) ? disqueActif.id : 'sound';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const ext = url.startsWith('blob:') ? 'wav' : ((url.split('?')[0].split('.').pop() || 'wav').slice(0, 4));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'earth-jukebox-' + layer + '-' + stamp + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  /* ---------- petite onde sonore ---------- */
  let audioCtx = null;
  let analyser = null;
  let samples = null;
  let graphTried = false;

  // Le navigateur n'autorise le son Web Audio qu'après un geste de l'utilisateur :
  // on prépare donc l'analyseur au premier clic ou à la première touche.
  function initGraph() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return;
    }
    if (graphTried) return;
    graphTried = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    let source;
    try {
      audioCtx = new AC();
      source = audioCtx.createMediaElementSource(audio);
    } catch (e) { audioCtx = null; return; }

    try {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (e) {
      analyser = null;                                  // en cas de souci, le son doit quand même sortir
      try { source.disconnect(); source.connect(audioCtx.destination); } catch (e2) { /* rien */ }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  ['pointerdown', 'keydown'].forEach((type) => {
    document.addEventListener(type, (e) => {
      if (type === 'keydown' && e.key === 'Escape') return;
      initGraph();
    }, true);
  });

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function sizeCanvas() {
    const w = wave.clientWidth, h = wave.clientHeight;
    if (!w || !h || !g) return false;
    if (wave.width !== Math.round(w * dpr) || wave.height !== Math.round(h * dpr)) {
      wave.width = Math.round(w * dpr);
      wave.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return true;
  }

  function draw() {
    if (!g || !sizeCanvas()) return;
    const w = wave.clientWidth, h = wave.clientHeight;
    g.clearRect(0, 0, w, h);

    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#5aa9ff');
    grad.addColorStop(1, '#f2a33a');
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.lineCap = 'round';

    const playing = !audio.paused && !reduceMotion;
    const live = playing && analyser;
    if (live) analyser.getByteTimeDomainData(samples);
    const t = performance.now() / 1000;

    g.beginPath();
    for (let x = 0; x <= w; x += 2) {
      let v = 0;
      if (live) {
        v = (samples[Math.floor((x / w) * (samples.length - 1))] - 128) / 128;
      } else if (playing) {                              // analyseur indisponible : petite ondulation
        v = 0.35 * Math.sin(x / 9 + t * 6) * Math.sin(x / 37);
      }
      const y = h / 2 + Math.max(-1, Math.min(1, v * 1.8)) * (h / 2 - 2);
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  let raf = 0;
  function loop() {
    draw();
    raf = (!audio.paused && !reduceMotion) ? requestAnimationFrame(loop) : 0;
  }

  audio.addEventListener('play', () => {
    if (!audioCtx && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) initGraph();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    updateToggle();
    if (!raf) raf = requestAnimationFrame(loop);
  });
  audio.addEventListener('pause', () => { updateToggle(); draw(); });
  audio.addEventListener('ended', () => { updateToggle(); draw(); });

  refresh();
  draw();
})();
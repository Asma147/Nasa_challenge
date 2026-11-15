/*
  Earth Jukebox - accessibility (voice mode)

  1. On arrival, a voice says a polite welcome and explains that pressing Enter switches to voice mode.
  2. Enter  -> VOICE MODE (text-to-speech): every option you reach with Tab is read aloud,
              and every result shown in #description / #status is read aloud.
  3. "Continue normally" / Esc -> NORMAL MODE (the page works exactly as before).

  The welcome is a full-screen entry screen (markup in index.html, look in accessibility.css).

  This file does NOT depend on app.js: it only watches the page (focus + the #description and
  #status live regions), so it works with whatever app.js displays there.
*/
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const gate = $('gate');
  const btnVoice = $('gate-voice');
  const btnNormal = $('gate-normal');
  const BACKGROUND = ['header', 'main'].map((q) => document.querySelector(q)).filter(Boolean);
  const SUPPORTED = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  // Safety net: if index.html is an older version (no entry screen), say it clearly instead of crashing
  if (!gate || !btnVoice || !btnNormal) {
    console.warn('[accessibility.js] Entry screen not found (#gate, #gate-voice, #gate-normal). ' +
                 'index.html and accessibility.js are not from the same version: replace both, then press Ctrl+F5.');
    return;
  }

  /* ---------- texts (English by default, French if <html lang="fr">) ---------- */
  const TEXTS = {
    en: {
      tts: 'en-US',
      welcome: 'Welcome to Earth Jukebox. If you have any difficulty seeing the screen, please press Enter, ' +
               'and I will guide you by voice. Otherwise, you can simply continue as usual.',
      voiceOn: 'Voice mode is on. Use the Tab key to move between the options. I will read each one aloud, ' +
               'and Enter selects it. I will also read every result. ' +
               'Press R to repeat the last message, Escape to stop me, plus or minus to change my speed, ' +
               'M to leave voice mode, and B to go back to the start screen.',
      voiceOff: 'Voice mode is off.',
      speed: 'Speed',
      selected: 'selected', notSelected: 'not selected', button: 'button',
      unsupported: 'Voice mode is not available in this browser.'
    },
    fr: {
      tts: 'fr-FR',
      welcome: 'Bienvenue sur Earth Jukebox. Si vous avez des difficultés pour voir l\'écran, appuyez sur Entrée, ' +
               'et je vous guiderai à la voix. Sinon, vous pouvez simplement continuer normalement.',
      voiceOn: 'Mode vocal activé. Utilisez la touche Tab pour passer d\'une option à l\'autre. Je lirai chaque option, ' +
               'et Entrée la sélectionne. Je lirai aussi chaque résultat. ' +
               'Appuyez sur R pour répéter, Échap pour m\'arrêter, plus ou moins pour changer ma vitesse, ' +
               'M pour quitter le mode vocal, et B pour revenir à l\'écran d\'accueil.',
      voiceOff: 'Mode vocal désactivé.',
      speed: 'Vitesse',
      selected: 'sélectionné', notSelected: 'non sélectionné', button: 'bouton',
      unsupported: 'Le mode vocal n\'est pas disponible sur ce navigateur.'
    }
  };
  const T = TEXTS[(document.documentElement.lang || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'];

  let mode = 'welcome';            // 'welcome' | 'normal' | 'voice'
  let rate = 1;
  let lastMessage = '';
  let welcomeSpoken = false;       // true once the browser actually started speaking
  let autoplayBlocked = false;     // true if the browser refused to speak before a user gesture
  let lastGroup = null;
  let voice = null;
  const lastLive = new Map();      // last text spoken for each live region
  let closeTimer = null;

  /* ---------- speech ---------- */
  function pickVoice() {
    if (!SUPPORTED) return;
    const code = T.tts.slice(0, 2);
    voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(code)) || null;
  }
  if (SUPPORTED) { speechSynthesis.onvoiceschanged = pickVoice; pickVoice(); }

  function say(text, opts = {}) {
    if (!SUPPORTED || !text) return Promise.resolve('skip');
    if (!opts.noRepeat) lastMessage = text;
    return new Promise((resolve) => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = T.tts; u.rate = rate;
      if (voice) u.voice = voice;
      u.onstart = () => { if (opts.welcome) welcomeSpoken = true; };
      u.onend = () => resolve('done');
      u.onerror = (ev) => {
        if (opts.welcome && ev && ev.error === 'not-allowed') autoplayBlocked = true;
        resolve('cancelled');
      };
      speechSynthesis.speak(u);
    });
  }

  /* ---------- entry screen ---------- */
  function setBackgroundInert(on) {            // the page behind the entry screen is not reachable
    BACKGROUND.forEach((el) => { el.inert = on; });
  }

  function openGate() {
    clearTimeout(closeTimer);
    gate.classList.remove('leaving');
    gate.hidden = false;
    setBackgroundInert(true);
  }

  function closeGate() {
    setBackgroundInert(false);
    const done = () => { gate.hidden = true; gate.classList.remove('leaving'); };
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    gate.classList.add('leaving');
    closeTimer = setTimeout(done, 350);
  }

  function showWelcome() {
    if (!SUPPORTED) {                          // no speech in this browser: say so, keep only the normal mode
      const note = $('gate-text');
      if (note) { note.textContent = T.unsupported; note.hidden = false; }
      btnVoice.hidden = true;
    }
    openGate();
    if (SUPPORTED) btnVoice.focus();     // a screen reader reads this button; Enter activates it
    if (SUPPORTED) {
      say(T.welcome, { welcome: true });
      // Browsers often refuse to speak before the user does something: remember it, speak on the first key
      setTimeout(() => { if (mode === 'welcome' && !welcomeSpoken) autoplayBlocked = true; }, 1200);
    }
  }

  function firstGesture(e) {
    if (mode !== 'welcome' || welcomeSpoken || !autoplayBlocked) return;
    const ignored = ['Enter', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'];
    if (e.type === 'keydown' && ignored.includes(e.key)) return;
    if (e.type === 'pointerdown' && e.target.closest && e.target.closest('button')) return;
    autoplayBlocked = false;
    say(T.welcome, { welcome: true });
  }

  /* ---------- modes ---------- */
  function goNormal() {
    if (SUPPORTED) speechSynthesis.cancel();
    mode = 'normal';
    closeGate();
    const first = document.querySelector('#filters button');
    if (first) first.focus();
  }

  function enterVoice() {
    mode = 'voice';
    closeGate();
    document.body.classList.add('voice-mode');
    // Avoid double reading if a screen reader is also running: we read these regions ourselves
    ['description', 'status'].forEach((id) => { const el = $(id); if (el) el.setAttribute('aria-live', 'off'); });
    say(T.voiceOn).then((r) => {
      if (r !== 'done' || mode !== 'voice') return;
      const first = document.querySelector('#filters button, #regions button, #select');
      if (first) first.focus();                          // focusin handler reads it
    });
  }

  function leaveVoice() {
    mode = 'normal';
    document.body.classList.remove('voice-mode');
    ['description', 'status'].forEach((id) => { const el = $(id); if (el) el.setAttribute('aria-live', 'polite'); });
    say(T.voiceOff, { noRepeat: true });
  }

  /* ---------- back to the entry screen (the page with the two buttons) ---------- */
  function backToStart() {
    if (SUPPORTED) speechSynthesis.cancel();
    if (mode === 'voice') {
      document.body.classList.remove('voice-mode');
      ['description', 'status'].forEach((id) => { const el = $(id); if (el) el.setAttribute('aria-live', 'polite'); });
    }
    try { if (typeof audio !== 'undefined') audio.pause(); } catch (e) { /* no sound playing */ }
    const pauseBtn = $('pause');
    if (pauseBtn && !pauseBtn.hidden) pauseBtn.textContent = 'Play sound';
    mode = 'welcome';
    welcomeSpoken = false; autoplayBlocked = false; lastGroup = null;
    openGate();
    btnVoice.focus();
    if (SUPPORTED) say(T.welcome, { welcome: true });
  }

  /* ---------- voice mode: read what gets focus ---------- */
  function labelOf(el) {
    let text = el.getAttribute('aria-label') || el.textContent || el.value || '';
    text = text.replace(/\s+/g, ' ').trim();
    if (el.hasAttribute('aria-pressed')) {
      text += ', ' + (el.getAttribute('aria-pressed') === 'true' ? T.selected : T.notSelected);
    }
    if (el.tagName === 'BUTTON') text += ', ' + T.button;
    return text;
  }

  document.addEventListener('focusin', (e) => {
    if (mode !== 'voice') return;
    const el = e.target;
    if (!(el instanceof HTMLElement) || el === document.body) return;
    const group = el.closest('[role="group"]');
    let text = labelOf(el);
    if (group && group !== lastGroup) {
      const name = group.getAttribute('aria-label');
      if (name) text = name + '. ' + text;
    }
    lastGroup = group;
    say(text);
  });

  /* ---------- voice mode: read every result shown by the page ---------- */
  function watchLive(id) {
    const el = $(id);
    if (!el) return;
    new MutationObserver(() => {
      if (mode !== 'voice') return;
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text || text === lastLive.get(id)) return;
      lastLive.set(id, text);
      say(text);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
  watchLive('description');
  watchLive('status');

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    firstGesture(e);
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (mode === 'welcome') {
      // Enter with nothing focused (or the page just loaded) = voice mode.
      // If a button of the entry screen has the focus, its own click handles Enter.
      if (e.key === 'Enter' && SUPPORTED && document.activeElement === document.body) {
        e.preventDefault();
        enterVoice();
      } else if (e.key === 'Escape') {
        goNormal();
      }
      return;
    }

    if (mode === 'voice') {
      const k = e.key.toLowerCase();
      if (k === 'r') { e.preventDefault(); say(lastMessage); }
      else if (k === 'escape') { speechSynthesis.cancel(); }
      else if (k === 'm') { e.preventDefault(); leaveVoice(); }
      else if (k === 'b') { e.preventDefault(); backToStart(); }
      else if (k === '+' || k === '=') { e.preventDefault(); rate = Math.min(2, rate + 0.25); say(`${T.speed} ${rate}`); }
      else if (k === '-' || k === '_') { e.preventDefault(); rate = Math.max(0.5, rate - 0.25); say(`${T.speed} ${rate}`); }
    }
  });

  // First click anywhere on the entry screen (outside the buttons): speak the welcome if the browser blocked it
  document.addEventListener('pointerdown', firstGesture);

  const btnBack = $('back-to-start');
  if (btnBack) btnBack.addEventListener('click', backToStart);

  btnVoice.addEventListener('click', enterVoice);
  btnNormal.addEventListener('click', goNormal);

  /* ---------- animated background of the main page ---------- */
  (function spaceBackground() {
    const bg = $('space-bg');
    const globeBox = $('globe');
    if (!bg || !globeBox) return;

    // Put the sound waves around the globe, whatever the size of the window
    function place() {
      const r = globeBox.getBoundingClientRect();
      if (!r.width || !r.height) return;
      bg.style.setProperty('--cx', (r.left + r.width / 2) + 'px');
      bg.style.setProperty('--cy', (r.top + r.height / 2) + 'px');
      bg.style.setProperty('--p', (Math.min(r.width, r.height) * 0.74) + 'px');
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('load', place);
    if ('ResizeObserver' in window) new ResizeObserver(place).observe(globeBox);

    // The globe used to paint an opaque background over everything: make it transparent
    // so the stars and the waves show through (globe comes from app.js)
    try { if (typeof globe !== 'undefined') globe.backgroundColor('rgba(0,0,0,0)'); } catch (e) { /* ignore */ }
  })();

  showWelcome();
})();
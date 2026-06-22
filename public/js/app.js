/**
 * app.js — orchestrateur : skin + layout + réglages au démarrage, mise à l'échelle
 * du viewport 1920×720, branchement du bus véhicule, entrée Paramètres (appui long),
 * panneau DEV. Expose window.App pour le menu Paramètres / la calibration.
 */
(() => {
  const VW = 1920, VH = 720;
  let currentLayout = null;
  let invertLR = false;

  /* ─── Fit ─── */
  let fitMode = 0; // 0=contain, 1=100%, 2=largeur
  function applyFit() {
    const vp = document.getElementById('viewport');
    const aw = window.innerWidth, ah = window.innerHeight;
    let scale;
    if (fitMode === 0) scale = Math.min(aw / VW, ah / VH);
    else if (fitMode === 1) scale = 1;
    else scale = aw / VW;
    vp.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', applyFit);
  function getScale() { const m = (document.getElementById('viewport').style.transform || '').match(/scale\(([0-9.]+)\)/); return m ? parseFloat(m[1]) : 1; }

  /* ─── Layout (positions/scale, avec inversion G/D optionnelle) ─── */
  function applyLayout(layout) {
    if (!layout) return;
    currentLayout = layout;
    const els = layout.elements || {};
    for (const id of Object.keys(els)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const s = els[id];
      const sc = s.scale != null ? s.scale : 1;
      let x = s.x;
      if (invertLR) x = VW - (s.x + (s.baseW || 0) * sc); // miroir horizontal des positions
      el.style.left = x + 'px';
      el.style.top = s.y + 'px';
      const content = el.querySelector('.el-content');
      if (content) content.style.transform = `scale(${sc})`;
    }
  }
  async function loadLayout() {
    try { applyLayout(await (await fetch('/api/layout')).json()); }
    catch (e) { console.warn('layout indisponible', e); }
  }

  /* ─── Affichage (luminosité + inversion) ─── */
  function applyDisplay(display) {
    if (!display) return;
    const b = display.brightness != null ? display.brightness : 100;
    document.getElementById('viewport').style.filter = `brightness(${b}%)`;
    invertLR = !!display.invertLR;
    applyLayout(currentLayout);
  }

  /* ─── Panneau DEV ─── */
  const SCENARIOS = ['idle', 'city', 'highway', 'cold_start', 'overheat', 'low_fuel'];
  function buildDevPanel() {
    const row = document.getElementById('dev-scenarios');
    SCENARIOS.forEach(s => {
      const b = document.createElement('button');
      b.textContent = s;
      b.onclick = () => { Bus.send({ cmd: 'scenario', value: s }); row.querySelectorAll('button').forEach(x => x.classList.remove('active')); b.classList.add('active'); };
      row.appendChild(b);
    });
  }
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'd' || e.key === 'D') document.getElementById('dev-panel').classList.toggle('hidden');
    else if (e.key === 'f' || e.key === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }
    else if (e.key === 'g' || e.key === 'G') { fitMode = (fitMode + 1) % 3; applyFit(); }
    else if (e.key === 's' || e.key === 'S') { if (window.Settings) Settings.open(); } // pavé : ouvrir Paramètres
  });

  /* ─── Appui long sur une zone neutre → Paramètres ─── */
  function setupLongPress() {
    const stage = document.getElementById('stage');
    let t = null;
    const start = (e) => {
      // ignore seulement les contrôles interactifs ; le compteur/jauges/fond sont pressables
      if (e.target.closest('.instruction,.music-mini,.mini-next,.nav-voice,.kb-screen,#dev-panel,.mf-tabs,.sp-row,.sp-card,#settings-overlay,#calib-overlay')) return;
      t = setTimeout(() => { if (window.Settings) Settings.open(); }, 600);
    };
    const cancel = () => { if (t) { clearTimeout(t); t = null; } };
    stage.addEventListener('pointerdown', start);
    stage.addEventListener('pointerup', cancel);
    stage.addEventListener('pointermove', cancel);
    stage.addEventListener('pointercancel', cancel);
  }

  /* ─── Boot ─── */
  async function boot() {
    applyFit();
    await Skins.load();                       // applique le skin actif (vars + render_style)
    let bootSettings = {};
    try { bootSettings = await (await fetch('/api/settings')).json(); applyDisplay(bootSettings.display); } catch {}
    await loadLayout();

    Cluster.render();
    Nav.init();
    if (Nav.setMapTheme) Nav.setMapTheme((bootSettings.nav || {}).mapTheme || 'dark');
    Keyboard.init();
    Music.init();
    buildDevPanel();
    setupLongPress();

    // re-render au changement de skin
    Skins.onChange(() => { Cluster.render(); if (Nav.applySkin) Nav.applySkin(); });

    Bus.onData(d => {
      Cluster.update(d);
      if (d.speed != null) Nav.updateSpeed(d.speed);
      if (d.gps_lat != null) Nav.updatePosition(d.gps_lat, d.gps_lon, d.gps_fix);
    });
    Bus.start();
  }

  // API exposée (menu Paramètres / calibration)
  window.App = {
    reloadLayout: loadLayout,
    applyLayout,
    applyDisplay,
    getScale,
    get layout() { return currentLayout; },
    get invertLR() { return invertLR; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

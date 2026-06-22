/**
 * settings.js — menu Paramètres plein écran (1920×720), ouvert par appui long
 * (ou touche S). Sections : Skins, Calibration, Affichage, Spotify, Réseau, Système.
 * Tactile (cibles ≥60px) et pilotable au pavé. Réglages persistés côté serveur.
 */
const Settings = (() => {
  let built = false, settings = { display: { brightness: 100, invertLR: false }, nav: { mapTheme: 'dark' } };
  let sensorUnsub = null;

  const SECTIONS = [
    ['skins', '🎨', 'Skins'],
    ['calib', '🎯', 'Calibration jauges'],
    ['display', '🔆', 'Affichage'],
    ['nav', '🗺️', 'Navigation'],
    ['spotify', '♪', 'Spotify'],
    ['network', '📶', 'Réseau'],
    ['system', '⚙', 'Système']
  ];

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function build() {
    const ov = el('div'); ov.id = 'settings-overlay';
    const nav = el('div', 'set-nav');
    nav.appendChild(el('div', 'set-title', 'PARAMÈTRES'));
    SECTIONS.forEach(([id, ico, label]) => {
      const b = el('button', 'set-tab', `<span class="ico">${ico}</span><span>${label}</span>`);
      b.dataset.sec = id; b.onclick = () => show(id);
      nav.appendChild(b);
    });
    const close = el('button', 'set-close', '✕  FERMER'); close.onclick = closeMenu;
    nav.appendChild(close);

    const content = el('div', 'set-content');
    content.appendChild(sectionSkins());
    content.appendChild(sectionCalib());
    content.appendChild(sectionDisplay());
    content.appendChild(sectionNav());
    content.appendChild(sectionSpotify());
    content.appendChild(sectionNetwork());
    content.appendChild(sectionSystem());

    ov.appendChild(nav); ov.appendChild(content);
    document.getElementById('viewport').appendChild(ov);
    built = true;
    // capteurs live : un seul abonnement, n'écrit que si le menu est ouvert
    Bus.onData(d => {
      if (!ov.classList.contains('open')) return;
      for (const k of ['speed', 'rpm', 'fuel', 'fuel_ohm', 'temp', 'temp_raw', 'gps_lat', 'gps_lon', 'gps_fix']) { const e = document.getElementById('sens-' + k); if (e) e.textContent = String(d[k]); }
    });
  }

  function section(id) { const s = el('div', 'set-section'); s.id = 'sec-' + id; return s; }

  /* — Skins — */
  function sectionSkins() {
    const s = section('skins');
    s.appendChild(el('div', 'set-h', 'Skins'));
    s.appendChild(el('div', 'set-sub', 'Thème visuel complet (couleurs, polices, style de rendu). La logique reste identique. Voir docs/SKINS.md pour créer le vôtre.'));
    const grid = el('div', 'skin-grid'); grid.id = 'skin-grid';
    s.appendChild(grid);
    const imp = el('button', 'set-btn', '＋ Importer un skin (.json)'); imp.style.marginTop = '24px';
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; file.style.display = 'none';
    file.onchange = () => importSkin(file);
    imp.onclick = () => file.click();
    s.appendChild(imp); s.appendChild(file);
    return s;
  }
  function renderSkins() {
    const grid = document.getElementById('skin-grid'); if (!grid) return;
    grid.innerHTML = '';
    (Skins.list || []).forEach(sk => {
      const active = Skins.active && Skins.active.id === sk.id;
      const card = el('div', 'skin-card' + (active ? ' active' : '')); card.style.position = 'relative';
      const accent = (sk.vars && sk.vars['--accent']) || '#02BFA6';
      const bg = (sk.vars && sk.vars['--bg-cluster']) || '#080808';
      card.appendChild(el('div', 'skin-swatch', sk.name)).setAttribute('style', `background:${bg};color:${accent};`);
      card.appendChild(el('div', 'skin-name', `${sk.name}${active ? '<div class="skin-active">● ACTIF</div>' : ''}`));
      card.onclick = async () => { await Skins.setActive(sk.id); renderSkins(); };
      if (sk.id !== 'mjdata' && sk.id !== 'tva') {
        const del = el('button', 'skin-del', '✕'); del.title = 'Supprimer';
        del.onclick = (e) => { e.stopPropagation(); deleteSkin(sk.id, sk.name); };
        card.appendChild(del);
      }
      grid.appendChild(card);
    });
  }
  async function importSkin(input) {
    const f = input.files && input.files[0]; if (!f) return;
    try {
      const skin = JSON.parse(await f.text());
      const id = skin.id || skin.name || f.name.replace(/\.json$/i, '');
      const r = await fetch('/api/skins/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, skin }) });
      const j = await r.json();
      if (!r.ok) alert('Import refusé : ' + (j.error || 'erreur'));
      else { await Skins.load(); renderSkins(); alert('Skin importé : ' + (skin.name || j.id)); }
    } catch (e) { alert('Fichier invalide : un skin.json (JSON) est attendu.'); }
    input.value = '';
  }
  async function deleteSkin(id, name) {
    if (!confirm('Supprimer le skin « ' + name + ' » ?')) return;
    try {
      const r = await fetch('/api/skins/' + encodeURIComponent(id), { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) { alert('Suppression refusée : ' + (j.error || '')); return; }
      await Skins.load(); renderSkins();
    } catch { alert('Suppression impossible.'); }
  }

  /* — Calibration — */
  function sectionCalib() {
    const s = section('calib');
    s.appendChild(el('div', 'set-h', 'Calibration des jauges'));
    s.appendChild(el('div', 'set-sub', 'Cale chaque élément derrière les ouvertures du cache, casquette posée sur l’écran. Touche un élément → le côté opposé devient la télécommande.'));
    const b = el('button', 'set-btn primary', 'Entrer en mode calibration'); b.style.minWidth = '320px';
    b.onclick = () => { closeMenu(); Calibration.open(); };
    s.appendChild(b);
    return s;
  }

  /* — Affichage — */
  function sectionDisplay() {
    const s = section('display');
    s.appendChild(el('div', 'set-h', 'Affichage'));
    s.appendChild(el('div', 'set-sub', 'Luminosité et inversion gauche/droite du layout.'));
    // luminosité
    const r1 = el('div', 'set-row');
    r1.appendChild(el('div', null, '<label>Luminosité</label>'));
    const wrap = el('div'); wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '16px';
    const rng = el('input'); rng.type = 'range'; rng.min = '30'; rng.max = '100'; rng.id = 'set-bright';
    const val = el('div', 'set-val'); val.id = 'set-bright-val';
    rng.oninput = () => { val.textContent = rng.value + '%'; settings.display.brightness = +rng.value; App.applyDisplay(settings.display); };
    rng.onchange = persist;
    wrap.appendChild(rng); wrap.appendChild(val); r1.appendChild(wrap); s.appendChild(r1);
    // inversion
    const r2 = el('div', 'set-row');
    r2.appendChild(el('div', null, '<label>Inverser gauche/droite</label><div class="hint">Compteur à droite, navigation à gauche</div>'));
    const tg = el('div', 'set-toggle'); tg.id = 'set-invert';
    tg.onclick = () => { settings.display.invertLR = !settings.display.invertLR; tg.classList.toggle('on', settings.display.invertLR); App.applyDisplay(settings.display); persist(); };
    r2.appendChild(tg); s.appendChild(r2);
    return s;
  }

  /* — Navigation — */
  function sectionNav() {
    const s = section('nav');
    s.appendChild(el('div', 'set-h', 'Navigation'));
    s.appendChild(el('div', 'set-sub', 'Fond de carte clair pour une meilleure lisibilité en plein jour (sinon carte sombre).'));
    const r = el('div', 'set-row');
    r.appendChild(el('div', null, '<label>Carte claire (jour)</label><div class="hint">Tuiles claires ; sinon fond sombre</div>'));
    const tg = el('div', 'set-toggle'); tg.id = 'set-lightmap';
    tg.onclick = () => {
      const light = settings.nav.mapTheme !== 'light';
      settings.nav.mapTheme = light ? 'light' : 'dark';
      tg.classList.toggle('on', light);
      if (typeof Nav !== 'undefined' && Nav.setMapTheme) Nav.setMapTheme(settings.nav.mapTheme);
      persist();
    };
    r.appendChild(tg); s.appendChild(r);
    return s;
  }

  /* — Spotify — */
  function sectionSpotify() {
    const s = section('spotify');
    s.appendChild(el('div', 'set-h', 'Spotify'));
    const status = el('div', 'set-sub'); status.id = 'set-spotify-status'; status.textContent = '…';
    s.appendChild(status);
    const b = el('button', 'set-btn primary', 'Connecter / Reconnecter'); b.id = 'set-spotify-btn';
    b.onclick = () => { location.href = '/spotify/login'; };
    s.appendChild(b);
    return s;
  }
  async function refreshSpotify() {
    const st = document.getElementById('set-spotify-status'); if (!st) return;
    try {
      const j = await (await fetch('/spotify/status')).json();
      if (!j.configured) st.textContent = 'Non configuré (SPOTIFY_CLIENT_ID absent dans .env).';
      else if (j.authenticated) st.textContent = `Connecté : ${j.user || '✓'}${j.premium ? ' · Premium' : ''}. Appareil cible : ${j.deviceName || '—'}.`;
      else st.textContent = 'Configuré mais non connecté. Touche « Connecter ».';
    } catch { st.textContent = 'Statut indisponible.'; }
  }

  /* — Réseau — */
  function sectionNetwork() {
    const s = section('network');
    s.appendChild(el('div', 'set-h', 'Réseau'));
    s.appendChild(el('div', 'set-sub', 'Spotify et la navigation (cartes/itinéraire/radars) dépendent du réseau (tethering 4G en voiture).'));
    const st = el('div', 'set-row', '<label>État connexion</label>'); const v = el('div', 'set-val'); v.id = 'set-net'; st.appendChild(v); s.appendChild(st);
    return s;
  }
  function refreshNetwork() { const v = document.getElementById('set-net'); if (v) { v.textContent = navigator.onLine ? 'EN LIGNE' : 'HORS LIGNE'; v.style.color = navigator.onLine ? 'var(--accent)' : 'var(--alert)'; } }

  /* — Système — */
  function sectionSystem() {
    const s = section('system');
    s.appendChild(el('div', 'set-h', 'Système'));
    s.appendChild(el('div', 'set-sub', 'Version, redémarrage, et valeurs capteurs brutes en direct (debug).'));
    const r = el('div', 'set-row', '<label>Version</label>'); r.appendChild(el('div', 'set-val', 'MJ Data 0.1')); s.appendChild(r);
    const rb = el('div', 'set-row', '<label>Application</label>'); const b = el('button', 'set-btn', '↻ Redémarrer'); b.onclick = () => location.reload(); rb.appendChild(b); s.appendChild(rb);
    s.appendChild(el('div', 'set-h', 'Capteurs (live)')).style.fontSize = '18px';
    const grid = el('div', 'sensor-grid'); grid.id = 'sensor-grid';
    ['speed', 'rpm', 'fuel', 'fuel_ohm', 'temp', 'temp_raw', 'gps_lat', 'gps_lon', 'gps_fix'].forEach(k => {
      const c = el('div', 'sensor-cell', `<div class="k">${k}</div><div class="v" id="sens-${k}">–</div>`); grid.appendChild(c);
    });
    s.appendChild(grid);
    return s;
  }

  /* — navigation sections — */
  function show(id) {
    document.querySelectorAll('.set-tab').forEach(t => t.classList.toggle('active', t.dataset.sec === id));
    document.querySelectorAll('.set-section').forEach(sec => sec.classList.toggle('active', sec.id === 'sec-' + id));
    if (id === 'skins') renderSkins();
    if (id === 'spotify') refreshSpotify();
    if (id === 'network') refreshNetwork();
  }

  async function persist() {
    try { await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display: settings.display, nav: settings.nav }) }); } catch {}
  }

  async function open() {
    if (!built) build();
    try { settings = { display: { brightness: 100, invertLR: false }, nav: { mapTheme: 'dark' }, ...(await (await fetch('/api/settings')).json()) }; } catch {}
    if (!settings.nav) settings.nav = { mapTheme: 'dark' };
    document.getElementById('set-bright').value = settings.display.brightness;
    document.getElementById('set-bright-val').textContent = settings.display.brightness + '%';
    document.getElementById('set-invert').classList.toggle('on', !!settings.display.invertLR);
    document.getElementById('set-lightmap').classList.toggle('on', settings.nav.mapTheme === 'light');
    document.getElementById('settings-overlay').classList.add('open');
    show('skins');
  }
  function closeMenu() { document.getElementById('settings-overlay').classList.remove('open'); }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('settings-overlay')?.classList.contains('open')) closeMenu(); });

  return { open, close: closeMenu };
})();
window.Settings = Settings; // exposé explicitement (const ne s'attache pas à window)

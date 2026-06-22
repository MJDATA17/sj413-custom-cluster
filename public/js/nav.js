/**
 * nav.js — navigation réelle (jalon 6).
 *  - Carte Leaflet (tuiles sombres CARTO/OSM), vue cap-en-haut (rotation CSS du
 *    conteneur surdimensionné, masqué par le cercle), véhicule centré.
 *  - Itinéraire OSRM (/api/route) tracé en teal ; guidage tiré des steps.
 *  - Position : dead-reckoning le long de la route à la vitesse du bus (SIM) ; en
 *    PROD on remplacera par le GPS réel (updatePosition). Lane guidance + instruction
 *    repris du design 02.
 *  - Radars (/api/radars/near) : alerte d'approche + VMA + survitesse + voix.
 *  - Fallback : si Leaflet/tuiles indisponibles, rendu stylisé canvas (design 02).
 */
const Nav = (() => {
  const TEAL = '#02BFA6';
  function accent() { return (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim() || TEAL; }
  const state = { speed: 0, limit: 90, dist: 0, maneuver: 'straight', street: '', lanes: 3, activeLanes: [1], navigating: false, roadOffset: 0 };
  let pos = [45.9412, -0.9590];     // Rochefort par défaut
  let heading = 0;                  // cap affiché (lissé)
  let targetHeading = 0;            // cap cible (vers lequel on lisse)
  let voice = false;
  const BASE_ZOOM = 16;             // zoom Leaflet FIXE (les tuiles ne se rechargent pas)
  let curScale = 1, targetScale = 1; // zoom d'approche fait en CSS (scale), pas en Leaflet
  let approaching = false;          // proche d'une manœuvre → voies + zoom
  let lastStepKey = null, lastGps = null;

  /* ── Leaflet ── */
  let map = null, routeLayer = null, useLeaflet = false;
  let mapEl = null;
  let tileLayer = null, mapTheme = 'dark';
  const TILES = {
    dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
  };
  // Bascule carte sombre/claire (paramètre « Carte claire » du menu)
  function setMapTheme(theme) {
    mapTheme = (theme === 'light') ? 'light' : 'dark';
    document.body.classList.toggle('nav-light', mapTheme === 'light');
    if (tileLayer) tileLayer.setUrl(TILES[mapTheme]);
  }

  function initMap() {
    if (typeof L === 'undefined') return false;
    try {
      mapEl = document.getElementById('nav-map');
      map = L.map(mapEl, {
        zoomControl: false, attributionControl: true, dragging: false, touchZoom: false,
        doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false,
        zoomSnap: 0, inertia: false
      }).setView(pos, 16);
      tileLayer = L.tileLayer(TILES[mapTheme], {
        maxZoom: 19, subdomains: 'abcd', attribution: '© OSM © CARTO', crossOrigin: true
      }).addTo(map);
      map.attributionControl.setPrefix('');
      setTimeout(() => map.invalidateSize(), 100);
      return true;
    } catch (e) { console.warn('[nav] Leaflet KO, fallback canvas:', e); return false; }
  }

  /* ── géométrie ── */
  const toR = x => x * Math.PI / 180, toD = x => x * 180 / Math.PI;
  function hm(a, b) { const R = 6371000, dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]); const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)); }
  function bearing(a, b) { const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0])); const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1])); return (toD(Math.atan2(y, x)) + 360) % 360; }

  /* ── route ── */
  let route = null, traveled = 0, lastVoicedStep = -1;
  function buildRoute(data) {
    const C = data.coordinates;
    const cum = [0];
    for (let i = 1; i < C.length; i++) cum[i] = cum[i - 1] + hm(C[i - 1], C[i]);
    const total = cum[cum.length - 1];
    const steps = data.steps.map(s => {
      let best = 0, bd = 1e12;
      for (let i = 0; i < C.length; i++) { const d = hm([s.lat, s.lon], C[i]); if (d < bd) { bd = d; best = i; } }
      return { dir: dirOf(s.modifier, s.type), name: s.name, atDist: cum[best], type: s.type, exit: s.exit, relAngle: relAngleOf(s) };
    }).sort((a, b) => a.atDist - b.atDist);
    return { C, cum, total, duration: data.duration || total / 13.9, steps };
  }
  function dirOf(mod, type) {
    if (type === 'arrive') return 'arrive';
    if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'roundabout';
    mod = mod || ''; if (mod.includes('left')) return 'left'; if (mod.includes('right')) return 'right'; return 'straight';
  }
  // angle de sortie relatif (cap après − cap avant), sinon estimé depuis le modifier
  function relAngleOf(s) {
    if (typeof s.bearingBefore === 'number' && typeof s.bearingAfter === 'number')
      return ((s.bearingAfter - s.bearingBefore + 540) % 360) - 180;
    const m = s.modifier || '';
    if (m.includes('sharp left')) return -135; if (m.includes('slight left')) return -45; if (m.includes('left')) return -90;
    if (m.includes('sharp right')) return 135; if (m.includes('slight right')) return 45; if (m.includes('right')) return 90;
    return 0;
  }
  function ordinal(n) { n = n || 1; return n === 1 ? '1re' : (n + 'e'); }
  // icône de rond-point : anneau + entrée par le bas + flèche teal vers la sortie exacte
  function roundaboutSvg(relAngle) {
    const cx = 24, cy = 22, r = 9, a = (relAngle || 0) * Math.PI / 180;
    const ux = Math.sin(a), uy = -Math.cos(a);
    const ex = (cx + r * ux).toFixed(1), ey = (cy + r * uy).toFixed(1);
    const tx = cx + (r + 12) * ux, ty = cy + (r + 12) * uy, txf = tx.toFixed(1), tyf = ty.toFixed(1);
    const dirA = Math.atan2(uy, ux);
    const w1 = `${(tx + 8 * Math.cos(dirA + Math.PI - 0.4)).toFixed(1)},${(ty + 8 * Math.sin(dirA + Math.PI - 0.4)).toFixed(1)}`;
    const w2 = `${(tx + 8 * Math.cos(dirA + Math.PI + 0.4)).toFixed(1)},${(ty + 8 * Math.sin(dirA + Math.PI + 0.4)).toFixed(1)}`;
    return `<svg viewBox="0 0 48 48" fill="none">`
      + `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>`
      + `<path d="M24 44 L24 ${(cy + r).toFixed(1)}" stroke="rgba(255,255,255,0.5)" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M${ex} ${ey} L${txf} ${tyf}" stroke="#02BFA6" stroke-width="3.4" stroke-linecap="round"/>`
      + `<path d="M${w1} L${txf} ${tyf} L${w2}" stroke="#02BFA6" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`
      + `</svg>`;
  }
  function interp(traveled) {
    const { C, cum, total } = route;
    if (traveled <= 0) return { p: C[0], brg: C[1] ? bearing(C[0], C[1]) : 0 };
    if (traveled >= total) return { p: C[C.length - 1], brg: bearing(C[C.length - 2], C[C.length - 1]) };
    let i = 1; while (i < cum.length && cum[i] < traveled) i++;
    const seg = (cum[i] - cum[i - 1]) || 1, t = (traveled - cum[i - 1]) / seg;
    return { p: [C[i - 1][0] + (C[i][0] - C[i - 1][0]) * t, C[i - 1][1] + (C[i][1] - C[i - 1][1]) * t], brg: bearing(C[i - 1], C[i]) };
  }
  function nextStep() { if (!route) return null; for (const s of route.steps) if (s.atDist > traveled + 8) return s; return route.steps[route.steps.length - 1] || null; }

  /* ── navigation ── */
  async function navigateTo(place) {
    try {
      const r = await fetch(`/api/route?from=${pos[0]},${pos[1]}&to=${place.lat},${place.lon}`);
      const data = await r.json();
      if (!data.coordinates || data.coordinates.length < 2) throw new Error('itinéraire vide');
      route = buildRoute(data); traveled = 0; lastVoicedStep = -1;
      state.navigating = true; state.street = place.name;
      drawRoute(data.coordinates);
      // init cap/zoom : on s'oriente vers un point devant, vue dézoomée, voies masquées
      const p0 = interp(0).p, a0 = interp(Math.min(route.total, 50)).p;
      heading = bearing(p0, a0); targetHeading = heading;
      approaching = false; targetScale = 1; lastStepKey = null; hideLanes();
      const s0 = nextStep(); applyInstruction(s0); lastStepKey = stepKey(s0);
      say(`Direction ${place.name}`);
    } catch (e) { console.warn('[nav] navigateTo', e); }
  }
  function drawRoute(coords) {
    if (!useLeaflet) return;
    if (routeLayer) routeLayer.remove();
    routeLayer = L.polyline(coords, { color: accent(), weight: 6, opacity: 0.9, className: 'route-line', lineJoin: 'round', lineCap: 'round' }).addTo(map);
  }
  function applySkin() { if (routeLayer) routeLayer.setStyle({ color: accent() }); }
  function stopNav() { state.navigating = false; route = null; if (routeLayer) { routeLayer.remove(); routeLayer = null; } approaching = false; targetScale = 1; lastStepKey = null; hideLanes(); setIdleInstruction(); }

  /* ── instruction + lanes (design 02) ── */
  function stepKey(s) { return s ? (Math.round(s.atDist) + '|' + s.dir + '|' + s.name) : ''; }
  function applyInstruction(s) {
    if (!s) return;
    state.step = s;
    state.maneuver = s.dir === 'arrive' ? 'straight' : s.dir;
    state.street = s.name || state.street;
    state.activeLanes = [s.dir === 'left' ? 0 : s.dir === 'right' ? state.lanes - 1 : Math.floor(state.lanes / 2)];
    renderInstruction();
  }
  function showLanes() { renderLanes(); }
  function hideLanes() { const c = document.getElementById('lanes'); if (c) c.innerHTML = ''; }
  function renderInstruction() {
    const a = document.getElementById('instr-arrow');
    const s = state.step;
    if (state.maneuver === 'roundabout' && s) {
      a.innerHTML = roundaboutSvg(s.relAngle);
      const ex = s.exit ? ordinal(s.exit) + ' sortie' : 'rond-point';
      document.getElementById('instr-street').textContent = s.name ? `${ex} · ${s.name}` : ex;
      (document.getElementById('mns-street') || {}).textContent = s.name || ex;
      return;
    }
    let svg;
    if (state.maneuver === 'right') svg = '<path d="M14 40 L14 24 Q14 18 20 18 L30 18" stroke="#02BFA6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M25 11 L33 18 L25 25" stroke="#02BFA6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    else if (state.maneuver === 'left') svg = '<path d="M34 40 L34 24 Q34 18 28 18 L18 18" stroke="#02BFA6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M23 11 L15 18 L23 25" stroke="#02BFA6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    else svg = '<path d="M24 40 L24 12" stroke="#02BFA6" stroke-width="5" stroke-linecap="round"/><path d="M15 21 L24 10 L33 21" stroke="#02BFA6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    a.innerHTML = `<svg viewBox="0 0 48 48" fill="none">${svg}</svg>`;
    document.getElementById('instr-street').textContent = state.street || '—';
    (document.getElementById('mns-street') || {}).textContent = state.street || '—';
  }
  function setIdleInstruction() {
    document.getElementById('instr-arrow').innerHTML = '<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="#02BFA6" stroke-width="3"/><path d="M24 16 v8 l6 4" stroke="#02BFA6" stroke-width="3" stroke-linecap="round"/></svg>';
    document.getElementById('instr-dist').innerHTML = 'GO';
    document.getElementById('instr-street').textContent = 'Choisir une destination';
    const trip = document.getElementById('instr-trip'); if (trip) trip.classList.remove('show');
  }
  function renderLanes() {
    const c = document.getElementById('lanes'); c.innerHTML = '';
    if (!state.navigating) return;
    // rond-point : on montre l'icône de sortie au lieu des voies
    if (state.maneuver === 'roundabout' && state.step) {
      const ex = state.step.exit ? ordinal(state.step.exit) + ' sortie' : 'rond-point';
      c.innerHTML = `<div class="roundabout-lane">${roundaboutSvg(state.step.relAngle)}<span>${ex}</span></div>`;
      return;
    }
    for (let i = 0; i < state.lanes; i++) {
      const lane = document.createElement('div'); const isActive = state.activeLanes.includes(i);
      lane.className = 'lane' + (isActive ? ' active' : '');
      let path;
      if (isActive && state.maneuver === 'right') path = '<path d="M13 34 L13 20 Q13 15 18 15 L24 15 M20 10 L26 15 L20 20" stroke="#02BFA6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
      else if (isActive && state.maneuver === 'left') path = '<path d="M13 34 L13 20 Q13 15 8 15 L2 15 M6 10 L0 15 L6 20" stroke="#02BFA6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
      else path = '<path d="M13 34 L13 8 M7 14 L13 6 L19 14" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
      lane.innerHTML = `<svg viewBox="0 0 26 38" style="color:#fff">${path}</svg>`;
      c.appendChild(lane);
    }
  }

  function refreshData() {
    const trip = document.getElementById('instr-trip');
    if (state.navigating && route) {
      const d = state.dist;
      document.getElementById('instr-dist').innerHTML = d >= 1000 ? (d / 1000).toFixed(1) + '<small>km</small>' : Math.round(d / 10) * 10 + '<small>m</small>';
      (document.getElementById('mns-dist') || {}).textContent = d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m';
      // distance restante jusqu'à la destination + heure d'arrivée estimée (profil OSRM)
      const remain = Math.max(0, route.total - traveled);
      const remainKm = remain >= 10000 ? Math.round(remain / 1000) + ' km' : remain >= 1000 ? (remain / 1000).toFixed(1) + ' km' : Math.round(remain / 50) * 50 + ' m';
      const remainSec = route.total > 0 ? route.duration * (remain / route.total) : 0;
      const eta = new Date(Date.now() + remainSec * 1000);
      const hhmm = String(eta.getHours()).padStart(2, '0') + ':' + String(eta.getMinutes()).padStart(2, '0');
      trip.innerHTML = `<b>${remainKm}</b> · arrivée ${hhmm}`;
      trip.classList.add('show');
    } else {
      trip.classList.remove('show');
    }
    document.getElementById('cs-num').textContent = Math.round(state.speed);
    const over = state.speed > state.limit;
    document.getElementById('current-speed').classList.toggle('over', over);
    document.getElementById('speed-limit').textContent = state.limit;
    document.getElementById('speed-limit').classList.toggle('over', over);
  }

  /* ── radars ── */
  const DEFAULT_LIMIT = 90;         // limite affichée hors zone radar (faute de données limites OSM)
  let radars = [], announcedRadar = null;
  async function pollRadars() {
    try {
      const r = await fetch(`/api/radars/near?lat=${pos[0]}&lon=${pos[1]}&radius=3000`);
      radars = (await r.json()).radars || [];
    } catch { radars = []; }
  }
  function updateRadarAlert() {
    // radar le plus proche "devant" (±75° du cap), sinon le plus proche
    let best = null;
    for (const rd of radars) {
      const b = bearing(pos, [rd.lat, rd.lon]);
      let diff = Math.abs(((b - heading + 540) % 360) - 180);
      if (state.navigating && diff > 75) continue;
      if (!best || rd.distance < best.distance) best = rd;
    }
    const el = document.getElementById('radar-alert');
    if (best && best.distance <= 2000) {
      el.classList.add('show');
      el.classList.toggle('imminent', best.distance <= 300);
      document.getElementById('radar-dist').textContent = best.distance >= 1000 ? (best.distance / 1000).toFixed(1) + ' km' : best.distance + ' m';
      document.getElementById('radar-vma').textContent = best.vma ? best.vma + ' km/h' : '';
      if (announcedRadar !== best.id && best.distance <= 500) { announcedRadar = best.id; say(`Radar à ${Math.round(best.distance / 10) * 10} mètres, limite ${best.vma}`); }
    } else {
      el.classList.remove('show', 'imminent');
      announcedRadar = null;
    }
    // panneau limite : VMA du radar seulement quand on est proche (≤800 m), sinon défaut
    state.limit = (best && best.vma && best.distance <= 800) ? best.vma : DEFAULT_LIMIT;
  }

  /* ── voix (SpeechSynthesis ; en PROD Debian = espeak, voir docs) ── */
  function say(text) {
    if (!voice || !('speechSynthesis' in window)) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; u.rate = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
  }
  function toggleVoice() {
    voice = !voice;
    const b = document.getElementById('nav-voice');
    b.classList.toggle('on', voice); b.classList.toggle('off', !voice);
    if (voice) say('Alertes vocales activées');
  }

  /* ── boucle ── */
  const APPROACH_ON = 120, APPROACH_OFF = 180; // m — hystérésis voies/zoom
  let lastT = 0, lastMapT = 0;
  function loop(ts) {
    const dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    const mps = state.speed / 3.6;

    if (state.navigating && route) {
      traveled += mps * dt;
      pos = interp(traveled).p;
      // cap = direction vers un point ~50 m DEVANT (évite le zigzag vertex-par-vertex)
      const ahead = interp(Math.min(route.total, traveled + 50)).p;
      if (hm(pos, ahead) > 3) targetHeading = bearing(pos, ahead);
      const s = nextStep();
      if (s) {
        state.dist = Math.max(0, s.atDist - traveled);
        const key = stepKey(s);
        if (key !== lastStepKey) { lastStepKey = key; applyInstruction(s); } // instruction MAJ au changement de step
        const isManeuver = s.dir === 'left' || s.dir === 'right' || s.dir === 'roundabout';
        // voies/rond-point + zoom uniquement à l'approche d'une manœuvre (hystérésis)
        const ap = approaching ? (isManeuver && state.dist < APPROACH_OFF) : (isManeuver && state.dist < APPROACH_ON);
        if (ap !== approaching) { approaching = ap; if (ap) showLanes(); else hideLanes(); targetScale = ap ? 1.5 : 1; }
        const idx = route.steps.indexOf(s);
        if (idx !== lastVoicedStep && state.dist < 150 && isManeuver) { lastVoicedStep = idx; say(instrPhrase(s)); }
      }
      if (traveled >= route.total) { say('Vous êtes arrivé'); stopNav(); }
    } else {
      targetScale = 1; // au repos : vue large, cap figé (pas de gigotement)
    }

    // lissage du cap (angle le plus court) et du zoom CSS
    heading += angDelta(heading, targetHeading) * 0.14;
    curScale += (targetScale - curScale) * 0.08;

    if (useLeaflet) {
      // rotation (cap) + zoom d'approche en CSS → fluide, AUCUN rechargement de tuiles
      mapEl.style.transform = `rotate(${-heading}deg) scale(${curScale.toFixed(3)})`;
      if (ts - lastMapT > 80) { lastMapT = ts; map.setView(pos, BASE_ZOOM, { animate: false }); }
    } else {
      drawCanvas();
    }

    updateRadarAlert();
    refreshData();
    requestAnimationFrame(loop);
  }
  function angDelta(from, to) { return ((to - from + 540) % 360) - 180; }
  function instrPhrase(s) {
    if (s.dir === 'roundabout') return `Au rond-point, prenez la ${ordinal(s.exit)} sortie${s.name ? ' vers ' + s.name : ''}`;
    const dir = s.dir === 'left' ? 'tournez à gauche' : s.dir === 'right' ? 'tournez à droite' : 'continuez tout droit';
    return `Dans ${Math.round(state.dist / 10) * 10} mètres, ${dir}${s.name ? ' sur ' + s.name : ''}`;
  }

  /* ── fallback canvas stylisé (design 02) ── */
  let cv, ctx;
  function drawCanvas() {
    if (!ctx) { cv = document.getElementById('map-canvas'); cv.style.display = 'block'; ctx = cv.getContext('2d'); }
    const W = 680, H = 680, CX = W / 2; state.roadOffset += state.speed * 0.04;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#0A0E14'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1; const off = state.roadOffset % 80;
    for (let i = -2; i < 12; i++) { const y = i * 80 + off; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
    ctx.save(); const roadW = 58, turnY = H * 0.40; ctx.beginPath(); ctx.moveTo(CX, H + 20); ctx.lineTo(CX, turnY + 60);
    if (state.maneuver === 'right') { ctx.quadraticCurveTo(CX, turnY, CX + 90, turnY - 10); ctx.lineTo(W + 20, turnY - 40); }
    else if (state.maneuver === 'left') { ctx.quadraticCurveTo(CX, turnY, CX - 90, turnY - 10); ctx.lineTo(-20, turnY - 40); }
    else ctx.lineTo(CX, turnY - 120);
    ctx.shadowColor = 'rgba(2,191,166,0.5)'; ctx.shadowBlur = 24; ctx.strokeStyle = 'rgba(2,191,166,0.85)'; ctx.lineWidth = roadW; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
  }

  /* ── API publique ── */
  function updateSpeed(s) { state.speed = s; }
  function updatePosition(lat, lon, fix) {
    // On N'UTILISE PAS le GPS symbolique (bruité) du simulateur pour la vue : la carte
    // reste stable au repos et suit le dead-reckoning pendant la navigation (pas de
    // gigotement). En PROD, remplacer ce corps par le suivi du GPS réel (précis) :
    //   if (fix) { pos = [lat, lon]; ... }
    lastGps = (fix && Number.isFinite(lat) && Number.isFinite(lon)) ? [lat, lon] : lastGps;
  }
  function getPosition() { return { lat: pos[0], lon: pos[1] }; }

  function init() {
    useLeaflet = initMap();
    setIdleInstruction(); renderLanes();
    pollRadars(); setInterval(pollRadars, 2500);
    requestAnimationFrame(loop);
  }

  return { init, updateSpeed, updatePosition, getPosition, navigateTo, stopNav, toggleVoice, applySkin, setMapTheme, state };
})();

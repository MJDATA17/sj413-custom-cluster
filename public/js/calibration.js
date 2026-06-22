/**
 * calibration.js — calibration in-situ des éléments (casquette posée sur l'écran).
 *
 * Interaction : touche un élément → il est sélectionné (surlignage discret) et le
 * MODULE OPPOSÉ devient un panneau de contrôle (flèches ↑↓←→ 1 px, +/− taille,
 * pas 1/10 px, élément suivant, enregistrer). Le panneau se place toujours du côté
 * OPPOSÉ pour n'être jamais masqué par la casquette qu'on regarde.
 * Enregistrer → POST /api/layout (persistant, rechargé au démarrage).
 */
const Calibration = (() => {
  const VW = 1920;
  const MM_PER_PX = 243.6 / 1920; // 1920 px = 243,6 mm
  const IDS = ['el-speedo', 'el-fuel', 'el-temp', 'el-nav'];
  let layout = null, sel = null, step = 1, built = false;
  let holdTimer = null, holdInt = null;

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* applique une position/scale BRUTE (sans inversion) sur l'élément réel */
  function applyEl(id) {
    const s = layout.elements[id]; const e = document.getElementById(id); if (!e || !s) return;
    e.style.left = s.x + 'px'; e.style.top = s.y + 'px';
    const c = e.querySelector('.el-content'); if (c) c.style.transform = `scale(${s.scale})`;
  }
  function applyAll() { IDS.forEach(id => { if (layout.elements[id]) applyEl(id); }); }

  function build() {
    const ov = el('div'); ov.id = 'calib-overlay';
    ov.appendChild(el('div', 'calib-hint', 'CALIBRATION · touche un élément à régler · le panneau apparaît du côté opposé'));
    const outline = el('div', 'calib-sel-outline'); outline.id = 'calib-outline'; outline.style.display = 'none';
    ov.appendChild(outline);
    ov.appendChild(buildPanel());
    document.getElementById('viewport').appendChild(ov);
    built = true;
  }

  function buildPanel() {
    const p = el('div', 'calib-panel'); p.id = 'calib-panel';
    p.appendChild(el('div', 'calib-name', '—')).id = 'calib-name';
    p.appendChild(el('div', 'calib-readout', '')).id = 'calib-readout';
    // pad directionnel 3×3
    const pad = el('div', 'calib-pad');
    const mk = (txt, dx, dy) => { const b = el('button', null, txt); holdable(b, () => move(dx, dy)); return b; };
    pad.appendChild(el('button', 'spacer')); pad.appendChild(mk('↑', 0, -1)); pad.appendChild(el('button', 'spacer'));
    pad.appendChild(mk('←', -1, 0)); pad.appendChild(el('button', 'spacer')); pad.appendChild(mk('→', 1, 0));
    pad.appendChild(el('button', 'spacer')); pad.appendChild(mk('↓', 0, 1)); pad.appendChild(el('button', 'spacer'));
    p.appendChild(pad);
    // taille
    const size = el('div', 'calib-size');
    const minus = el('button', null, '−'); holdable(minus, () => resize(-1));
    const plus = el('button', null, '＋'); holdable(plus, () => resize(1));
    const lbl = el('div', 'lbl', 'TAILLE');
    size.appendChild(minus); size.appendChild(lbl); size.appendChild(plus);
    p.appendChild(size);
    // pas
    const stepRow = el('div', 'calib-step');
    const s1 = el('button', 'active', 'PAS 1 px'); s1.onclick = () => setStep(1, s1, s10);
    const s10 = el('button', null, 'PAS 10 px'); s10.onclick = () => setStep(10, s10, s1);
    stepRow.appendChild(s1); stepRow.appendChild(s10); p.appendChild(stepRow);
    // actions
    const act = el('div', 'calib-actions');
    const next = el('button', 'calib-next', 'Élément suivant ▸'); next.onclick = selectNext;
    const save = el('button', 'calib-save', '✓ Enregistrer'); save.onclick = saveAndExit;
    act.appendChild(next); act.appendChild(save); p.appendChild(act);
    return p;
  }

  /* appui maintenu = répétition accélérée */
  function holdable(btn, fn) {
    const start = (e) => { e.preventDefault(); fn(); clearTimers(); holdTimer = setTimeout(() => { let d = 90; holdInt = setInterval(fn, d); }, 320); };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', clearTimers);
    btn.addEventListener('pointerleave', clearTimers);
    btn.addEventListener('pointercancel', clearTimers);
  }
  function clearTimers() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } if (holdInt) { clearInterval(holdInt); holdInt = null; } }

  function setStep(v, on, off) { step = v; on.classList.add('active'); off.classList.remove('active'); }

  function move(dx, dy) {
    if (!sel) return; const s = layout.elements[sel];
    s.x = Math.round(s.x + dx * step); s.y = Math.round(s.y + dy * step);
    applyEl(sel); updateOutline(); updateReadout();
  }
  function resize(dir) {
    if (!sel) return; const s = layout.elements[sel];
    const inc = step === 1 ? 0.01 : 0.05;
    s.scale = Math.max(0.2, +(s.scale + dir * inc).toFixed(3));
    applyEl(sel); updateOutline(); updateReadout();
  }

  function select(id) {
    sel = id;
    const s = layout.elements[id];
    document.getElementById('calib-name').textContent = (document.getElementById(id)?.dataset.name) || id;
    updateOutline(); updateReadout();
    // panneau du côté OPPOSÉ : centre de l'élément à gauche → panneau à droite
    const cx = s.x + (s.baseW || 0) * s.scale / 2;
    const panel = document.getElementById('calib-panel');
    panel.classList.remove('left', 'right');
    panel.classList.add(cx < VW / 2 ? 'right' : 'left');
  }
  function selectNext() {
    const present = IDS.filter(id => layout.elements[id]);
    const i = present.indexOf(sel);
    select(present[(i + 1) % present.length]);
  }
  function updateOutline() {
    const s = layout.elements[sel]; const o = document.getElementById('calib-outline');
    o.style.display = 'block';
    o.style.left = s.x + 'px'; o.style.top = s.y + 'px';
    o.style.width = (s.baseW * s.scale) + 'px'; o.style.height = (s.baseH * s.scale) + 'px';
  }
  function updateReadout() {
    const s = layout.elements[sel];
    const w = Math.round(s.baseW * s.scale), h = Math.round(s.baseH * s.scale);
    const mmW = (w * MM_PER_PX).toFixed(1), mmH = (h * MM_PER_PX).toFixed(1);
    document.getElementById('calib-readout').innerHTML =
      `X ${Math.round(s.x)} · Y ${Math.round(s.y)} px<br>${w}×${h} px · ${mmW}×${mmH} mm · ${Math.round(s.scale * 100)}%`;
  }

  /* clics sur les éléments réels → sélection croisée */
  function onElClick(e) { const elm = e.currentTarget; select(elm.id); }
  function bindElements(on) {
    IDS.forEach(id => { const e = document.getElementById(id); if (!e) return; if (on) e.addEventListener('click', onElClick); else e.removeEventListener('click', onElClick); });
  }

  /* clavier/pavé */
  function onKey(e) {
    if (!document.getElementById('calib-overlay')?.classList.contains('open')) return;
    if (e.key === 'ArrowUp') move(0, -1); else if (e.key === 'ArrowDown') move(0, 1);
    else if (e.key === 'ArrowLeft') move(-1, 0); else if (e.key === 'ArrowRight') move(1, 0);
    else if (e.key === '+' || e.key === '=') resize(1); else if (e.key === '-') resize(-1);
    else if (e.key === 'Tab') { e.preventDefault(); selectNext(); }
    else if (e.key === 'Enter') saveAndExit(); else if (e.key === 'Escape') exit(true);
    else return;
    e.preventDefault();
  }

  async function open() {
    if (!built) { build(); document.addEventListener('keydown', onKey); }
    // base = layout courant (ou serveur), en BRUT
    layout = App.layout ? clone(App.layout) : await (await fetch('/api/layout')).json();
    document.body.classList.add('calibrating');
    document.getElementById('calib-overlay').classList.add('open');
    applyAll();           // affiche les positions brutes (sans inversion)
    bindElements(true);
    select('el-speedo');
  }

  function exit(restore) {
    clearTimers();
    bindElements(false);
    document.getElementById('calib-overlay').classList.remove('open');
    document.body.classList.remove('calibrating');
    if (restore && window.App) App.reloadLayout(); // restaure l'affichage (inversion incluse)
  }

  async function saveAndExit() {
    try {
      await fetch('/api/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ elements: layout.elements }) });
    } catch (e) { console.error('save layout', e); }
    exit(true);
  }

  return { open, exit };
})();
window.Calibration = Calibration; // exposé explicitement (const ne s'attache pas à window)

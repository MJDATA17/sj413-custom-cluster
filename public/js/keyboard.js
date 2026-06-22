/**
 * keyboard.js — clavier circulaire AZERTY + autocomplétion. Repris du design 03,
 * GÉNÉRALISÉ : réutilisable pour la nav (géocodage) ET la recherche Spotify.
 *
 * Keyboard.open(config) où config = {
 *   header, placeholder,
 *   fetch(text) -> Promise<[{ iconHtml, name, sub, right, onPick }]>,
 *   onValidate(text)   // optionnel ; défaut = onPick du 1er résultat
 * }
 * Sans argument, ouvre la config NAV (destination → géocodage).
 */
const Keyboard = (() => {
  let text = '', selIdx = 0, mode = 'alpha';
  let items = [], cfg = null, fetchSeq = 0;

  const LAYOUT_ALPHA = [
    ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
    ['W', 'X', 'C', 'V', 'B', 'N', '-', "'"]
  ];
  const LAYOUT_NUM = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['/', '-', "'", ',', '.', '°', 'bis', 'ter']
  ];

  function iconFor(t) {
    if (t === 'fav') return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 L14.5 9 L21 9.5 L16 14 L17.5 20.5 L12 17 L6.5 20.5 L8 14 L3 9.5 L9.5 9 Z" stroke="#02BFA6" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    if (t === 'poi') return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2 C8 2 5 5 5 9 C5 14 12 22 12 22 C12 22 19 14 19 9 C19 5 16 2 12 2 Z" stroke="#02BFA6" stroke-width="1.5"/><circle cx="12" cy="9" r="2.5" stroke="#02BFA6" stroke-width="1.5"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M3 21 L3 9 L12 3 L21 9 L21 21" stroke="#02BFA6" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 21 L9 14 L15 14 L15 21" stroke="#02BFA6" stroke-width="1.5"/></svg>';
  }

  /* Config par défaut : navigation (géocodage Nominatim/favoris via /api/geocode) */
  const NAV_CONFIG = {
    header: 'Où allons-nous ?', placeholder: 'Destination…',
    async fetch(t) {
      const pos = (typeof Nav !== 'undefined' && Nav.getPosition) ? Nav.getPosition() : null;
      const qs = '/api/geocode?q=' + encodeURIComponent(t.trim()) + (pos ? `&lat=${pos.lat}&lon=${pos.lon}` : '');
      const r = await fetch(qs);
      const j = await r.json();
      return (j.results || []).map(p => ({
        iconHtml: iconFor(p.type), name: p.name, sub: p.addr, right: p.dist || '',
        onPick: () => { close(); if (p.lat != null && Nav.navigateTo) Nav.navigateTo(p); }
      }));
    }
  };

  function build() {
    const c = document.getElementById('kb-keys'); c.innerHTML = '';
    const layout = mode === 'alpha' ? LAYOUT_ALPHA : LAYOUT_NUM;
    layout.forEach(row => {
      const r = document.createElement('div'); r.className = 'kb-row';
      row.forEach(k => {
        const key = document.createElement('div');
        key.className = 'key' + (k.length > 1 ? ' wide' : '');
        key.textContent = k; key.onclick = () => type(k);
        r.appendChild(key);
      });
      c.appendChild(r);
    });
    const r = document.createElement('div'); r.className = 'kb-row';
    const tg = document.createElement('div'); tg.className = 'key wide action';
    tg.textContent = mode === 'alpha' ? '123' : 'ABC';
    tg.onclick = () => { mode = mode === 'alpha' ? 'num' : 'alpha'; build(); };
    const bs = document.createElement('div'); bs.className = 'key action';
    bs.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M9 6 L3 12 L9 18 L21 18 L21 6 Z" stroke="#02BFA6" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 10 L17 14 M17 10 L13 14" stroke="#02BFA6" stroke-width="1.8" stroke-linecap="round"/></svg>';
    bs.onclick = backspace;
    const sp = document.createElement('div'); sp.className = 'key space'; sp.textContent = '␣'; sp.onclick = () => type(' ');
    const go = document.createElement('div'); go.className = 'key go';
    go.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12 L20 12 M14 6 L20 12 L14 18" stroke="#04121a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    go.onclick = validate;
    r.appendChild(tg); r.appendChild(bs); r.appendChild(sp); r.appendChild(go);
    c.appendChild(r);
  }

  function type(ch) { text += ch; refresh(); }
  function backspace() { text = text.slice(0, -1); refresh(); }

  async function refresh() {
    const inp = document.getElementById('kb-input');
    if (text) { inp.classList.remove('empty'); inp.innerHTML = text + '<span class="kb-caret"></span>'; }
    else { inp.classList.add('empty'); inp.innerHTML = '<span class="kb-caret"></span>'; }
    const seq = ++fetchSeq;
    let res = [];
    try { res = await cfg.fetch(text); } catch { res = []; }
    if (seq !== fetchSeq) return; // réponse périmée
    items = res; renderSuggest();
  }

  function renderSuggest() {
    if (selIdx >= items.length) selIdx = 0;
    const c = document.getElementById('kb-suggest'); c.innerHTML = '';
    items.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'suggest-item' + (i === selIdx ? ' sel' : '');
      item.innerHTML = `<div class="suggest-icon">${p.iconHtml || ''}</div>
        <div class="suggest-text"><div class="suggest-name">${esc(p.name)}</div><div class="suggest-addr">${esc(p.sub || '')}</div></div>
        <div class="suggest-dist">${esc(p.right || '')}</div>`;
      item.onclick = () => { selIdx = i; if (p.onPick) p.onPick(); };
      c.appendChild(item);
    });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function validate() {
    if (cfg.onValidate) { cfg.onValidate(text); return; }
    const pick = items[selIdx] || items[0];
    if (pick && pick.onPick) pick.onPick();
  }

  function open(config) {
    cfg = config || NAV_CONFIG;
    text = ''; selIdx = 0; items = [];
    // le clavier s'affiche dans le cercle de son contexte : nav (droite) par défaut,
    // ou un hôte fourni (ex. compteur de gauche pour la recherche Spotify)
    const kb = document.getElementById('kb-screen');
    const host = (cfg.host && document.querySelector(cfg.host)) || document.querySelector('.nav-circle');
    if (host && kb.parentElement !== host) host.appendChild(kb);
    document.getElementById('kb-header').textContent = cfg.header || 'Rechercher…';
    document.getElementById('kb-input').dataset.ph = cfg.placeholder || 'Saisir…';
    kb.classList.add('active');
    refresh();
  }
  function close() { document.getElementById('kb-screen').classList.remove('active'); }
  function isOpen() { return document.getElementById('kb-screen').classList.contains('active'); }

  /* clavier physique (test PC) — actif seulement quand l'overlay est ouvert */
  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key.length === 1 && /[a-zA-Z0-9\- ',./°]/.test(e.key)) { type(e.key.toUpperCase()); e.preventDefault(); }
    else if (e.key === 'Backspace') { backspace(); e.preventDefault(); }
    else if (e.key === 'Enter') { validate(); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { selIdx = (selIdx + 1) % Math.max(1, items.length); renderSuggest(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selIdx = (selIdx - 1 + items.length) % Math.max(1, items.length); renderSuggest(); e.preventDefault(); }
  });

  function init() { build(); }
  return { init, open, close, isOpen, iconFor };
})();

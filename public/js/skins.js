/**
 * skins.js — chargement/application des skins (thèmes visuels complets).
 *
 * Un skin ne change que le VISUEL : palette (variables CSS), polices, et un
 * `render_style` global ('mjdata' | 'tva_crt') que cluster.js/nav.js lisent pour
 * changer la FAÇON de dessiner (cadran moderne vs barregraphe CRT ambre).
 * La logique (données, nav, capteurs) reste identique.
 *
 * Skin actif persistant côté serveur (config/settings.json), pas de localStorage.
 */
const Skins = (() => {
  let list = [];          // skins disponibles (depuis /api/skins)
  let active = null;      // skin actif (objet)
  const listeners = [];

  function fontLink(url) {
    if (!url) return;
    if ([...document.querySelectorAll('link[data-skin-font]')].some(l => l.href === url)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; l.dataset.skinFont = '1';
    document.head.appendChild(l);
  }

  function apply(skin) {
    if (!skin) return;
    active = skin;
    // polices
    fontLink(skin.fonts && skin.fonts.import);
    const root = document.documentElement.style;
    if (skin.fonts) {
      root.setProperty('--font-display', skin.fonts.display || 'Montserrat, sans-serif');
      root.setProperty('--font-mono', skin.fonts.mono || 'Geist Mono, monospace');
    }
    // variables de couleur
    for (const [k, v] of Object.entries(skin.vars || {})) root.setProperty(k, v);
    // classe de skin sur <body> (skin-mjdata / skin-tva)
    document.body.className = document.body.className.replace(/\bskin-\S+/g, '').trim();
    document.body.classList.add('skin-' + skin.id);
    document.body.classList.toggle('crt', !!skin.crt);
    // render_style global lu par cluster.js / nav.js
    window.RENDER_STYLE = skin.render_style || 'mjdata';
    window.SKIN = skin;
    listeners.forEach(fn => { try { fn(skin); } catch (e) { console.error(e); } });
  }

  async function load() {
    try { list = (await (await fetch('/api/skins')).json()).skins || []; } catch { list = []; }
    let activeId = 'mjdata';
    try { activeId = (await (await fetch('/api/settings')).json()).activeSkin || 'mjdata'; } catch {}
    const skin = list.find(s => s.id === activeId) || list.find(s => s.id === 'mjdata') || list[0];
    if (skin) apply(skin);
    return skin;
  }

  async function setActive(id) {
    const skin = list.find(s => s.id === id);
    if (!skin) return;
    apply(skin);
    try { await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeSkin: id }) }); } catch {}
  }

  return {
    load, setActive, apply,
    onChange(fn) { listeners.push(fn); if (active) fn(active); },
    get list() { return list; },
    get active() { return active; },
    color(name, fallback) { return (active && active.canvas && active.canvas[name]) || fallback; }
  };
})();

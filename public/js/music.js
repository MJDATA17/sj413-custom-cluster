/**
 * music.js — lecteur Spotify : mini-bandeau + vues plein écran
 * (Lecture / Listes / Recherche / File). UI reprise et étendue du design 02.
 *
 * Deux modes, transparents pour l'UI :
 *  - RÉEL : Spotify configuré + connecté → tout passe par le serveur (/spotify/*),
 *    le token reste côté serveur. Polling /spotify/now ~1 s.
 *  - DÉMO : pas de clés ou pas connecté → données factices, bandeau "Connecter".
 */
const Music = (() => {
  /* ── démo ── */
  const DEMO = [
    { title: 'Midnight City', artist: 'M83', durationMs: 243000, grad: ['#8B5CF6', '#02BFA6'] },
    { title: 'Nightcall', artist: 'Kavinsky', durationMs: 258000, grad: ['#FF4444', '#8B5CF6'] },
    { title: 'Instant Crush', artist: 'Daft Punk', durationMs: 337000, grad: ['#02BFA6', '#4D9FFF'] },
    { title: 'A Real Hero', artist: 'College', durationMs: 264000, grad: ['#BF5FFF', '#02BFA6'] }
  ];
  let demoIdx = 0;

  let real = false;            // Spotify connecté ?
  let status = { configured: false, authenticated: false, premium: false };
  let now = { track: null, progressMs: 0, playing: true, shuffle: false, repeat: 'off', volume: null };
  let pollT = null, playlistsLoaded = false;

  /* ── helpers ── */
  const $ = id => document.getElementById(id);
  function fmt(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function gradCover(grad, size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); const lg = g.createLinearGradient(0, 0, size, size);
    lg.addColorStop(0, grad[0]); lg.addColorStop(1, grad[1]); g.fillStyle = lg; g.fillRect(0, 0, size, size);
    g.globalAlpha = 0.15; g.strokeStyle = '#fff';
    for (let r = size * 0.1; r < size * 0.5; r += size * 0.08) { g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.stroke(); }
    return c.toDataURL();
  }
  function noteIcon() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke="#02BFA6" stroke-width="1.6"/><circle cx="6" cy="18" r="3" stroke="#02BFA6" stroke-width="1.6"/><circle cx="18" cy="16" r="3" stroke="#02BFA6" stroke-width="1.6"/></svg>'; }

  async function jget(url) { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw j; return j; }
  async function jpost(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw j; return j; }

  /* ── bandeau état/erreur ── */
  let bannerT = null;
  function banner(html, isErr) {
    const b = $('sp-banner'); b.innerHTML = html; b.classList.toggle('err', !!isErr); b.classList.add('show');
    if (bannerT) clearTimeout(bannerT);
    if (isErr) bannerT = setTimeout(() => b.classList.remove('show'), 4000);
  }
  function hideBanner() { $('sp-banner').classList.remove('show'); }
  function showStatusBanner() {
    if (real) { if (!status.premium) banner('Compte non-Premium : lecture limitée'); else hideBanner(); return; }
    if (status.configured && !status.authenticated)
      banner("Spotify non connecté <button onclick=\"location.href='/spotify/login'\">Connecter</button>");
    else
      banner('Mode démo — Spotify non configuré (docs/SPOTIFY.md)');
  }
  function errToBanner(e) {
    const msg = (e && e.error) ? e.error : 'Erreur Spotify';
    if (e && e.loginUrl) { real = false; banner(esc(msg) + " <button onclick=\"location.href='/spotify/login'\">Connecter</button>", true); }
    else banner(esc(msg), true);
  }

  /* ════ Rendu lecteur ════ */
  function setCover(url) {
    $('mf-cover-img').src = url; $('mini-cover-img').src = url;
    $('music-ambient').style.background = `url(${url}) center/cover`;
  }
  function renderPlayer() {
    const t = now.track;
    if (!t) return;
    if (t.cover) setCover(t.cover);
    else if (t.grad) setCover(gradCover(t.grad, 300));
    $('mf-title').textContent = t.title; $('mf-artist').textContent = t.artist;
    $('mini-title').textContent = t.title; $('mini-artist').textContent = t.artist;
    $('mf-tot').textContent = fmt(t.durationMs);
    const pct = t.durationMs ? Math.min(100, now.progressMs / t.durationMs * 100) : 0;
    $('mf-bar-fill').style.width = pct + '%';
    $('mf-cur').textContent = fmt(now.progressMs);
    $('play-icon').innerHTML = now.playing ? '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    document.querySelectorAll('.mini-eq span').forEach(s => s.style.animationPlayState = now.playing ? 'running' : 'paused');
    document.querySelector('.mini-cover').style.animationPlayState = now.playing ? 'running' : 'paused';
    $('btn-shuffle').classList.toggle('on', !!now.shuffle);
    $('btn-repeat').classList.toggle('on', now.repeat && now.repeat !== 'off');
  }

  /* ════ Polling now-playing (réel) ════ */
  async function poll() {
    try {
      const n = await jget('/spotify/now');
      if (n.track) { now = { track: n.track, progressMs: n.progressMs || 0, playing: n.playing, shuffle: n.shuffle, repeat: n.repeat, volume: n.volume }; renderPlayer(); }
      else { banner('Aucun titre en lecture — lance un morceau'); }
    } catch (e) { errToBanner(e); }
  }
  function startPoll() { stopPoll(); poll(); pollT = setInterval(poll, 1000); }
  function stopPoll() { if (pollT) { clearInterval(pollT); pollT = null; } }

  /* ════ Démo : progression locale ════ */
  function loadDemo(i) {
    demoIdx = (i + DEMO.length) % DEMO.length;
    const d = DEMO[demoIdx];
    now = { track: { title: d.title, artist: d.artist, durationMs: d.durationMs, grad: d.grad }, progressMs: 0, playing: now.playing, shuffle: now.shuffle, repeat: now.repeat };
    renderPlayer();
  }
  function demoTick() {
    if (real || !now.playing || !now.track) return;
    now.progressMs += 1000;
    if (now.progressMs >= now.track.durationMs) loadDemo(demoIdx + 1);
    else renderPlayer();
  }

  /* ════ Contrôles ════ */
  async function control(action, value) {
    if (!real) return; // démo gère localement
    try { await jpost('/spotify/control', { action, value }); setTimeout(poll, 200); }
    catch (e) { errToBanner(e); }
  }
  function toggle() {
    if (real) { now.playing = !now.playing; renderPlayer(); control(now.playing ? 'play' : 'pause'); }
    else { now.playing = !now.playing; renderPlayer(); }
  }
  function next() { if (real) control('next'); else loadDemo(demoIdx + 1); }
  function prev() { if (real) control('previous'); else { if (now.progressMs > 3000) { now.progressMs = 0; renderPlayer(); } else loadDemo(demoIdx - 1); } }
  function toggleShuffle() { now.shuffle = !now.shuffle; renderPlayer(); control('shuffle', now.shuffle); }
  function cycleRepeat() { const order = ['off', 'context', 'track']; now.repeat = order[(order.indexOf(now.repeat) + 1) % 3]; renderPlayer(); control('repeat', now.repeat); }
  function seekFromEvent(e) {
    const bar = $('mf-bar'); const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (!now.track) return;
    now.progressMs = pct * now.track.durationMs; renderPlayer();
    if (real) control('seek', Math.round(now.progressMs));
  }

  /* ════ Lancer un titre / contexte ════ */
  async function playTrack(t) {
    if (real) { try { await jpost('/spotify/play', { uri: t.uri }); setTimeout(poll, 300); } catch (e) { errToBanner(e); } }
    else { now = { track: { title: t.title, artist: t.artist, durationMs: t.durationMs || 200000, cover: t.cover, grad: t.grad || ['#8B5CF6', '#02BFA6'] }, progressMs: 0, playing: true, shuffle: now.shuffle, repeat: now.repeat }; renderPlayer(); }
    show('sp-player'); // après un clic sur un titre, on revient toujours au lecteur
  }
  // joue une LISTE de titres à partir de l'index i → vraie file, "suivant" fonctionne
  async function playFromList(list, i) {
    if (real) {
      try { await jpost('/spotify/play', { uris: list.map(t => t.uri), offset: { position: i } }); setTimeout(poll, 350); }
      catch (e) { errToBanner(e); }
      show('sp-player');
    } else { playTrack(list[i]); }
  }
  async function playContext(uri) {
    if (real) { try { await jpost('/spotify/play', { context_uri: uri }); setTimeout(poll, 400); show('sp-player'); } catch (e) { errToBanner(e); } }
    else show('sp-player');
  }
  async function playInContext(contextUri, t) {
    if (real) { try { await jpost('/spotify/play', { context_uri: contextUri, offset: { uri: t.uri } }); setTimeout(poll, 350); show('sp-player'); } catch (e) { errToBanner(e); } }
    else { playTrack(t); }
  }

  /* ════ Lignes & cartes ════ */
  function trackRow(t, onClick, opts = {}) {
    const row = document.createElement('div'); row.className = 'sp-row' + (opts.playing ? ' playing' : '');
    const cover = t.cover ? `<img class="sp-cover" src="${esc(t.cover)}">` : `<div class="sp-cover"></div>`;
    row.innerHTML = `${cover}<div class="sp-meta"><div class="sp-name">${esc(t.title)}</div><div class="sp-sub">${esc(t.artist)}</div></div>${t.durationMs ? `<div class="sp-dur">${fmt(t.durationMs)}</div>` : ''}`;
    if (onClick) row.onclick = onClick;
    return row;
  }
  function emptyMsg(parent, msg) { parent.innerHTML = `<div class="sp-empty">${esc(msg)}</div>`; }

  /* ════ Vue LISTES (playlists → titres) ════ */
  async function loadPlaylists() {
    const body = $('sp-lists-body'); $('sp-lists-title').textContent = 'Mes playlists'; $('sp-lists-back').classList.add('hidden');
    if (!real) { emptyMsg(body, status.configured ? 'Connecte Spotify pour voir tes playlists' : 'Playlists indisponibles en démo'); return; }
    body.innerHTML = '<div class="sp-empty">Chargement…</div>';
    try {
      const j = await jget('/spotify/playlists');
      if (!j.items.length) return emptyMsg(body, 'Aucune playlist');
      const grid = document.createElement('div'); grid.className = 'sp-grid';
      // carte "Titres likés" (cet endpoint fonctionne → titres jouables un par un)
      const liked = document.createElement('div'); liked.className = 'sp-card';
      liked.innerHTML = `<div class="sp-card-img sp-card-liked"><svg viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7-4.6-9.3-8.2C1 9.9 2.3 6.5 5.5 6.1c1.9-.2 3.4 1 4.5 2.4C11.1 7.1 12.6 5.9 14.5 6.1c3.2.4 4.5 3.8 2.8 6.7C19 16.4 12 21 12 21z"/></svg></div><div class="sp-card-name">Titres likés</div>`;
      liked.onclick = openLiked;
      grid.appendChild(liked);
      j.items.forEach(p => {
        const card = document.createElement('div'); card.className = 'sp-card';
        card.innerHTML = `${p.cover ? `<img class="sp-card-img" src="${esc(p.cover)}">` : '<div class="sp-card-img"></div>'}<div class="sp-card-name">${esc(p.name)}</div>`;
        card.onclick = () => openPlaylist(p);
        grid.appendChild(card);
      });
      body.innerHTML = ''; body.appendChild(grid);
    } catch (e) { emptyMsg(body, 'Erreur de chargement'); errToBanner(e); }
  }
  // Spotify bloque la lecture des titres d'une playlist pour cette app (403) →
  // taper une playlist la LANCE directement (context_uri). L'onglet « File » montre
  // ensuite les titres à venir.
  async function openPlaylist(p) {
    banner(`Lecture de « ${p.name} »…`);
    await playContext(p.uri);
  }
  // Titres likés : cet endpoint fonctionne → liste de titres jouables un par un
  async function openLiked() {
    const body = $('sp-lists-body'); $('sp-lists-title').textContent = 'Titres likés'; $('sp-lists-back').classList.remove('hidden');
    body.innerHTML = '<div class="sp-empty">Chargement…</div>';
    try {
      const j = await jget('/spotify/library/tracks');
      if (!j.items.length) return emptyMsg(body, 'Aucun titre liké');
      body.innerHTML = '';
      j.items.forEach((t, i) => body.appendChild(trackRow(t, () => playFromList(j.items, i))));
    } catch (e) { emptyMsg(body, 'Erreur de chargement'); errToBanner(e); }
  }
  function backToPlaylists() { loadPlaylists(); }

  /* ════ Vue RECHERCHE ════ */
  function renderSearchBody(tracks) {
    const body = $('sp-search-body');
    if (!tracks.length) { emptyMsg(body, 'Aucun résultat'); return; }
    body.innerHTML = '';
    tracks.forEach((t, i) => body.appendChild(trackRow(t, () => playFromList(tracks, i))));
  }
  function openSearchKeyboard() {
    Keyboard.open({
      header: 'Rechercher sur Spotify', placeholder: 'Titre, artiste, album…',
      host: '#el-speedo .el-content', // Spotify est sur le compteur → clavier à gauche
      fetch: async (text) => {
        $('sp-search-q').textContent = text || 'Rechercher un titre, artiste…';
        if (!text.trim()) { renderSearchBody([]); return []; }
        let tracks = [];
        if (real) { try { tracks = (await jget('/spotify/search?q=' + encodeURIComponent(text))).tracks || []; } catch (e) { errToBanner(e); } }
        else { const q = text.toLowerCase(); tracks = DEMO.filter(d => (d.title + ' ' + d.artist).toLowerCase().includes(q)).map(d => ({ title: d.title, artist: d.artist, durationMs: d.durationMs, grad: d.grad })); }
        renderSearchBody(tracks);
        return tracks.map((t, i) => ({ iconHtml: noteIcon(), name: t.title, sub: t.artist, right: t.durationMs ? fmt(t.durationMs) : '', onPick: () => { Keyboard.close(); playFromList(tracks, i); } }));
      }
    });
  }

  /* ════ Vue FILE ════ */
  async function loadQueue() {
    const body = $('sp-queue-body');
    if (!real) {
      body.innerHTML = '';
      DEMO.forEach((d, i) => { if (i === demoIdx) return; body.appendChild(trackRow({ title: d.title, artist: d.artist, durationMs: d.durationMs }, null)); });
      if (!body.children.length) emptyMsg(body, "File vide");
      return;
    }
    body.innerHTML = '<div class="sp-empty">Chargement…</div>';
    try {
      const j = await jget('/spotify/queue');
      body.innerHTML = '';
      if (j.current) body.appendChild(trackRow(j.current, null, { playing: true }));
      (j.items || []).forEach(t => body.appendChild(trackRow(t, null)));
      if (!body.children.length) emptyMsg(body, 'File vide');
    } catch (e) { emptyMsg(body, 'File indisponible'); errToBanner(e); }
  }

  /* ════ Onglets / vues ════ */
  function show(viewId) {
    document.querySelectorAll('.sp-view').forEach(v => v.classList.toggle('active', v.id === viewId));
    document.querySelectorAll('.mf-tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
    if (viewId === 'sp-lists' && !playlistsLoaded) { playlistsLoaded = true; loadPlaylists(); }
    if (viewId === 'sp-queue') loadQueue();
  }

  /* ════ Ouverture/fermeture overlay ════ */
  function open() { show('sp-player'); $('music-full').classList.add('active'); syncStrip(); showStatusBanner(); if (real) poll(); }
  function close() { $('music-full').classList.remove('active'); }
  function syncStrip() {
    const d = Nav.state.dist;
    const e = $('mns-dist'); if (e) e.textContent = d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m';
  }

  /* ════ Init ════ */
  async function init() {
    try { status = await jget('/spotify/status'); } catch { status = { configured: false, authenticated: false }; }
    real = !!(status.configured && status.authenticated);

    $('mf-bar').addEventListener('click', seekFromEvent);

    if (real) { startPoll(); }
    else { loadDemo(0); }

    // progression démo + sync bandeau nav (1 Hz)
    setInterval(() => { demoTick(); syncStrip(); }, 1000);

    // Au boot/réveil, Spotify (réseau + librespot) peut ne pas être prêt au 1er check :
    // on re-vérifie le statut tant qu'on n'est pas connecté, puis on bascule en réel.
    if (!real) {
      const recheck = setInterval(async () => {
        try {
          const s = await jget('/spotify/status');
          if (s.configured && s.authenticated) {
            status = s; real = true; clearInterval(recheck); hideBanner(); startPoll();
          }
        } catch {}
      }, 8000);
    }

    // message de retour après connexion OAuth
    if (location.search.includes('spotify=connected')) banner('Spotify connecté ✓');
  }

  return { init, open, close, toggle, next, prev, toggleShuffle, cycleRepeat, show, openSearchKeyboard, backToPlaylists };
})();

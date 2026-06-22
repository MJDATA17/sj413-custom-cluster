/**
 * server/spotify.js — intégration Spotify SOIGNÉE (jalon 5).
 *
 * - OAuth 2.0 PKCE (pas de client secret). Flow lancé une fois au setup.
 * - refresh_token persisté (config/spotify-tokens.json) → survit aux reboots.
 * - access_token rafraîchi automatiquement. LE TOKEN NE QUITTE JAMAIS LE SERVEUR :
 *   le front passe uniquement par ces endpoints.
 * - Proxy Web API : now-playing, contrôle, playlists, recherche, bibliothèque, file.
 * - Lecture audio réelle = librespot (Spotify Connect) sur la cible Debian — ce
 *   serveur sait transférer la lecture vers ce device s'il n'y en a pas d'actif.
 *
 * Tant que SPOTIFY_CLIENT_ID est vide (.env), les endpoints renvoient un état
 * "non configuré" et le front tourne en démo.
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/spotify/callback';
const TOKENS_PATH = path.join(__dirname, '..', 'config', 'spotify-tokens.json');
const DEVICE_NAME = process.env.SPOTIFY_DEVICE_NAME || 'MJ Data SJ413';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-recently-played',
  'user-read-private',
  'streaming'
].join(' ');

// Où renvoyer le navigateur après le callback https (vers l'app http, pour garder le bus ws)
const APP_URL = process.env.APP_URL || '';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

const configured = () => Boolean(CLIENT_ID);

/* ─────────── Persistance des tokens ─────────── */
let tokens = null; // { access_token, refresh_token, expires_at, scope }
function loadTokens() {
  try { tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')); }
  catch { tokens = null; }
}
function saveTokens(t) {
  tokens = t;
  try { fs.writeFileSync(TOKENS_PATH, JSON.stringify(t, null, 2)); }
  catch (e) { console.error('[spotify] échec écriture tokens:', e.message); }
}
loadTokens();

/* ─────────── PKCE ─────────── */
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let pkceVerifier = null;
let oauthState = null;

/* ─────────── Gestion access_token (refresh auto) ─────────── */
async function refreshAccessToken() {
  if (!tokens || !tokens.refresh_token) throw httpErr(401, 'Non connecté à Spotify');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: CLIENT_ID
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(502, 'Échec du rafraîchissement du token Spotify', j);
  saveTokens({
    access_token: j.access_token,
    refresh_token: j.refresh_token || tokens.refresh_token, // Spotify ne le renvoie pas toujours
    expires_at: Date.now() + (j.expires_in - 60) * 1000,
    scope: j.scope || tokens.scope
  });
  return tokens.access_token;
}
async function getAccessToken() {
  if (!tokens || !tokens.access_token) throw httpErr(401, 'Non connecté à Spotify');
  if (Date.now() >= tokens.expires_at) return refreshAccessToken();
  return tokens.access_token;
}

/* ─────────── Helper requêtes Web API ─────────── */
function httpErr(status, message, detail) { const e = new Error(message); e.status = status; e.detail = detail; return e; }

async function api(pathname, { method = 'GET', query, body, retry = true } = {}) {
  const token = await getAccessToken();
  let url = API + pathname;
  if (query) { const qs = new URLSearchParams(query).toString(); if (qs) url += '?' + qs; }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw httpErr(503, 'Réseau indisponible (tethering ?)', e.message);
  }
  if (res.status === 401 && retry) { await refreshAccessToken(); return api(pathname, { method, query, body, retry: false }); }
  if (res.status === 204) return null; // pas de contenu (ex: aucun device actif)
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 403) throw httpErr(403, 'Action refusée par Spotify (403)', data);
    if (res.status === 404) throw httpErr(404, 'Aucun appareil de lecture actif', data);
    if (res.status === 429) throw httpErr(429, 'Trop de requêtes Spotify, réessaie', data);
    throw httpErr(res.status, (data && data.error && data.error.message) || 'Erreur Spotify', data);
  }
  return data;
}
function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }

/* ─────────── Normalisation ─────────── */
const img = (images) => (images && images.length ? images[0].url : null);
function track(t) {
  if (!t) return null;
  return {
    id: t.id, uri: t.uri, title: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    album: t.album ? t.album.name : '',
    cover: t.album ? img(t.album.images) : null,
    durationMs: t.duration_ms
  };
}

/* ════════════════════ ROUTES ════════════════════ */

/* Statut consommé par le front au boot pour choisir réel vs démo */
router.get('/status', async (_req, res) => {
  if (!configured()) return res.json({ configured: false, authenticated: false, reason: 'SPOTIFY_CLIENT_ID absent (.env)' });
  if (!tokens) return res.json({ configured: true, authenticated: false, loginUrl: '/spotify/login' });
  try {
    const me = await api('/me');
    res.json({ configured: true, authenticated: true, premium: me.product === 'premium', user: me.display_name, deviceName: DEVICE_NAME });
  } catch (e) {
    res.json({ configured: true, authenticated: false, loginUrl: '/spotify/login', reason: e.message });
  }
});

/* ── OAuth PKCE ── */
router.get('/login', (_req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Spotify non configuré', hint: 'Renseigne SPOTIFY_CLIENT_ID dans .env — voir docs/SPOTIFY.md' });
  pkceVerifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(pkceVerifier).digest());
  oauthState = b64url(crypto.randomBytes(12));
  const q = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256', code_challenge: challenge, state: oauthState, scope: SCOPES
  });
  res.redirect(AUTH_URL + '?' + q.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send('Autorisation refusée : ' + error);
  if (!code || state !== oauthState || !pkceVerifier) return res.status(400).send('État OAuth invalide, relance /spotify/login');
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: String(code), redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, code_verifier: pkceVerifier
    });
    const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).send('Échec échange token : ' + JSON.stringify(j));
    saveTokens({
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope
    });
    pkceVerifier = null; oauthState = null;
    res.redirect(APP_URL + '/?spotify=connected');
  } catch (e) {
    res.status(500).send('Erreur callback Spotify : ' + e.message);
  }
});

router.post('/logout', (_req, res) => {
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
  tokens = null;
  res.json({ ok: true });
});

/* ── Lecture en cours (polling ~1s côté front) ── */
router.get('/now', async (_req, res, next) => {
  try {
    const p = await api('/me/player');
    if (!p) return res.json({ playing: false, device: null, track: null });
    res.json({
      playing: p.is_playing,
      progressMs: p.progress_ms,
      shuffle: p.shuffle_state,
      repeat: p.repeat_state, // off | context | track
      volume: p.device ? p.device.volume_percent : null,
      device: p.device ? { id: p.device.id, name: p.device.name, active: p.device.is_active } : null,
      track: track(p.item)
    });
  } catch (e) { next(e); }
});

/* ── Contrôle ── */
router.post('/control', async (req, res, next) => {
  const { action, value } = req.body || {};
  try {
    switch (action) {
      case 'play': await api('/me/player/play', { method: 'PUT' }); break;
      case 'pause': await api('/me/player/pause', { method: 'PUT' }); break;
      case 'next': await api('/me/player/next', { method: 'POST' }); break;
      case 'previous': await api('/me/player/previous', { method: 'POST' }); break;
      case 'seek': await api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(value) } }); break;
      case 'volume': await api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(value) } }); break;
      case 'shuffle': await api('/me/player/shuffle', { method: 'PUT', query: { state: !!value } }); break;
      case 'repeat': await api('/me/player/repeat', { method: 'PUT', query: { state: value } }); break;
      default: throw httpErr(400, 'Action inconnue: ' + action);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Lancer la lecture (titre, playlist, album…) avec fallback device ── */
router.post('/play', async (req, res, next) => {
  const { uri, context_uri, uris, offset, position_ms } = req.body || {};
  try {
    await ensureDevice();
    let body;
    if (context_uri) body = { context_uri, offset, position_ms }; // playlist/album + titre de départ
    else if (uris) body = { uris, offset, position_ms };          // liste de titres + position de départ (→ vraie file)
    else if (uri) body = { uris: [uri] };
    await api('/me/player/play', { method: 'PUT', body });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* Si aucun device actif, bascule vers librespot (device nommé) ou le 1er dispo */
async function ensureDevice() {
  const d = await api('/me/player/devices');
  const devices = (d && d.devices) || [];
  if (devices.some(x => x.is_active)) return;
  if (!devices.length) throw httpErr(404, "Aucun appareil Spotify : ouvre l'app Spotify (ou démarre librespot)");
  const target = devices.find(x => x.name === DEVICE_NAME) || devices[0];
  await api('/me/player', { method: 'PUT', body: { device_ids: [target.id], play: false } });
}

router.get('/devices', async (_req, res, next) => {
  try { const d = await api('/me/player/devices'); res.json({ devices: (d && d.devices) || [] }); }
  catch (e) { next(e); }
});
router.post('/transfer', async (req, res, next) => {
  try { await api('/me/player', { method: 'PUT', body: { device_ids: [req.body.device_id], play: !!req.body.play } }); res.json({ ok: true }); }
  catch (e) { next(e); }
});

/* ── Playlists ── */
router.get('/playlists', async (_req, res, next) => {
  try {
    const d = await api('/me/playlists', { query: { limit: 50 } });
    res.json({ items: (d.items || []).filter(Boolean).map(p => ({ id: p.id, uri: p.uri, name: p.name, owner: p.owner && p.owner.display_name, cover: img(p.images), total: p.tracks && p.tracks.total })) });
  } catch (e) { next(e); }
});
router.get('/playlist/:id/tracks', async (req, res, next) => {
  try {
    // /playlists/{id}/tracks renvoie 403 selon l'app/le compte ; l'objet playlist
    // /playlists/{id} fonctionne (200) et contient déjà les titres → on l'utilise.
    const d = await api('/playlists/' + req.params.id, { query: { market: 'from_token' } });
    const items = ((d.tracks && d.tracks.items) || []).map(it => track(it && it.track)).filter(Boolean);
    res.json({ items });
  } catch (e) { next(e); }
});

/* ── Recherche ── */
router.get('/search', async (req, res, next) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ tracks: [], artists: [], albums: [], playlists: [] });
  try {
    const types = (req.query.type || 'track,artist,album,playlist').toString();
    const d = await api('/search', { query: { q, type: types, limit: 8 } });
    res.json({
      tracks: ((d.tracks && d.tracks.items) || []).filter(Boolean).map(track).filter(Boolean),
      artists: ((d.artists && d.artists.items) || []).filter(Boolean).map(a => ({ id: a.id, uri: a.uri, name: a.name, cover: img(a.images) })),
      albums: ((d.albums && d.albums.items) || []).filter(Boolean).map(a => ({ id: a.id, uri: a.uri, name: a.name, artist: (a.artists || []).map(x => x.name).join(', '), cover: img(a.images) })),
      playlists: ((d.playlists && d.playlists.items) || []).filter(Boolean).map(p => ({ id: p.id, uri: p.uri, name: p.name, cover: img(p.images) }))
    });
  } catch (e) { next(e); }
});

/* ── Bibliothèque + file ── */
router.get('/library/tracks', async (_req, res, next) => {
  try { const d = await api('/me/tracks', { query: { limit: 50 } }); res.json({ items: (d.items || []).map(it => track(it && it.track)).filter(Boolean) }); }
  catch (e) { next(e); }
});
router.get('/recent', async (_req, res, next) => {
  try { const d = await api('/me/player/recently-played', { query: { limit: 50 } }); res.json({ items: (d.items || []).map(it => track(it && it.track)).filter(Boolean) }); }
  catch (e) { next(e); }
});
router.get('/queue', async (_req, res, next) => {
  try { const d = await api('/me/player/queue'); res.json({ current: track(d && d.currently_playing), items: ((d && d.queue) || []).map(track).filter(Boolean) }); }
  catch (e) { next(e); }
});

/* ── Gestion d'erreurs centralisée (messages clairs en FR) ── */
router.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[spotify]', err.message, err.detail || '');
  res.status(status).json({ error: err.message, status, loginUrl: status === 401 ? '/spotify/login' : undefined });
});

module.exports = router;

/**
 * server/index.js — TRANSPORT + service de l'app (couche affichage).
 *
 * - Sert l'app web statique (public/) sur WEB_PORT (défaut 3000).
 * - Expose la config (layout.json) au front via /api/layout.
 * - Monte les routeurs des prochains jalons (Spotify, géocodage, radars) en stub.
 *
 * La donnée VÉHICULE ne transite PAS par ce serveur : le front se connecte
 * directement à la couche acquisition sur ws://localhost:3001
 * (sim/fake-vehicle.js en SIM, pont capteurs en PROD). Code front identique.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

// Variables d'environnement (.env) — Spotify, ports, géocodage…
require('dotenv').config({ path: path.join(ROOT, '.env') });

const express = require('express');

const PORT = process.env.WEB_PORT || 3000;

const app = express();
app.use(express.json());

/* ─── Config exposée au front ─── */
app.get('/api/layout', (_req, res) => {
  try {
    const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'layout.json'), 'utf8'));
    res.json(layout);
  } catch (e) {
    res.status(500).json({ error: 'layout.json illisible', detail: String(e) });
  }
});

// Écriture du layout (généré par le mode calibration). Persistant, côté système.
app.post('/api/layout', (req, res) => {
  try {
    const p = path.join(ROOT, 'config', 'layout.json');
    const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
    const next = { ...cur, ...req.body };
    fs.writeFileSync(p, JSON.stringify(next, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'écriture layout.json impossible', detail: String(e) });
  }
});

/* ─── Réglages (skin actif + préférences affichage) — persistant ─── */
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const DEFAULT_SETTINGS = { activeSkin: 'mjdata', display: { brightness: 100, invertLR: false } };
function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
app.get('/api/settings', (_req, res) => res.json(readSettings()));
app.post('/api/settings', (req, res) => {
  try {
    const next = { ...readSettings(), ...req.body };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
    res.json({ ok: true, settings: next });
  } catch (e) {
    res.status(500).json({ error: 'écriture settings.json impossible', detail: String(e) });
  }
});

/* ─── Skins disponibles (dossiers skins/<id>/skin.json) ─── */
app.get('/api/skins', (_req, res) => {
  const dir = path.join(ROOT, 'skins');
  const out = [];
  try {
    for (const id of fs.readdirSync(dir)) {
      const sp = path.join(dir, id, 'skin.json');
      if (fs.existsSync(sp)) {
        try { const s = JSON.parse(fs.readFileSync(sp, 'utf8')); out.push({ id, ...s }); } catch {}
      }
    }
  } catch {}
  res.json({ skins: out });
});

// Import d'un skin (skin.json envoyé en JSON) → écrit skins/<id>/skin.json
app.post('/api/skins/import', (req, res) => {
  try {
    let { id, skin } = req.body || {};
    if (!skin || typeof skin !== 'object') return res.status(400).json({ error: 'skin.json manquant ou invalide' });
    if (!skin.name) return res.status(400).json({ error: 'champ « name » requis' });
    if (!skin.vars || typeof skin.vars !== 'object' || !skin.vars['--accent']) return res.status(400).json({ error: 'champ « vars » avec au moins --accent requis' });
    id = String(id || skin.id || skin.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id) return res.status(400).json({ error: 'identifiant de skin invalide' });
    if (id === 'mjdata' || id === 'tva') return res.status(400).json({ error: 'nom réservé (skin d\'origine)' });
    delete skin.id;
    const dir = path.join(ROOT, 'skins', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'skin.json'), JSON.stringify(skin, null, 2));
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: 'import impossible', detail: String(e) }); }
});

// Suppression d'un skin (mjdata/tva protégés ; repli sur mjdata si actif supprimé)
app.delete('/api/skins/:id', (req, res) => {
  const id = req.params.id;
  if (id === 'mjdata' || id === 'tva') return res.status(400).json({ error: 'skin d\'origine non supprimable' });
  try {
    fs.rmSync(path.join(ROOT, 'skins', id), { recursive: true, force: true });
    const s = readSettings();
    if (s.activeSkin === id) { s.activeSkin = 'mjdata'; fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'suppression impossible', detail: String(e) }); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ─── Routeurs des prochains jalons (stubs sûrs) ─── */
app.use('/spotify', require('./spotify'));
app.use('/api/geocode', require('./geocode'));
app.use('/api/route', require('./route'));
app.use('/api/radars', require('./radars'));

// Power Manager (alimentation & veille — jalon 7)
const power = require('./power-manager')();
app.use('/api/power', power.router);

/* ─── Statique ─── */
app.use('/skins', express.static(path.join(ROOT, 'skins')));
app.use(express.static(path.join(ROOT, 'public')));

app.listen(PORT, () => {
  console.log(`[web] app sur http://127.0.0.1:${PORT}`);
  console.log('[web] le front lira la donnée véhicule sur ws://localhost:3001 (lance `npm run sim`)');
});

// Démarrage de la machine à états alimentation/veille
power.start();

/* ─── Serveur HTTPS dédié au callback OAuth Spotify ───
   Spotify exige un redirect_uri en https. On garde l'app + le bus véhicule en
   http (évite le blocage « mixed content » du WebSocket) et on n'expose en https
   que ce qu'il faut pour le callback. Certificat auto-signé : config/certs/. */
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const keyP = path.join(ROOT, 'config', 'certs', 'key.pem');
const certP = path.join(ROOT, 'config', 'certs', 'cert.pem');
if (fs.existsSync(keyP) && fs.existsSync(certP)) {
  require('https')
    .createServer({ key: fs.readFileSync(keyP), cert: fs.readFileSync(certP) }, app)
    .listen(HTTPS_PORT, () => console.log(`[web] HTTPS (callback Spotify) sur https://127.0.0.1:${HTTPS_PORT}`));
} else {
  console.log('[web] config/certs absent → HTTPS désactivé (génère le certificat pour le callback Spotify)');
}

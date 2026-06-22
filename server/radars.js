/**
 * server/radars.js — base radars (data.gouv) + détection de proximité.
 *
 * Charge data/radars.csv (téléchargé par scripts/download-radars.sh). Le parseur
 * détecte les colonnes par nom (latitude/longitude/vitesse/type), donc tolère les
 * variantes du CSV officiel. Un échantillon Charente-Maritime est fourni par défaut.
 *
 * GET /api/radars/near?lat=&lon=&radius=3000  → radars dans le rayon, triés par
 *   distance, avec { id, lat, lon, type, vma, distance(m) }.
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const CSV = path.join(__dirname, '..', 'data', 'radars.csv');
let radars = [];
let loadedAt = 0;

function pick(headers, names) {
  for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; }
  return -1;
}
function loadCsv() {
  try {
    const raw = fs.readFileSync(CSV, 'utf8').trim();
    if (!raw) { radars = []; return; }
    const sep = raw.includes(';') && !raw.includes(',') ? ';' : (raw.split('\n')[0].includes(';') ? ';' : ',');
    const lines = raw.split(/\r?\n/);
    const headers = lines[0].toLowerCase().split(sep).map(s => s.trim());
    const iLat = pick(headers, ['latitude', 'lat', 'y']);
    const iLon = pick(headers, ['longitude', 'lon', 'lng', 'x']);
    const iV = pick(headers, ['vitesse', 'vma', 'vitesse_vehicules_legers_kmh', 'speed']);
    const iT = pick(headers, ['type', 'type_radar', 'equipement']);
    const iId = pick(headers, ['id', 'identifiant', 'numero']);
    radars = lines.slice(1).map(l => l.split(sep)).filter(c => c.length > Math.max(iLat, iLon)).map((c, n) => ({
      id: iId >= 0 ? c[iId] : 'R' + n,
      lat: parseFloat(c[iLat]), lon: parseFloat(c[iLon]),
      vma: iV >= 0 ? parseInt(c[iV], 10) : null,
      type: iT >= 0 ? (c[iT] || 'fixe') : 'fixe'
    })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    loadedAt = Date.now();
    console.log(`[radars] ${radars.length} radars chargés depuis ${path.basename(CSV)}`);
  } catch (e) {
    radars = [];
    console.warn('[radars] data/radars.csv absent ou illisible —', e.message);
  }
}
loadCsv();

function haversineM(a, b, c, d) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLon = toR(d - b);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

router.get('/near', (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  const radius = parseFloat(req.query.radius) || 3000;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat/lon requis' });
  // recharge auto si le CSV a été mis à jour depuis plus de 60 s
  if (Date.now() - loadedAt > 60000) { try { if (fs.statSync(CSV).mtimeMs > loadedAt) loadCsv(); } catch {} }
  const near = radars
    .map(r => ({ ...r, distance: Math.round(haversineM(lat, lon, r.lat, r.lon)) }))
    .filter(r => r.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  res.json({ radars: near, total: radars.length });
});

router.get('/all', (_req, res) => res.json({ radars, total: radars.length }));

module.exports = router;

/**
 * server/geocode.js — autocomplétion d'adresses : favoris locaux + Nominatim (OSM).
 *
 * - Favoris locaux toujours proposés (maison, bureau MJ Data, clients…), avec coords.
 * - Recherche en ligne via Nominatim (User-Agent obligatoire, cf. politique OSM).
 * - Cache mémoire (TTL) + dégradation gracieuse : si le réseau tombe, on renvoie
 *   les favoris + une base d'exemples locale (autour de Rochefort).
 *
 * GET /api/geocode?q=...&lat=..&lon=..   (lat/lon optionnels → calcule les distances)
 *   → { results:[{ name, addr, lat, lon, type, dist }], source }
 */
'use strict';

const express = require('express');
const router = express.Router();

const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const UA = process.env.GEOCODE_USER_AGENT || 'mjdata-cluster/0.1';

/* Favoris locaux (toujours proposés). Coords réelles approx. autour de Rochefort. */
const FAVORITES = [
  { name: 'Maison', addr: 'Domicile', lat: 45.9360, lon: -0.9630, type: 'fav' },
  { name: 'Bureau MJ Data', addr: 'Rochefort', lat: 45.9412, lon: -0.9590, type: 'fav' },
  { name: "Résidence de l'Arsenal Royal", addr: 'Rue Toufaire, Rochefort', lat: 45.9385, lon: -0.9620, type: 'fav' }
];

/* Base d'exemples (fallback offline) — Charente-Maritime. */
const LOCAL = [
  { name: 'Rochefort Centre', addr: 'Place Colbert, 17300', lat: 45.9412, lon: -0.9590, type: 'city' },
  { name: 'Rochefort Gare', addr: 'Av. Wilson, 17300', lat: 45.9430, lon: -0.9650, type: 'poi' },
  { name: 'Rochefort Hôpital', addr: 'Av. de Béligon, 17300', lat: 45.9290, lon: -0.9700, type: 'poi' },
  { name: 'Tonnay-Charente', addr: '17430 Charente-Maritime', lat: 45.9480, lon: -0.8960, type: 'city' },
  { name: 'Soubise', addr: '17780 Charente-Maritime', lat: 45.9200, lon: -0.9990, type: 'city' },
  { name: 'Royan', addr: '17200 Charente-Maritime', lat: 45.6280, lon: -1.0280, type: 'city' },
  { name: 'La Rochelle', addr: '17000 Charente-Maritime', lat: 46.1591, lon: -1.1520, type: 'city' },
  { name: 'Saintes', addr: '17100 Charente-Maritime', lat: 45.7460, lon: -0.6330, type: 'city' }
];

function haversine(a, b, c, d) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLon = toR(d - b);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)); // km
}
function withDist(items, lat, lon) {
  if (lat == null || lon == null) return items.map(p => ({ ...p, dist: '' }));
  return items.map(p => {
    const km = haversine(lat, lon, p.lat, p.lon);
    return { ...p, dist: km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km' };
  });
}
function localSearch(q) {
  const t = q.toLowerCase();
  const pool = [...FAVORITES, ...LOCAL];
  return pool.filter(p => p.name.toLowerCase().includes(t) || p.addr.toLowerCase().includes(t)).slice(0, 6);
}

/* cache mémoire */
const cache = new Map(); // q → { ts, results }
const TTL = 5 * 60 * 1000;

router.get('/', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const lat = req.query.lat != null ? parseFloat(req.query.lat) : null;
  const lon = req.query.lon != null ? parseFloat(req.query.lon) : null;

  if (!q) return res.json({ results: withDist(FAVORITES, lat, lon), source: 'favorites' });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return res.json({ results: withDist(hit.results, lat, lon), source: 'cache' });

  // favoris correspondants d'abord
  const favMatches = FAVORITES.filter(p => p.name.toLowerCase().includes(key) || p.addr.toLowerCase().includes(key));

  try {
    const url = `${NOMINATIM}/search?` + new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '1', countrycodes: 'fr' });
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('nominatim ' + r.status);
    const arr = await r.json();
    const online = arr.map(o => ({
      name: o.name || (o.display_name || '').split(',')[0],
      addr: (o.display_name || '').split(',').slice(1, 3).join(',').trim(),
      lat: parseFloat(o.lat), lon: parseFloat(o.lon),
      type: o.addresstype === 'house' || o.type === 'house' ? 'poi' : 'city'
    }));
    const results = [...favMatches, ...online].slice(0, 7);
    cache.set(key, { ts: Date.now(), results });
    res.json({ results: withDist(results, lat, lon), source: 'nominatim' });
  } catch (e) {
    // dégradation : favoris + base locale
    const results = [...favMatches, ...localSearch(q)].filter((p, i, a) => a.findIndex(x => x.name === p.name) === i).slice(0, 6);
    res.json({ results: withDist(results, lat, lon), source: 'local-fallback', reason: e.message });
  }
});

module.exports = router;
module.exports.FAVORITES = FAVORITES;

/**
 * server/route.js — routing / guidage via OSRM (proxy serveur + cache + fallback).
 *
 * GET /api/route?from=lat,lon&to=lat,lon
 *   → { distance(m), duration(s), coordinates:[[lat,lon],…], steps:[{ lat,lon,
 *        type, modifier, name, distance(m) }], source }
 *
 * Provider configurable (OSRM_URL). Fallback offline : segment droit origine→dest
 * (le dead-reckoning et l'alerte radar restent testables sans réseau).
 * Option offline réelle (OSRM/GraphHopper self-host) documentée dans docs.
 */
'use strict';

const express = require('express');
const router = express.Router();

const OSRM = process.env.OSRM_URL || 'https://router.project-osrm.org';
const cache = new Map(); // key → { ts, data }
const TTL = 10 * 60 * 1000;

function parseLL(s) { const [a, b] = String(s || '').split(',').map(Number); return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null; }
function haversineM(a, b, c, d) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(c - a), dLon = toR(d - b);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a)) * Math.cos(toR(c)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function straightFallback(from, to) {
  const dist = haversineM(from[0], from[1], to[0], to[1]);
  return {
    distance: dist, duration: dist / 13.8, // ~50 km/h
    coordinates: [from, to],
    steps: [
      { lat: from[0], lon: from[1], type: 'depart', modifier: 'straight', name: 'Départ', distance: dist },
      { lat: to[0], lon: to[1], type: 'arrive', modifier: 'straight', name: 'Arrivée', distance: 0 }
    ],
    source: 'fallback-straight'
  };
}

router.get('/', async (req, res) => {
  const from = parseLL(req.query.from), to = parseLL(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'from/to requis (lat,lon)' });

  const key = req.query.from + '>' + req.query.to;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return res.json(hit.data);

  try {
    const url = `${OSRM}/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?` +
      new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'true' });
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('osrm ' + r.status);
    const j = await r.json();
    if (!j.routes || !j.routes.length) throw new Error('aucun itinéraire');
    const route = j.routes[0];
    const coordinates = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]); // GeoJSON [lon,lat] → [lat,lon]
    const steps = [];
    (route.legs || []).forEach(leg => (leg.steps || []).forEach(s => {
      const m = s.maneuver || {};
      const [lon, lat] = m.location || [];
      steps.push({
        lat, lon, type: m.type || 'turn', modifier: m.modifier || 'straight',
        name: s.name || '', distance: s.distance || 0,
        exit: m.exit, bearingBefore: m.bearing_before, bearingAfter: m.bearing_after
      });
    }));
    const data = { distance: route.distance, duration: route.duration, coordinates, steps, source: 'osrm' };
    cache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.json({ ...straightFallback(from, to), reason: e.message });
  }
});

module.exports = router;

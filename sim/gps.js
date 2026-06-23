/**
 * sim/gps.js — lecteur GPS NMEA (u-blox 7 USB sur /dev/ttyACM0), sans dépendance.
 *
 * Lit le flux NMEA en continu, parse $GxRMC (position/vitesse/validité) et
 * $GxGGA (qualité de fix/satellites), et expose la dernière position connue.
 * Réouvre le port automatiquement si le device disparaît (débranchement).
 *
 * Utilisé par sim/fake-vehicle.js : si un fix réel est dispo, il remplace la
 * position/vitesse simulées dans le payload diffusé sur ws:3001 (même format).
 */
'use strict';
const fs = require('fs');

let latest = null;          // { lat, lon, fix, speedKmh, sats, ts }
let stream = null, buf = '', retryT = null;

// "ddmm.mmmm" (lat) / "dddmm.mmmm" (lon) → degrés décimaux signés
function nmeaToDeg(v, hemi) {
  if (!v) return null;
  const dot = v.indexOf('.');
  const degLen = dot > 4 ? 3 : 2;                 // lon a 3 chiffres de degrés, lat 2
  const deg = parseInt(v.slice(0, degLen), 10);
  const min = parseFloat(v.slice(degLen));
  if (!isFinite(deg) || !isFinite(min)) return null;
  let d = deg + min / 60;
  if (hemi === 'S' || hemi === 'W') d = -d;
  return d;
}

function parseLine(line) {
  if (line.length < 6 || line[0] !== '$') return;
  const star = line.indexOf('*');
  const f = (star >= 0 ? line.slice(1, star) : line.slice(1)).split(',');
  const type = f[0].slice(2);                     // retire le talker (GP/GN/GL…)
  if (type === 'RMC') {
    const lat = nmeaToDeg(f[3], f[4]), lon = nmeaToDeg(f[5], f[6]);
    const valid = f[2] === 'A' && lat != null && lon != null;
    const speedKmh = f[7] ? parseFloat(f[7]) * 1.852 : 0;
    latest = valid
      ? { ...(latest || {}), lat, lon, fix: true, speedKmh, ts: Date.now() }
      : { ...(latest || {}), fix: false, ts: Date.now() };
  } else if (type === 'GGA') {
    const q = parseInt(f[6], 10), sats = parseInt(f[7], 10) || 0;
    if (q > 0) {
      const lat = nmeaToDeg(f[2], f[3]), lon = nmeaToDeg(f[4], f[5]);
      if (lat != null && lon != null) latest = { ...(latest || {}), lat, lon, fix: true, sats, ts: Date.now() };
    } else {
      latest = { ...(latest || {}), fix: false, sats, ts: Date.now() };
    }
  }
}

function open(dev) {
  try {
    stream = fs.createReadStream(dev, { encoding: 'utf8' });
    stream.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { try { parseLine(line); } catch {} }
      }
      if (buf.length > 4096) buf = '';            // garde-fou anti-emballement
    });
    stream.on('error', () => retry(dev));
    stream.on('close', () => retry(dev));
    console.log('[gps] lecture NMEA sur', dev);
  } catch { retry(dev); }
}
function retry(dev) {
  if (stream) { try { stream.destroy(); } catch {} stream = null; }
  if (retryT) return;
  retryT = setTimeout(() => { retryT = null; open(dev); }, 3000);
}

module.exports = {
  start(dev) { open(dev); },
  // dernière position si plus récente que maxAgeMs (sinon null = GPS muet/absent)
  latest(maxAgeMs) {
    if (!latest) return null;
    if (maxAgeMs && (Date.now() - latest.ts) > maxAgeMs) return null;
    return latest;
  }
};

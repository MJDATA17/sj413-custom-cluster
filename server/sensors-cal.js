/**
 * server/sensors-cal.js — courbes de calibration capteurs (config/sensors.json).
 *
 * Conversion par interpolation linéaire sur table de points. Utilisé par :
 *  - server/serial-bridge.js : ohms réels (Arduino) → % carburant / °C température.
 *  - sim/fake-vehicle.js     : sens inverse pour générer des bruts cohérents en SIM.
 * Recalibrer = éditer config/sensors.json (puis /api/power-style reload), sans toucher au code.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'config', 'sensors.json');

let cal = {};
function load() { try { cal = JSON.parse(fs.readFileSync(P, 'utf8')); } catch (e) { console.warn('[cal] sensors.json illisible:', e.message); cal = {}; } }
load();

// Interpolation linéaire de yKey en fonction de xKey sur une table {xKey,yKey} (ordre quelconque)
function interp(curve, xKey, yKey, x) {
  if (!Array.isArray(curve) || !curve.length) return null;
  const pts = [...curve].sort((a, b) => a[xKey] - b[xKey]);
  if (x <= pts[0][xKey]) return pts[0][yKey];
  if (x >= pts[pts.length - 1][xKey]) return pts[pts.length - 1][yKey];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][xKey]) {
      const a = pts[i - 1], b = pts[i];
      const t = (x - a[xKey]) / (b[xKey] - a[xKey]);
      return a[yKey] + t * (b[yKey] - a[yKey]);
    }
  }
  return pts[pts.length - 1][yKey];
}
const clampPct = v => v == null ? null : Math.max(0, Math.min(100, v));

module.exports = {
  reload: load,
  cal: () => cal,
  // ── carburant : ohms ↔ % ──
  fuelPctFromOhm(ohm) { return clampPct(interp(cal.fuel && cal.fuel.curve, 'ohm', 'percent', ohm)); },
  fuelOhmFromPct(pct) { return interp(cal.fuel && cal.fuel.curve, 'percent', 'ohm', pct); },
  // ── température : ohms ↔ °C ──
  tempCFromOhm(ohm) { return interp(cal.temp && cal.temp.curve, 'ohm', 'celsius', ohm); },
  tempOhmFromC(c) { return interp(cal.temp && cal.temp.curve, 'celsius', 'ohm', c); },
  // ── pont diviseur (sonde↔GND, R_série↔Vsupply, point milieu lu) ──
  ohmToRaw(ohm, series, adcMax) { return Math.round(adcMax * ohm / (ohm + series)); },
  rawToOhm(raw, series, adcMax) { return raw >= adcMax ? Infinity : series * raw / (adcMax - raw); },
  // ── orientation réelle du pont ──
  // Le firmware calcule TOUJOURS l'ohm en supposant la sonde côté MASSE (low-side) :
  //   ohm_fw = série · raw/(adcMax−raw).
  // Si la sonde est en fait câblée côté +5V (high-side), l'ohm réel vaut
  //   ohm_réel = série · (adcMax−raw)/raw = série² / ohm_fw   (indépendant de adcMax).
  // sensors.json: "wiring":"high_side" (sonde↔+5V) ou "low_side"/absent (sonde↔GND).
  realOhm(ohmFw, series, wiring) {
    if (ohmFw == null || !isFinite(ohmFw)) return ohmFw;
    if (wiring === 'high_side') return ohmFw > 0 ? (series * series) / ohmFw : Infinity;
    return ohmFw; // low_side : le firmware est déjà dans le bon sens
  }
};

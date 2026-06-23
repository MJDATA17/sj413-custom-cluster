/**
 * server/serial-bridge.js — pont série Arduino (hub capteurs) → données cluster.
 *
 * Lit /dev/ttyUSB0 (Arduino Nano CH340, baud configurable), parse le JSON ligne
 * par ligne, applique les courbes de calibration (config/sensors.json via
 * sensors-cal) : fuel_ohm→%, temp_ohm→°C. Expose la dernière mesure.
 *
 * L'Arduino n'envoie QUE du brut (ohms/ADC) → recalibrage sans reflasher.
 * Réouverture automatique si l'Arduino est débranché/rebranché. Le composeur de
 * bus (sim/fake-vehicle.js) consomme latest() et bascule sim↔serial (DATA_SOURCE),
 * avec fallback simulateur si le port est absent/stale.
 *
 * Format série attendu (10 Hz, \n) :
 *   {"rpm":2480,"fuel_raw":612,"fuel_ohm":48.2,"temp_raw":340,"temp_ohm":360,"ign":1,"st":7,"ms":123456}
 */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const cal = require('./sensors-cal');

let latest = null;            // { rpm, fuel, fuel_ohm, temp, temp_raw, temp_ohm, ignition, st, ts }
let stream = null, buf = '', retryT = null;

function parseLine(line) {
  if (!line || line[0] !== '{') return;
  let m; try { m = JSON.parse(line); } catch { return; }
  const fuelPct = (m.fuel_ohm != null) ? cal.fuelPctFromOhm(m.fuel_ohm) : null;
  const tempC = (m.temp_ohm != null) ? cal.tempCFromOhm(m.temp_ohm) : null;
  latest = {
    rpm: m.rpm != null ? Math.round(m.rpm) : null,
    fuel: fuelPct != null ? +fuelPct.toFixed(1) : null,
    fuel_ohm: m.fuel_ohm != null ? +(+m.fuel_ohm).toFixed(1) : null,
    fuel_raw: m.fuel_raw,
    temp: tempC != null ? +tempC.toFixed(1) : null,
    temp_ohm: m.temp_ohm != null ? +(+m.temp_ohm).toFixed(1) : null,
    temp_raw: m.temp_raw,
    ignition: !!m.ign,
    st: m.st,
    ts: Date.now()
  };
}

function open(dev, baud) {
  try {
    // CH340 = vrai UART → fixer le baud (contrairement au GPS cdc_acm). raw, pas d'écho.
    try { execSync(`stty -F ${dev} ${baud} raw -echo -echoe -echok -icanon min 0 time 0 2>/dev/null`); } catch {}
    stream = fs.createReadStream(dev, { encoding: 'utf8' });
    stream.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { try { parseLine(line); } catch {} }
      }
      if (buf.length > 8192) buf = '';
    });
    stream.on('error', () => retry(dev, baud));
    stream.on('close', () => retry(dev, baud));
    console.log(`[serial] lecture Arduino sur ${dev} @ ${baud}`);
  } catch { retry(dev, baud); }
}
function retry(dev, baud) {
  if (stream) { try { stream.destroy(); } catch {} stream = null; }
  if (retryT) return;
  retryT = setTimeout(() => { retryT = null; open(dev, baud); }, 3000);
}

module.exports = {
  start(dev, baud) { open(dev || '/dev/ttyUSB0', baud || 115200); },
  // dernière mesure si plus récente que maxAgeMs (sinon null = Arduino muet/absent → fallback sim)
  latest(maxAgeMs) {
    if (!latest) return null;
    if (maxAgeMs && (Date.now() - latest.ts) > maxAgeMs) return null;
    return latest;
  }
};

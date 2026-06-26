/**
 * server/serial-bridge.js — pont série Arduino (hub capteurs) → données cluster.
 *
 * Lit /dev/ttyUSB0 (Arduino Nano CH340, baud configurable), parse le JSON ligne
 * par ligne, applique les courbes de calibration (config/sensors.json via
 * sensors-cal) : fuel_ohm→%, temp_ohm→°C. Expose la dernière mesure.
 *
 * L'Arduino n'envoie QUE du brut (ohms/ADC) → recalibrage sans reflasher.
 * Réouverture automatique + LOGS EXPLICITES (ouverture, succès, échec+raison)
 * pour ne jamais avoir de fallback silencieux. Le composeur de bus
 * (sim/fake-vehicle.js) consomme latest() et bascule sim↔serial (DATA_SOURCE).
 *
 * Format série attendu (10 Hz, \n) :
 *   {"rpm":2480,"fuel_raw":612,"fuel_ohm":48.2,"temp_raw":340,"temp_ohm":360,"ign":1,"st":7,"ms":123456}
 */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const cal = require('./sensors-cal');

let latest = null;            // { rpm, fuel, fuel_ohm, temp, temp_raw, temp_ohm, ignition, st, ts }
let stream = null, buf = '', retryT = null, haveData = false;

function parseLine(line) {
  if (!line || line[0] !== '{') return;
  let m; try { m = JSON.parse(line); } catch { return; }
  // Corrige l'orientation du pont (firmware = low-side) selon sensors.json "wiring"
  // avant d'appliquer les courbes. fuel/temp câblés high-side → ohm réel = série²/ohm_fw.
  const c = cal.cal();
  const fSeries = (c.fuel && c.fuel.series_resistor) || 100;
  const tSeries = (c.temp && c.temp.series_resistor) || 1000;
  const fWiring = c.fuel && c.fuel.wiring, tWiring = c.temp && c.temp.wiring;
  const fuelOhm = (m.fuel_ohm != null) ? cal.realOhm(+m.fuel_ohm, fSeries, fWiring) : null;
  const tempOhm = (m.temp_ohm != null) ? cal.realOhm(+m.temp_ohm, tSeries, tWiring) : null;
  const fuelPct = (fuelOhm != null) ? cal.fuelPctFromOhm(fuelOhm) : null;
  const tempC = (tempOhm != null) ? cal.tempCFromOhm(tempOhm) : null;
  latest = {
    rpm: m.rpm != null ? Math.round(m.rpm) : null,
    fuel: fuelPct != null ? +fuelPct.toFixed(1) : null,
    fuel_ohm: (fuelOhm != null && isFinite(fuelOhm)) ? +fuelOhm.toFixed(1) : null,
    fuel_raw: m.fuel_raw,
    temp: tempC != null ? +tempC.toFixed(1) : null,
    temp_ohm: (tempOhm != null && isFinite(tempOhm)) ? +tempOhm.toFixed(1) : null,
    temp_raw: m.temp_raw,
    ignition: !!m.ign,
    st: m.st,
    ts: Date.now()
  };
  if (!haveData) { haveData = true; console.log(`[serial] ✓ Arduino connecté — trames JSON valides reçues (rpm=${latest.rpm}, fuel=${latest.fuel}%, temp=${latest.temp}°C)`); }
}

function open(dev, baud) {
  console.log(`[serial] ouverture ${dev} @ ${baud}…`);
  // CH340 = vrai UART → fixer le baud. 'raw' = mode brut + lecture BLOQUANTE (min 1) :
  // NE PAS mettre 'min 0 time 0' (lecture non bloquante → EOF immédiat → flux fermé en boucle).
  try { execSync(`stty -F ${dev} ${baud} raw -echo 2>/dev/null`); }
  catch (e) { console.warn(`[serial] ⚠ stty a échoué sur ${dev} : ${e.message}`); }
  try {
    stream = fs.createReadStream(dev, { encoding: 'utf8' });
  } catch (e) {
    console.warn(`[serial] ⚠ ouverture impossible (${dev}) : ${e.message} → réessai 3s`);
    return retry(dev, baud);
  }
  stream.on('open', () => console.log(`[serial] port ${dev} ouvert, en attente de trames…`));
  stream.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) { try { parseLine(line); } catch {} }
    }
    if (buf.length > 8192) buf = '';
  });
  stream.on('error', err => { console.warn(`[serial] ⚠ ERREUR ${dev} : ${err.message} → réessai 3s`); retry(dev, baud); });
  stream.on('close', () => { if (haveData) console.warn(`[serial] ⚠ ${dev} fermé/débranché → réessai 3s`); retry(dev, baud); });
}
function retry(dev, baud) {
  if (stream) { try { stream.destroy(); } catch {} stream = null; }
  haveData = false;
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

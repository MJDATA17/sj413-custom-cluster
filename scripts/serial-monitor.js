#!/usr/bin/env node
/**
 * scripts/serial-monitor.js — moniteur série Arduino (debug câblage/calibration).
 *
 * Affiche en direct le JSON brut envoyé par l'Arduino + les valeurs converties
 * (% carburant, °C température) via config/sensors.json. Sert à vérifier le
 * câblage et la calibration sans lancer tout le cluster.
 *
 * Usage : node scripts/serial-monitor.js [device] [baud]
 *   ex.  node scripts/serial-monitor.js /dev/ttyUSB0 115200
 */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');
const cal = require('../server/sensors-cal');

const DEV = process.argv[2] || process.env.SERIAL_DEVICE || '/dev/ttyUSB0';
const BAUD = parseInt(process.argv[3] || process.env.SERIAL_BAUD || '115200', 10);

console.log(`[monitor] écoute ${DEV} @ ${BAUD}  (Ctrl+C pour quitter)\n`);
try { execSync(`stty -F ${DEV} ${BAUD} raw -echo -echoe -echok -icanon min 0 time 0 2>/dev/null`); }
catch { console.warn('[monitor] stty a échoué (port absent ?)'); }

let buf = '';
const s = fs.createReadStream(DEV, { encoding: 'utf8' });
s.on('data', chunk => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line || line[0] !== '{') continue;
    let m; try { m = JSON.parse(line); } catch { console.log('  (ligne illisible)', line); continue; }
    const fuel = m.fuel_ohm != null ? cal.fuelPctFromOhm(m.fuel_ohm) : null;
    const temp = m.temp_ohm != null ? cal.tempCFromOhm(m.temp_ohm) : null;
    const st = m.st != null ? `st=${m.st.toString(2).padStart(3, '0')}` : '';
    console.log(
      `rpm=${String(m.rpm).padStart(5)}  ` +
      `fuel: ${String(m.fuel_ohm).padStart(6)}Ω → ${fuel != null ? fuel.toFixed(0) + '%' : '—'}  ` +
      `temp: ${String(m.temp_ohm).padStart(6)}Ω → ${temp != null ? temp.toFixed(0) + '°C' : '—'}  ` +
      `ign=${m.ign ? 'ON ' : 'off'}  ${st}`
    );
  }
});
s.on('error', e => { console.error('[monitor] erreur port:', e.message); process.exit(1); });

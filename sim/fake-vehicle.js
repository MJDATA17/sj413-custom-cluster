/**
 * sim/fake-vehicle.js — SIMULATEUR CAPTEURS (couche ACQUISITION en mode SIM)
 *
 * Diffuse en WebSocket JSON sur :3001 le même payload que produira la couche
 * d'acquisition réelle (Arduino serial + ADS1115 + GPS) en PROD. Le front ne
 * voit AUCUNE différence : seule la source change.
 *
 * Payload diffusé (~20 Hz) :
 *   { speed, rpm, fuel, fuel_ohm, temp, temp_raw,
 *     gps_lat, gps_lon, gps_fix, scenario, ts }
 *
 * Commandes acceptées (client → serveur, JSON) :
 *   { cmd:'scenario', value:'city' }      change de scénario
 *   { cmd:'set', key:'speed', value:90 }  force une valeur (override temporaire)
 *   { cmd:'clear', key:'speed' }          relâche l'override
 *   { cmd:'pulse', event:'overheat' }     déclenche un évènement ponctuel
 */
'use strict';

const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const gps = require('./gps');
const GPS_ENABLED = process.env.GPS_ENABLED !== '0';
const GPS_DEVICE = process.env.GPS_DEVICE || '/dev/ttyACM0';
// Décalage de vitesse appliqué à la vitesse GPS affichée (km/h).
// Positif = on AFFICHE plus que le réel → en se calant dessus on roule toujours en dessous.
const GPS_SPEED_OFFSET = parseFloat(process.env.GPS_SPEED_OFFSET || '4');

const PORT = process.env.WS_DATA_PORT || 3001;
const cal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'sensors.json'), 'utf8'));

/* ─── Scénarios ───────────────────────────────────────────────
   Chaque scénario définit des cibles ; l'état suit ces cibles avec
   de l'inertie + du bruit pour rester réaliste. */
const SCENARIOS = {
  idle:       { speedTarget: 0,   rpmIdle: true,  desc: 'Moteur au ralenti, à l\'arrêt' },
  city:       { speedTarget: 45,  rpmIdle: false, desc: 'Conduite urbaine, arrêts fréquents' },
  highway:    { speedTarget: 110, rpmIdle: false, desc: 'Voie rapide, vitesse soutenue' },
  cold_start: { speedTarget: 20,  rpmIdle: false, desc: 'Démarrage à froid, montée en température' },
  overheat:   { speedTarget: 60,  rpmIdle: false, desc: 'Surchauffe moteur progressive' },
  low_fuel:   { speedTarget: 50,  rpmIdle: false, desc: 'Réserve carburant' }
};

let scenario = 'idle';

/* état interne continu */
const st = {
  speed: 0,
  rpm: cal.rpm.idle_rpm,
  fuel: 72,         // %
  temp: 20,         // °C
  gps_lat: 45.9419, // Rochefort
  gps_lon: -0.9636,
  gps_fix: true
};

/* overrides manuels { key: value } */
const overrides = {};

/* trajet GPS lent autour de Rochefort (déplacement symbolique) */
let gpsPhase = 0;

function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function approach(cur, target, rate) { return cur + (target - cur) * rate; }

function applyScenarioInit(name) {
  scenario = name;
  if (name === 'cold_start') st.temp = 20;
  if (name === 'low_fuel') st.fuel = Math.min(st.fuel, 14);
  if (name === 'overheat') { /* la temp montera au-delà des seuils dans le tick */ }
}

/* ─── Tick simulation (~20 Hz) ─── */
function tick() {
  const sc = SCENARIOS[scenario] || SCENARIOS.idle;

  /* Vitesse : suit la cible avec inertie + micro-variations.
     GPS : latence implicite (inertie lente) + pertes de fix aléatoires. */
  const speedTarget = sc.speedTarget + (sc.speedTarget > 0 ? rnd(-8, 8) : 0);
  st.speed = clamp(approach(st.speed, Math.max(0, speedTarget), 0.04), 0, cal.speed.max_kmh);
  if (sc.speedTarget === 0) st.speed = approach(st.speed, 0, 0.1);
  st.gps_fix = Math.random() > cal.speed.gps_fix_loss_prob;

  /* RPM : ralenti corrélé, sinon proportionnel vitesse + bruit */
  if (sc.rpmIdle) {
    st.rpm = approach(st.rpm, cal.rpm.idle_rpm + rnd(-40, 40), 0.2);
  } else {
    const rpmFromSpeed = cal.rpm.idle_rpm + st.speed * 32; // ratio grossier 4 rapports
    st.rpm = clamp(approach(st.rpm, rpmFromSpeed + rnd(-120, 120), 0.1), cal.rpm.idle_rpm, cal.rpm.max_rpm);
  }

  /* Carburant : descente lente + bruit ADC */
  const burn = scenario === 'idle' ? 0.0008 : 0.0035;
  st.fuel = clamp(st.fuel - burn, 0, 100);

  /* Température : montée réaliste 20→~88°C puis stable ; overheat dépasse les seuils */
  let tempTarget = 88;
  if (scenario === 'cold_start') tempTarget = 88;
  if (scenario === 'overheat')   tempTarget = 118;
  if (scenario === 'idle')       tempTarget = 84;
  const tempRate = scenario === 'overheat' ? 0.006 : 0.004;
  st.temp = clamp(approach(st.temp, tempTarget, tempRate) + rnd(-0.3, 0.3), 15, 130);

  /* Déplacement GPS symbolique */
  gpsPhase += 0.0006;
  st.gps_lat = 45.9419 + Math.sin(gpsPhase) * 0.01;
  st.gps_lon = -0.9636 + Math.cos(gpsPhase) * 0.01;

  broadcast();
}

/* ─── Conversion état → bruts capteurs (cohérents avec la calibration) ─── */
function fuelToOhm(pct) {
  const { ohm_full, ohm_empty, adc_noise_ohm } = cal.fuel;
  return +(ohm_full + (ohm_empty - ohm_full) * (1 - pct / 100) + rnd(-adc_noise_ohm, adc_noise_ohm)).toFixed(1);
}
function tempToRaw(c) {
  // tension ADC approximée via diviseur NTC (valeur 0..32767 façon ADS1115)
  const { ntc_beta, ntc_r25, series_resistor } = cal.temp;
  const tK = c + 273.15;
  const r = ntc_r25 * Math.exp(ntc_beta * (1 / tK - 1 / 298.15));
  const vRatio = r / (r + series_resistor);
  return Math.round(vRatio * 32767);
}

function payload() {
  const out = {
    speed: +st.speed.toFixed(1),
    rpm: Math.round(st.rpm),
    fuel: +st.fuel.toFixed(1),
    fuel_ohm: fuelToOhm(st.fuel),
    temp: +st.temp.toFixed(1),
    temp_raw: tempToRaw(st.temp),
    gps_lat: +st.gps_lat.toFixed(6),
    gps_lon: +st.gps_lon.toFixed(6),
    gps_fix: st.gps_fix,
    scenario,
    ts: Date.now()
  };
  // GPS réel (u-blox) : remplace position + vitesse simulées dès qu'un fix est dispo
  if (GPS_ENABLED) {
    const g = gps.latest(10000);
    if (g && g.lat != null && g.lon != null) {
      out.gps_lat = +g.lat.toFixed(6);
      out.gps_lon = +g.lon.toFixed(6);
      out.gps_fix = !!g.fix;
      if (g.fix && g.speedKmh != null) out.speed = g.speedKmh < 2 ? 0 : Math.max(0, +(g.speedKmh + GPS_SPEED_OFFSET).toFixed(1));
    }
  }
  // overrides manuels (éditeur / tests) écrasent la valeur diffusée
  for (const k of Object.keys(overrides)) out[k] = overrides[k];
  if (!out.gps_fix) { out.speed = out.speed; } // garde la dernière vitesse connue côté front
  return out;
}

/* ─── WebSocket ─── */
const wss = new WebSocketServer({ port: PORT });
function broadcast() {
  const msg = JSON.stringify(payload());
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', (ws) => {
  console.log('[sim] client connecté (%d total)', wss.clients.size);
  ws.send(JSON.stringify(payload()));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.cmd === 'scenario' && SCENARIOS[m.value]) {
      applyScenarioInit(m.value);
      console.log('[sim] scénario →', m.value, '·', SCENARIOS[m.value].desc);
    } else if (m.cmd === 'set' && m.key != null) {
      overrides[m.key] = m.value;
    } else if (m.cmd === 'clear' && m.key != null) {
      delete overrides[m.key];
    } else if (m.cmd === 'pulse') {
      if (m.event === 'overheat') st.temp = 115;
      if (m.event === 'low_fuel') st.fuel = 13;
      if (m.event === 'redline') st.rpm = cal.rpm.max_rpm;
    }
  });
  ws.on('close', () => console.log('[sim] client déconnecté'));
});

setInterval(tick, 50); // 20 Hz

const arg = process.argv.find(a => SCENARIOS[a]);
if (arg) applyScenarioInit(arg);

console.log(`[sim] fake-vehicle WS sur ws://localhost:${PORT}  ·  scénario: ${scenario}`);
console.log('[sim] scénarios:', Object.keys(SCENARIOS).join(', '));

// GPS réel : démarre la lecture NMEA (position/vitesse réelles si fix dispo, sinon simulé)
if (GPS_ENABLED) { console.log('[sim] GPS réel activé →', GPS_DEVICE); gps.start(GPS_DEVICE); }
else console.log('[sim] GPS réel désactivé (GPS_ENABLED=0) → position simulée');

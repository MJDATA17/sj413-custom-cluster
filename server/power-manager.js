/**
 * server/power-manager.js — MODULE ALIMENTATION & VEILLE (jalon 7)
 *
 * Machine à états robuste pilotant la veille/réveil du ThinkPad selon l'état du
 * contact véhicule, avec ANTI-REBOND obligatoire (la détection de charge USB-C
 * est instable : micro-coupures, faux contacts). Voir docs/POWER.md.
 *
 * États : RUNNING · IGNITION_OFF_PENDING · IDLE_WAIT · SLEEP · HIBERNATE.
 * Entrées : charge USB-C (/sys/.../AC/online) + IGNITION Arduino (via le bus
 * ws:3001) + niveau batterie (/sys/.../BAT0/capacity). En simulation, toutes
 * les entrées sont injectables via POST /api/power/sim (test complet sur PC).
 *
 * Tous les délais/seuils viennent de config/power.json (jamais codés en dur).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'power.json');

const S = {
  RUNNING: 'RUNNING',
  PENDING: 'IGNITION_OFF_PENDING',
  IDLE_WAIT: 'IDLE_WAIT',
  SLEEP: 'SLEEP',
  HIBERNATE: 'HIBERNATE'
};

const DEFAULTS = {
  enabled: true,
  source: 'auto',                 // auto | arduino | usb
  sampleIntervalMs: 1500,
  debounce: { offConfirmMs: 9000, onConfirmMs: 2000, minConsecutiveSamples: 2 },
  ignition: { busUrl: 'ws://localhost:3001', payloadField: 'ignition', staleMs: 6000 },
  charge: { onlinePath: '/sys/class/power_supply/AC/online', batteryStatusPath: '/sys/class/power_supply/BAT0/status' },
  battery: { capacityPath: '/sys/class/power_supply/BAT0/capacity', hibernateBelowPct: 15, criticalBelowPct: 7 },
  timers: { sleepAfterMs: 900000 },
  actions: {
    sleepCmd: 'sudo systemctl suspend-then-hibernate',
    hibernateCmd: 'sudo systemctl hibernate',
    screenOffCmd: 'DISPLAY=:0 XAUTHORITY=$(ls -t /tmp/serverauth.* 2>/dev/null | head -1) xset dpms force off',
    screenOnCmd: 'DISPLAY=:0 XAUTHORITY=$(ls -t /tmp/serverauth.* 2>/dev/null | head -1) xset dpms force on',
    dryRun: false
  },
  simulation: { enabled: false, charge: true, ignition: null, batteryPct: 80 },
  resumeDetectGapMs: 8000,
  log: { transitions: true, samples: false }
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]))
      ? deepMerge(base[k] || {}, over[k]) : over[k];
  }
  return out;
}
function loadConfig() {
  try { return deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
  catch (e) { console.warn('[power] config/power.json illisible, valeurs par défaut:', e.message); return deepMerge(DEFAULTS, {}); }
}

module.exports = function createPowerManager() {
  let cfg = loadConfig();
  const router = express.Router();
  router.use(express.json());

  /* ─── Entrées (réelles ou simulées) ─── */
  let sim = { ...cfg.simulation };          // { enabled, charge, ignition, batteryPct }
  let dryRunOverride = null;                // null = suit cfg.actions.dryRun ; true/false = forçage runtime (tests)
  let busIgnition = { value: null, ts: 0 }; // dernier IGNITION reçu du bus
  let glitch = null;                        // override transitoire de charge { value, until } pour tester l'anti-rebond

  function readFileTrim(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } }

  function readChargeReal() {
    const v = readFileTrim(cfg.charge.onlinePath);
    if (v != null) return v === '1';
    const st = readFileTrim(cfg.charge.batteryStatusPath);   // repli : statut batterie
    if (st != null) return /charging|full/i.test(st);
    return null;
  }
  function readBatteryReal() {
    const v = readFileTrim(cfg.battery.capacityPath);
    return v != null ? parseInt(v, 10) : null;
  }

  function chargeNow() {
    if (glitch && Date.now() < glitch.until) return glitch.value;   // faux signal injecté
    if (sim.enabled) return !!sim.charge;
    const r = readChargeReal();
    return r == null ? true : r;            // illisible → présumer présent (ne jamais endormir par erreur de lecture)
  }
  function ignitionNow() {
    if (sim.enabled && sim.ignition !== null && sim.ignition !== undefined) return !!sim.ignition;
    if (busIgnition.value !== null && (Date.now() - busIgnition.ts) < cfg.ignition.staleMs) return !!busIgnition.value;
    return null;                            // pas d'info ignition fraîche
  }
  function batteryNow() {
    if (sim.enabled && sim.batteryPct != null) return sim.batteryPct;
    const b = readBatteryReal();
    return b == null ? 100 : b;
  }
  // « contact effectif » selon la source préférée (Arduino prioritaire si frais, USB-C en secours)
  function contactNow() {
    const ign = ignitionNow(), chg = chargeNow();
    if (cfg.source === 'usb') return chg;
    if (cfg.source === 'arduino') return ign == null ? chg : ign;
    return ign == null ? chg : ign;         // auto
  }

  /* ─── Anti-rebond ─── */
  let stableContact = null;     // valeur confirmée
  let pendingTarget = null;     // valeur candidate en cours de confirmation
  let pendingSince = 0;
  let consec = 0;

  function feedDebounce(raw, now) {
    if (stableContact === null) { stableContact = raw; return; }
    if (raw !== stableContact) {
      if (pendingTarget !== raw) { pendingTarget = raw; pendingSince = now; consec = 1; }
      else consec++;
      const winMs = raw ? cfg.debounce.onConfirmMs : cfg.debounce.offConfirmMs;
      if ((now - pendingSince) >= winMs && consec >= cfg.debounce.minConsecutiveSamples) {
        stableContact = raw; pendingTarget = null; consec = 0;
        logT(`contact CONFIRMÉ → ${raw ? 'PRÉSENT' : 'ABSENT'}`);
        onStableTransition(raw);
      }
    } else if (pendingTarget !== null) {
      logT(`oscillation ignorée (retour ${raw ? 'présent' : 'absent'} avant confirmation)`);
      pendingTarget = null; consec = 0;     // faux signal : on annule la confirmation en cours
    }
  }

  /* ─── Machine à états ─── */
  let state = S.RUNNING;
  let idleTimer = null;
  let lastSampleAt = Date.now();
  const logBuf = [];

  function logT(msg) {
    const line = `${new Date().toISOString()} [power] ${msg}`;
    if (cfg.log.transitions) console.log(line);
    logBuf.push(line); if (logBuf.length > 300) logBuf.shift();
  }
  function setState(s) { if (s !== state) { logT(`état: ${state} → ${s}`); state = s; } }
  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

  function onStableTransition(present) {
    if (!present) {
      if (state === S.RUNNING || state === S.PENDING) enterIdleWait();
    } else {
      if ([S.PENDING, S.IDLE_WAIT, S.SLEEP, S.HIBERNATE].includes(state)) { clearIdle(); setState(S.RUNNING); screenOn(); }
    }
  }
  function enterIdleWait() {
    clearIdle();
    setState(S.IDLE_WAIT);
    logT(`contact coupé confirmé → IDLE_WAIT (veille dans ${Math.round(cfg.timers.sleepAfterMs / 1000)}s sauf retour)`);
    screenOff();   // contact coupé confirmé → écran éteint (machine toujours active jusqu'à la veille)
    idleTimer = setTimeout(() => { logT('timer de veille expiré'); doSleep(); }, cfg.timers.sleepAfterMs);
  }

  function effectiveDryRun() { return dryRunOverride == null ? !!cfg.actions.dryRun : dryRunOverride; }
  function run(cmd) {
    return new Promise(resolve => {
      if (effectiveDryRun()) { logT(`[dryRun] (commande non exécutée) ${cmd}`); return resolve(true); }
      exec(cmd, (err, _o, se) => { if (err) logT(`ÉCHEC « ${cmd} » : ${(se || err.message || '').trim()}`); resolve(!err); });
    });
  }
  // Écran : extinction/allumage indépendants de la veille (toujours exécutés, non soumis à dryRun :
  // c'est une action sûre et réversible, et c'est le comportement « contact coupé → écran éteint »).
  function execScreen(cmd) {
    if (!cmd) return;
    exec(cmd, (err, _o, se) => { if (err) logT(`écran : échec « ${cmd} » : ${(se || err.message || '').trim()}`); });
  }
  let screenIsOff = false;
  function screenOff() { if (screenIsOff) return; screenIsOff = true; logT('écran → OFF (contact coupé)'); execScreen(cfg.actions.screenOffCmd); }
  function screenOn() { if (!screenIsOff) return; screenIsOff = false; logT('écran → ON'); execScreen(cfg.actions.screenOnCmd); }

  async function doSleep() { clearIdle(); setState(S.SLEEP); logT(`→ mise en veille : ${cfg.actions.sleepCmd}`); await run(cfg.actions.sleepCmd); }
  async function doHibernate() { clearIdle(); setState(S.HIBERNATE); logT(`→ hibernation : ${cfg.actions.hibernateCmd}`); await run(cfg.actions.hibernateCmd); }

  /* ─── Échantillonnage périodique ─── */
  function sample() {
    const now = Date.now();
    // Détection de réveil : un grand trou = process gelé pendant S3/S4 → on repart en RUNNING
    if ((now - lastSampleAt) > cfg.resumeDetectGapMs && (state === S.SLEEP || state === S.HIBERNATE)) {
      logT(`réveil détecté (trou ${now - lastSampleAt}ms)`);
      stableContact = null; pendingTarget = null; setState(S.RUNNING); screenOn();
    }
    lastSampleAt = now;

    const raw = contactNow();
    const batt = batteryNow();
    if (cfg.log.samples) logT(`sample raw=${raw} stable=${stableContact} state=${state} batt=${batt}%`);

    feedDebounce(raw, now);

    // PENDING (affichage de la phase de confirmation) — n'agit pas, le cluster reste affiché
    if (state === S.RUNNING && pendingTarget === false) setState(S.PENDING);
    if (state === S.PENDING && pendingTarget === null && stableContact === true) setState(S.RUNNING);

    // Protection batterie : seuil critique en IDLE_WAIT → hibernation immédiate (sans attendre le timer)
    if (state === S.IDLE_WAIT && batt <= cfg.battery.criticalBelowPct) {
      logT(`batterie critique ${batt}% en IDLE_WAIT → hibernation forcée`); doHibernate();
    }
    // En SLEEP, la bascule S3→S4 sur batterie basse est gérée par systemd (suspend-then-hibernate).
    // En simulation/dryRun (process non gelé), on la reproduit pour pouvoir la tester :
    if (effectiveDryRun() && state === S.SLEEP && batt <= cfg.battery.hibernateBelowPct) {
      logT(`[sim] batterie ${batt}% en SLEEP → bascule HIBERNATE`); doHibernate();
    }
  }

  /* ─── Client bus (IGNITION Arduino sur ws:3001) ─── */
  let ws = null, busTimer = null;
  function connectBus() {
    try {
      ws = new WebSocket(cfg.ignition.busUrl);
      ws.on('open', () => logT(`bus connecté (${cfg.ignition.busUrl}) pour IGNITION`));
      ws.on('message', raw => {
        try { const m = JSON.parse(raw.toString()); const f = cfg.ignition.payloadField;
          if (m && f in m && m[f] != null) busIgnition = { value: !!m[f], ts: Date.now() };
        } catch { /* payload non-JSON ignoré */ }
      });
      ws.on('close', () => { busTimer = setTimeout(connectBus, 3000); });
      ws.on('error', () => { try { ws.close(); } catch {} });
    } catch { busTimer = setTimeout(connectBus, 3000); }
  }

  /* ─── API HTTP ─── */
  router.get('/', (_req, res) => res.json({
    state,
    inputs: { contact: contactNow(), charge: chargeNow(), ignition: ignitionNow(), battery: batteryNow() },
    stableContact,
    pending: pendingTarget !== null ? { target: pendingTarget, sinceMs: Date.now() - pendingSince, consec } : null,
    idleWaitRemainingMs: (state === S.IDLE_WAIT && idleTimer) ? null : undefined,
    sim, dryRun: effectiveDryRun(), source: cfg.source
  }));
  router.get('/log', (_req, res) => res.json({ log: logBuf }));
  router.post('/sim', (req, res) => {
    const b = req.body || {};
    if ('enabled' in b) { sim.enabled = !!b.enabled; logT(`simulation ${sim.enabled ? 'activée' : 'désactivée'}`); }
    if ('charge' in b) { sim.charge = !!b.charge; logT(`[sim] charge=${sim.charge}`); }
    if ('ignition' in b) { sim.ignition = (b.ignition === null) ? null : !!b.ignition; logT(`[sim] ignition=${sim.ignition}`); }
    if ('battery' in b) { sim.batteryPct = +b.battery; logT(`[sim] batterie=${sim.batteryPct}%`); }
    if ('dryRun' in b) { dryRunOverride = (b.dryRun === null) ? null : !!b.dryRun; logT(`dryRun override=${dryRunOverride}`); }
    if (b.glitch) {            // { value:bool, ms:N } → faux signal bref pour tester l'anti-rebond
      glitch = { value: !!b.glitch.value, until: Date.now() + (+b.glitch.ms || 3000) };
      logT(`[sim] glitch charge=${glitch.value} pendant ${glitch.until - Date.now()}ms`);
    }
    res.json({ ok: true, sim, dryRun: effectiveDryRun() });
  });
  router.post('/reload', (_req, res) => { cfg = loadConfig(); res.json({ ok: true, cfg }); });

  /* ─── Démarrage ─── */
  function start() {
    if (!cfg.enabled) { logT('Power Manager DÉSACTIVÉ (config.enabled=false)'); return; }
    sim = { ...cfg.simulation };
    connectBus();
    setInterval(sample, cfg.sampleIntervalMs);
    logT(`démarré · source=${cfg.source} · dryRun=${effectiveDryRun()} · veille après ${Math.round(cfg.timers.sleepAfterMs / 1000)}s · anti-rebond off=${cfg.debounce.offConfirmMs}ms/on=${cfg.debounce.onConfirmMs}ms`);
  }

  return { router, start };
};

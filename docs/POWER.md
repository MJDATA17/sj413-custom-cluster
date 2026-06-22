# POWER — Alimentation & veille (jalon 7)

Gestion de la veille/réveil du ThinkPad L14 selon l'état du **contact véhicule**,
robuste face à une détection de charge **instable**. Implémentation :
`server/power-manager.js` · réglages : `config/power.json` · panneau de test :
section **POWER** du panneau DEV (touche **D**).

## Matériel & principe

- Le L14 est alimenté en permanence par un chargeur **12 V → USB-C PD**. Sa batterie
  interne sert d'**UPS** : aucune coupure brutale.
- **Détection du contact (ACC)**, deux sources, les deux supportées :
  1. **Charge USB-C** lue par le système : `/sys/class/power_supply/AC/online`
     (`1` = charge/contact présent, `0` = absent). Repli : `BAT0/status`.
  2. **IGNITION Arduino** : l'Arduino lit le +12 V après contact et publie
     `ignition: true/false` dans le payload du **bus ws:3001**. Source plus fiable.
  - Priorité (`source: auto`) : Arduino si frais (< `staleMs`), sinon charge USB-C.
- **Réveil matériel** : BIOS **« Power On with AC »** activé → le L14 redémarre/réveille
  dès que le 12 V revient.

## ⚠️ Anti-rebond (non optionnel)

La charge USB-C n'est pas fiable instant par instant (micro-coupures, faux contacts,
vibrations, démarrage moteur). On ne réagit **jamais** à l'état brut :

- Échantillonnage toutes les `sampleIntervalMs` (déf. 1,5 s).
- Un changement n'est validé qu'après une **fenêtre de confirmation stable** ET un nombre
  minimum de lectures cohérentes (`minConsecutiveSamples`) :
  - perte (présent → absent) : `debounce.offConfirmMs` (déf. **9 s**) ;
  - retour (absent → présent) : `debounce.onConfirmMs` (déf. **2 s**, court = réveil réactif).
- Toute oscillation **réinitialise** la confirmation : une coupure brève < 9 s **n'endort pas**,
  un retour bref < 2 s ne relance pas la logique.

## Machine à états

| État | Description |
|---|---|
| `RUNNING` | Contact mis, cluster actif. |
| `IGNITION_OFF_PENDING` | Perte de charge **brute** détectée, confirmation en cours (cluster **toujours affiché**). |
| `IDLE_WAIT` | Contact confirmé coupé : compte à rebours `timers.sleepAfterMs` (déf. **15 min**) avant veille (cluster affiché — les arrêts courts n'endorment pas). |
| `SLEEP` | Veille S3 (`suspend-then-hibernate`). |
| `HIBERNATE` | Hibernation S4 (zéro conso). |

Transitions :

- `RUNNING → IGNITION_OFF_PENDING` : perte brute → démarre l'anti-rebond.
- `PENDING → RUNNING` : la charge revient avant `offConfirmMs` → **faux signal ignoré**.
- `PENDING → IDLE_WAIT` : absence **confirmée**.
- `IDLE_WAIT → RUNNING` : la charge revient (confirmée en `onConfirmMs`) → **réveil quasi instantané**.
- `IDLE_WAIT → SLEEP` : `sleepAfterMs` écoulés.
- `IDLE_WAIT → HIBERNATE` : batterie ≤ `battery.criticalBelowPct` → hibernation **forcée**.
- `SLEEP → RUNNING` : réveil matériel (12 V revient) — détecté au resume du process.
- `SLEEP → HIBERNATE` : **géré par systemd** (`suspend-then-hibernate`), car le process Node
  est gelé en S3 et ne peut pas surveiller la batterie lui-même.

## Comportements attendus

- **Arrêt court** (feu rouge, ravitaillement, redémarrage moteur) : reste en `RUNNING` ou
  au plus `IDLE_WAIT` — jamais de veille intempestive.
- **Arrêt long** (contact coupé > 15 min) : `IDLE_WAIT → SLEEP`, puis `SLEEP → HIBERNATE`
  après un délai / sur batterie basse.
- **Batterie basse** : hibernation anticipée (forcée en `IDLE_WAIT`, déléguée à systemd en `SLEEP`).
- **Contact remis** : réveil immédiat (matériel en S3/S4, logique en `IDLE_WAIT`).

## `config/power.json`

Tous les délais/seuils sont configurables (jamais codés en dur). Rechargeable à chaud via
`POST /api/power/reload`. Clés principales :

- `source` : `auto | arduino | usb`.
- `sampleIntervalMs`, `debounce.{offConfirmMs,onConfirmMs,minConsecutiveSamples}`.
- `ignition.{busUrl,payloadField,staleMs}`.
- `charge.{onlinePath,batteryStatusPath}`, `battery.{capacityPath,hibernateBelowPct,criticalBelowPct}`.
- `timers.sleepAfterMs`.
- `actions.{sleepCmd,hibernateCmd,dryRun}` — `dryRun:true` journalise au lieu d'exécuter (tests).
- `simulation.{enabled,charge,ignition,batteryPct}`, `resumeDetectGapMs`, `log.{transitions,samples}`.

## Simulation / test (sans matériel)

Panneau **DEV → POWER** (touche D) ou API `POST /api/power/sim` :

- `{ "enabled": true }` active la simulation (ignore `/sys`).
- `{ "charge": true|false }`, `{ "ignition": true|false|null }`, `{ "battery": 14 }`.
- `{ "glitch": { "value": false, "ms": 3000 } }` : faux signal bref → **vérifier qu'il
  n'endort PAS** (l'état reste `RUNNING`/`PENDING`, ne passe pas `IDLE_WAIT`).
- `{ "dryRun": true }` : n'exécute pas réellement la veille (pour tester la FSM en place).

État en direct : `GET /api/power` · journal : `GET /api/power/log`.

Scénario de validation type :
1. `SIM on`, `Contact ON` → `RUNNING`.
2. `Glitch 3s` (coupure brève) → passe `IGNITION_OFF_PENDING` puis **revient `RUNNING`** (faux signal ignoré).
3. `Contact OFF` → après `offConfirmMs` → `IDLE_WAIT`.
4. `Contact ON` avant 15 min → retour `RUNNING` (réveil instantané).
5. `Contact OFF` puis `Batt 5%` → hibernation forcée.

## Déploiement Debian (L14)

- **Hibernation (S4)** : nécessite un swap ≥ RAM + `resume=`. Sur ce boîtier :
  `/swapfile` 10 Go (`/etc/fstab`), `resume=UUID=<rootfs> resume_offset=<offset>` sur la
  ligne de commande noyau (`/etc/default/grub`) + `RESUME=` dans
  `/etc/initramfs-tools/conf.d/resume`, puis `update-initramfs -u` + `update-grub`.
- **suspend-then-hibernate** : `/etc/systemd/sleep.conf` → `HibernateDelaySec` ; systemd 252
  bascule aussi en S4 quand la batterie devient basse pendant la veille.
- **BIOS** : activer **« Power On with AC »** pour le réveil au retour du 12 V.
- **Permissions** : le serveur (service `cluster.service`, user `sj413`) déclenche la veille
  via `sudo systemctl suspend-then-hibernate|hibernate` (sudo NOPASSWD).
- **Câblage ACC** (option Arduino) : lire le +12 V après contact (diviseur de tension vers une
  entrée Arduino), envoyer `ignition:true/false` dans le payload ws:3001.

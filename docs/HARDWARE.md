# Matériel & câblage (jalon 8)

> Stub. À détailler lors de la phase capteurs réels.

## Cible
- **Cerveau** : ThinkPad L14, Debian 12 + Openbox + Chromium kiosk.
- **Écran** : Prechen 10.3" **1920×720** IPS tactile (8:3).
- **Entrée** : tactile + combo pavé numérique/trackpad USB (touches remappables).

## Capteurs (couche ACQUISITION en PROD)
| Grandeur | Source | Interface |
|---|---|---|
| Vitesse | GPS u-blox USB | serial (jauge uniquement ; la nav a son GPS) |
| RPM | pulse bobine d'allumage | Arduino Nano — `RPM = freq × 60 / 2` (4 cyl. 4 temps) |
| Carburant | sonde résistive réservoir | ADS1115 I²C (ohms → %, à calibrer) |
| Température | sonde NTC culasse | ADS1115 I²C (courbe à calibrer) |

Le pont capteurs PROD doit diffuser le **même payload** que `sim/fake-vehicle.js`
sur `ws://localhost:3001` (voir README). Constantes dans `config/sensors.json`.

## Alimentation
12V → USB-C PD ; batterie L14 = UPS. Veille/réveil : voir `docs/POWER.md`.

# ARDUINO — Hub capteurs (firmware + pont série)

L'Arduino Nano (CH340, USB série, `/dev/ttyUSB0` sous Debian) est le **hub capteurs unique** :
il lit RPM / carburant / température / contact et les envoie au L14 en JSON série. Le L14 ne
lit jamais les capteurs directement — il écoute l'Arduino (`server/serial-bridge.js`).
Calibration véhicule détaillée : voir **CALIBRATION** (courbes des sondes).

- Firmware : `firmware/cluster_sensors/cluster_sensors.ino`
- Pont série L14 : `server/serial-bridge.js` (+ courbes `server/sensors-cal.js`, `config/sensors.json`)
- Moniteur de test : `scripts/serial-monitor.js`

## Deux modes (constante `USE_ADS1115` en tête du sketch)

| Mode | `USE_ADS1115` | Carburant / Température | Dispo |
|---|---|---|---|
| **A — dégradé** | `0` | ADC natif Arduino **10 bits** (A0/A1) | tout de suite (sans ADS1115) |
| **B — complet** | `1` | **ADS1115** I²C **16 bits** (A0/A1 de l'ADS) | plus tard |

RPM et ACC sont **identiques** dans les deux modes. **Le format série et le code L14 ne
changent pas** : seul l'Arduino change sa source. On bascule en changeant la constante et en reflashant.

## Câblage (rappels)

| Signal | Entrée | Câblage |
|---|---|---|
| **RPM** | **D2** (INT0) | bobine(−) → **PC817 OBLIGATOIRE** (R_limite 10 k côté bobine) → collecteur sur D2 (`INPUT_PULLUP`), émetteur → GND. ⚠️ Jamais la bobine en direct (pics 200–400 V). |
| **Carburant** | A0 (mode A) / ADS-A0 (B) | `5V ─ [100 Ω] ─┬─ sonde ─ GND`, point milieu → entrée. |
| **Température** | A1 (mode A) / ADS-A1 (B) | `5V ─ [1 kΩ] ─┬─ sonde NTC (1 fil) ─ masse moteur`, point milieu → entrée. |
| **Contact (ACC)** | **A2** (toujours natif) | `+12V IGN ─ [10k] ─┬─ [4,7k] ─ GND`, point milieu (~3,8 V) → A2. Seuil 1,5 V. |
| **ADS1115** (mode B) | A4=SDA, A5=SCL | adresse `0x48` (ADDR→GND). PGA ±6,144 V (lit jusqu'à 5 V). |

**Masses communes obligatoires** : GND Arduino = masse châssis/moteur = GND ADS1115.

## Format série (Arduino → L14, ~10 Hz, 115200 baud, `\n`)

```json
{"rpm":2480,"fuel_raw":612,"fuel_ohm":48.2,"temp_raw":340,"temp_ohm":360.0,"ign":1,"st":7,"ms":123456}
```

- `*_raw` = lecture ADC brute (0–1023 mode A, 0–32767 mode B) — debug/calibration.
- `*_ohm` = résistance sonde calculée depuis le pont diviseur (Arduino).
- `ign` = contact (0/1, seuil sur A2). `ms` = `millis()` (détection de déconnexion côté L14).
- `st` = bitmask de validité : bit0 carburant, bit1 température, bit2 RPM/système. Si une lecture
  échoue (mode B, I²C), l'Arduino renvoie la **dernière valeur valide** et met le bit à 0.

⚠️ L'Arduino envoie du **brut** ; les courbes **ohms→% / ohms→°C** sont appliquées **côté L14**
(`config/sensors.json`) → recalibrage **sans reflasher**.

## Flasher l'Arduino

1. Ouvrir `firmware/cluster_sensors/cluster_sensors.ino` dans l'IDE Arduino.
2. Carte : *Arduino Nano* · Processeur : *ATmega328P* (ou *Old Bootloader* selon le clone CH340).
3. Vérifier `USE_ADS1115` (0 pour l'instant), port `/dev/ttyUSB0`, puis **Téléverser**.
4. Aucune bibliothèque externe requise (le mode B embarque un mini-pilote ADS1115 via `Wire`).

## Tester (sans les vraies sondes)

- **Potentiomètres** : brancher un potard 10 k entre 5V et GND, le curseur sur A0 (carburant)
  et un autre sur A1 (température). Tourner → `fuel_ohm`/`temp_ohm` varient → la jauge bouge.
- **Moniteur** : `node scripts/serial-monitor.js /dev/ttyUSB0 115200`
  → affiche le JSON brut + `% carburant` et `°C` convertis (vérifie câblage + calibration).
- **RPM** : injecter un signal carré sur l'entrée du PC817 (ou un GBF basse fréquence) ;
  `rpm` doit suivre (`RPM = imp/s × 60 / 2`).

## Basculer simulateur ↔ Arduino (côté L14)

Variable d'environnement **`DATA_SOURCE`** (`.env`) :

- `DATA_SOURCE=sim` (défaut) : valeurs moteur simulées.
- `DATA_SOURCE=serial` : valeurs moteur **réelles** depuis l'Arduino (`SERIAL_DEVICE`,
  `SERIAL_BAUD`). **Fallback automatique** sur le simulateur si l'Arduino est absent ou muet
  (> 2 s sans trame), et **reconnexion auto** au rebranchement.

Le front (jauges, alertes) ne voit **aucune différence** entre simulateur et Arduino réel :
même bus `ws://localhost:3001`, même payload `{speed,rpm,fuel,fuel_ohm,temp,temp_raw,gps_*,ignition,ts}`.
La **vitesse** vient du GPS (jamais de l'Arduino) ; `ignition` réel alimente le Power Manager.

Sur le boîtier, ajouter à `.env` :
```
DATA_SOURCE=serial
SERIAL_DEVICE=/dev/ttyUSB0
SERIAL_BAUD=115200
```
puis `sudo systemctl restart cluster.service`. Vérifier : `journalctl -u cluster.service | grep serial`.

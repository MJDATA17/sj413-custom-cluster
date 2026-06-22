<div align="center">

# 🚙 MJ Data · Cluster numérique SJ413

### Un tableau de bord 100 % custom pour un **Suzuki Samurai SJ413 de 1987**

*Compteur, navigation temps réel, radars, Spotify et skins — le tout dans un écran 8:3
caché derrière le cache plastique d'origine.*

![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![WebSocket](https://img.shields.io/badge/Transport-WebSocket-010101?logo=socketdotio&logoColor=white)
![Leaflet](https://img.shields.io/badge/Carte-Leaflet%20%2F%20OSM-199900?logo=leaflet&logoColor=white)
![Spotify](https://img.shields.io/badge/Audio-Spotify%20PKCE-1DB954?logo=spotify&logoColor=white)
![Résolution](https://img.shields.io/badge/Cible-1920%C3%97720%20(8%3A3)-ff4081)
![License](https://img.shields.io/badge/License-MIT-blue)

</div>

---

## 🧭 C'est quoi ?

Le SJ413 de 1987 n'a jamais eu d'écran. Ce projet en pose un — un **vrai cluster numérique**
qui remplace le combiné d'instruments d'origine, pensé pour un écran ultra-large **Prechen 10.3″
(1920×720, ratio 8:3)** glissé derrière le cache plastique du tableau de bord.

L'astuce du projet : **le même code tourne sur ton PC et dans la voiture.** Tu développes,
testes et calibres tout sur Windows avec un simulateur de capteurs, puis tu déploies tel quel
sur un ThinkPad embarqué (Debian + Chromium en kiosque). Seule la *source* des données change —
le simulateur cède la place à l'Arduino/GPS réels, qui parlent exactement le même protocole.

> **🎯 Conçu pour être testé sur PC dès maintenant.** Pas besoin de la voiture, du GPS ni du
> moindre capteur : `npm run dev` et tout s'anime avec des données simulées réalistes.

---

## ✨ Fonctionnalités

| | |
|---|---|
| 🎛️ **Compteur live** | Vitesse, régime, jauge essence (Ω), température (avec alertes surchauffe / réserve / redline), rendu Canvas fluide. |
| 🗺️ **Navigation réelle** | Carte Leaflet (tuiles sombres OSM/CARTO, **cap-en-haut**), géocodage **Nominatim**, calcul d'itinéraire **OSRM**, guidage voie par voie. |
| 🚨 **Radars data.gouv** | Alerte de proximité, affichage de la VMA, détection de survitesse + **alertes vocales**. |
| 🎵 **Spotify intégré** | OAuth 2.0 **PKCE côté serveur** (le token ne quitte JAMAIS le serveur), lecteur plein écran, playlists, recherche, file d'attente. Mode démo sans clés. |
| 🎨 **Skins** | Plusieurs thèmes visuels (`mjdata`, `tva`, `cyberpunk`), changeables à chaud, importables. |
| 🛠️ **Calibration in-situ** | Déplacement/redimensionnement des éléments au pixel près, depuis l'écran tactile, persisté côté serveur. |
| ⌨️ **Clavier circulaire** | Saisie tactile + autocomplétion d'adresses, repositionnable selon le contexte. |
| 🧪 **Simulateur de capteurs** | 6 scénarios (`idle / city / highway / cold_start / overheat / low_fuel`) pilotables au clavier. |

---

## 🚀 Démarrage rapide (PC / Windows)

```bash
git clone https://github.com/MJDATA17/sj413-custom-cluster.git
cd sj413-custom-cluster        # (= dossier mjdata-cluster)
npm install
npm run dev                    # lance le simulateur (ws:3001) + le serveur web (:3000)
```

Puis ouvre **http://127.0.0.1:3000** dans Chrome.
*(Utilise `127.0.0.1` et non `localhost` — requis pour le callback Spotify.)*

Ou en deux terminaux séparés :

```bash
npm run sim     # simulateur de capteurs  → ws://localhost:3001
npm start       # serveur web             → http://localhost:3000
```

Raccourci Windows : **`scripts\start-sim.bat`** (ouvre tout + le navigateur).

> 💡 **Spotify et radars fonctionnent sans configuration** : Spotify démarre en mode démo
> tant que `.env` n'a pas de clés, et un échantillon de radars (Charente-Maritime) est fourni.

### 👀 Juste voir les maquettes ?

Aucune installation : ouvre directement les prototypes statiques dans
[`design-prototypes/`](design-prototypes/) (compteur, nav+musique, clavier, skin TVA).

---

## ⌨️ Commandes

| Touche | Action |
|:---:|---|
| **D** | Panneau DEV — changer de scénario, déclencher surchauffe / réserve / redline |
| **F** | Plein écran |
| **G** | Cycle d'ajustement (contain / 100 % / largeur) |
| **S** *(ou appui long)* | Ouvrir les Paramètres |

**Interactions tactiles :**
- Toucher la **tuile d'instruction** (nav) → clavier circulaire + autocomplétion → calcule l'itinéraire et lance le guidage.
- Bouton **haut-parleur** (nav) → active/coupe les alertes vocales (manœuvres + radars).
- Toucher le **mini-bandeau musique** → lecteur Spotify plein écran.

---

## 🏗️ Architecture

Découplage strict en trois couches. **Le front est identique en simulation et en production** ;
seul ce qui émet sur `ws://…:3001` change.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ACQUISITION   sim/fake-vehicle.js  (SIM, PC)   │  Arduino+ADS1115+GPS (PROD)  │
│                    │                                                          │
│                    │  WebSocket JSON  ws://localhost:3001  (même payload)     │
│                    ▼                                                          │
│ TRANSPORT     server/index.js   (Express · sert l'app · proxys API)           │
│                    │                                                          │
│                    ▼                                                          │
│ AFFICHAGE     public/   (Canvas + Leaflet, Chromium kiosk 1920×720)           │
└────────────────────────────────────────────────────────────────────────────┘
```

**Payload diffusé sur `ws://localhost:3001` :**

```json
{ "speed": 0, "rpm": 850, "fuel": 72, "fuel_ohm": 62.5, "temp": 85, "temp_raw": 18000,
  "gps_lat": 45.94, "gps_lon": -0.96, "gps_fix": true, "scenario": "idle", "ts": 0 }
```

---

## 📁 Structure

```
sim/        fake-vehicle.js — 6 scénarios, émet sur ws:3001 · fake-gps-route.js
server/     index.js (Express + API layout/settings/skins) · spotify.js (OAuth PKCE)
            geocode.js (Nominatim) · route.js (OSRM) · radars.js (CSV /near)
public/     index.html (1920×720) · css/ · js/ (bus, cluster, nav, keyboard, music, app…)
            vendor/leaflet/
config/     layout.json (positions) · sensors.json (calibration) · settings.json (skin actif)
skins/      mjdata/ · tva/ · cyberpunk/   (skin.json)
data/       radars.csv (échantillon Charente-Maritime)
scripts/    start-sim.bat/.sh · download-radars.sh
docs/       HARDWARE · CALIBRATION · POWER · DEPLOY-DEBIAN · SPOTIFY · SKINS
design-prototypes/   maquettes HTML statiques (ouvrir dans un navigateur)
```

> 🔐 **Non versionnés** (voir `.gitignore`) : `.env`, `config/certs/` (cert HTTPS auto-signé),
> `config/spotify-tokens.json` (refresh token). Copie `.env.example` → `.env` pour configurer.

---

## ⚙️ Stack technique

- **Backend** — Node.js (≥18), Express, `ws` (WebSocket), dotenv. Zéro build, zéro framework front.
- **Front** — Vanilla JS + Canvas 2D pour les jauges, **Leaflet** + tuiles OSM/CARTO pour la carte.
- **APIs** — Spotify Web API (OAuth PKCE), Nominatim (géocodage), OSRM (routing), radars data.gouv.
- **Cible prod** — ThinkPad L14 · Debian 12 · Chromium kiosk · capteurs Arduino Nano + ADS1115 + GPS u-blox.

---

## 🗺️ Roadmap

| Jalon | État |
|---|:---:|
| **1** — Squelette + serveur + simulateur + 3 designs intégrés (1920×720) | ✅ |
| **5** — Spotify (OAuth PKCE serveur, lecteur / playlists / recherche / file) | ✅ |
| **6** — Nav réelle (Leaflet/CARTO, OSRM, Nominatim, radars data.gouv, voix) | ✅ |
| **Module** — Skins + Paramètres + Calibration in-situ | ✅ |
| **7** — Power / veille simulable (USB-C = contact, timer → S3, batterie faible → S4, Wake-on-AC) | ⏳ |
| **8** — Déploiement Debian kiosk + pont capteurs réels + calibration matérielle | ⏳ |

Détails techniques et procédures dans [`docs/`](docs/) · suivi complet dans
[`PROJECT-STATE.md`](PROJECT-STATE.md).

---

## 📜 Licence

[MIT](LICENSE) — fais-en ce que tu veux.

<div align="center">

**Fait avec passion pour un Samouraï de 1987 🐐**

</div>

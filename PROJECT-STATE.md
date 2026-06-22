# MJ Data Cluster — état du projet (reprise)

> Fichier de passation pour reprendre le travail. Dernière mise à jour : pause demandée par l'utilisateur.
> Projet : tableau de bord numérique custom pour **Suzuki Samurai SJ413 (1987)**, cible **1920×720 en dur**,
> déploiement final sur ThinkPad L14 / Debian / Chromium kiosk, derrière le cache plastique d'origine.

## Emplacements
- Code : `C:\Users\mjdat\Documents\sj413\mjdata-cluster\`
- Références design (parent `sj413\`, NE PAS réinventer, reprendre leur code) :
  `01-cluster-jauges.html`, `02-nav-musique.html`, `03-clavier.html`, `04-skin-tva.html`
- Specs : `PROMPT-CLAUDE-CODE.md` (principal), `PROMPT-SETTINGS-CALIBRATION.md` (module skins/calibration)

## Lancer
```bash
cd mjdata-cluster
npm install
npm run dev        # sim (ws:3001) + serveur (http:3000, https callback:3443)
# ouvrir http://127.0.0.1:3000   (127.0.0.1, PAS localhost — cf. Spotify)
```
Touches : **D** = panneau scénarios sim · **F** = plein écran · **G** = fit · **S** ou appui long = Paramètres.

## Architecture (couches — code identique sim↔prod, seule la source change)
```
ACQUISITION  sim/fake-vehicle.js (ws:3001)  |  PROD: Arduino+ADS1115+GPS sur ws:3001
   │ JSON {speed,rpm,fuel,fuel_ohm,temp,temp_raw,gps_lat,gps_lon,gps_fix,scenario,ts}
TRANSPORT    server/index.js (Express http:3000 ; + https:3443 dédié callback Spotify)
AFFICHAGE    public/ (vanilla JS + Canvas + Leaflet) — Chromium kiosk
```

## ⚠️ Gotchas importants
- **Tout changement dans `server/*.js` exige un REDÉMARRAGE du serveur** (modules Node en cache).
  Le front (`public/`) se recharge avec **Ctrl+R**.
- Vérif visuelle headless via **Chrome DevTools Protocol** : lancer chrome
  `--headless=new --remote-debugging-port=9222`, lister `http://localhost:9222/json`,
  `Runtime.evaluate` puis `Page.captureScreenshot` (permet de cliquer/ouvrir des overlays avant capture).
  Chrome : `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Pour libérer les ports avant relance : `Get-NetTCPConnection -LocalPort 3000,3443,9222 ... | Stop-Process`.
- **Globals JS** : les modules sont des `const` IIFE → ne s'attachent PAS à `window`.
  `Settings`/`Calibration` sont exposés explicitement (`window.Settings = …`). Y penser pour les checks `window.X`.

## État des jalons
| Jalon | État |
|---|---|
| 1 — Squelette + serveur + sim + 3 designs intégrés 1920×720 | ✅ |
| 5 — Spotify (OAuth PKCE serveur, lecteur/playlists/recherche/file) | ✅ branché en réel |
| 6 — Nav réelle (Leaflet/CARTO, OSRM, Nominatim, radars data.gouv, voix) | ✅ |
| Module — Skins (mjdata/TVA) + Paramètres + Calibration in-situ + import/suppression | ✅ (A+B) |
| **7 — Power/veille simulable** (USB-C, timer 15min→S3, <15%→S4, Wake-on-AC) | ⏳ À FAIRE |
| **8 — Déploiement Debian kiosk + HARDWARE + CALIBRATION capteurs** (pont Arduino/ADS1115/GPS sur ws:3001) | ⏳ À FAIRE |

## Carte des fichiers
```
sim/        fake-vehicle.js (6 scénarios: idle/city/highway/cold_start/overheat/low_fuel ; cmds scenario/set/clear/pulse)
            fake-gps-route.js (stub — la nav suit la route OSRM choisie)
server/     index.js (statique + /api/layout GET+POST + /api/settings GET+POST + /api/skins GET+import+DELETE + https callback)
            spotify.js (OAuth PKCE, proxy Web API) · geocode.js (Nominatim+favoris+fallback) · route.js (OSRM) · radars.js (CSV /near)
public/js/  bus.js (ws:3001) · cluster.js (render_style mjdata/tva_crt) · nav.js (Leaflet) · keyboard.js (générique, déplaçable)
            music.js (Spotify controller) · skins.js · settings.js · calibration.js · app.js (orchestrateur, window.App)
public/css/ app · cluster · nav · keyboard · music · skin · settings .css
config/     layout.json (positions calibrées) · sensors.json (calibration capteurs) · settings.json (skin actif+affichage)
            certs/ (cert auto-signé https, GITIGNORÉ) · spotify-tokens.json (GITIGNORÉ)
skins/      mjdata/skin.json · tva/skin.json
data/       radars.csv (échantillon Charente-Maritime)
docs/       HARDWARE · CALIBRATION · POWER · DEPLOY-DEBIAN · SPOTIFY · SKINS .md
.env (GITIGNORÉ, contient client_id Spotify) · .env.example
```

## Spotify — état & limites (IMPORTANT)
- Configuré en réel : `.env` contient `SPOTIFY_CLIENT_ID`, compte **Premium**.
- **Callback en HTTPS** (Spotify refuse http) : serveur écoute aussi en https sur **:3443** (cert auto-signé
  `config/certs/`). App+bus restent en http (évite mixed-content sur ws:3001).
  `SPOTIFY_REDIRECT_URI=https://127.0.0.1:3443/spotify/callback` (déclaré À L'IDENTIQUE dans le dashboard Spotify),
  `APP_URL=http://127.0.0.1:3000`. Token persistant `config/spotify-tokens.json`.
- **Limitation Spotify dev-mode** : `GET /playlists/{id}/tracks` → **403**, l'objet playlist arrive sans `tracks`.
  Impossible de lister les titres d'une playlist. CE QUI MARCHE : `/me/playlists`, `/me/tracks` (likés),
  `/search`, lecture par `context_uri`, contrôle. **Contournement en place** : taper une playlist la LANCE
  (context_uri) ; carte « Titres likés » pour des titres jouables un par un ; cliquer un titre joue la LISTE
  (uris+offset) → « suivant » et la file fonctionnent.
- La **lecture exige un appareil actif** : en dev, ouvrir open.spotify.com / app Spotify ; en prod = librespot.

## Décisions UI (issues des itérations avec l'utilisateur — cache « pneu crevé » rogne le BAS des cercles)
- **Spotify déplacé sur le COMPTEUR (gauche)** : mini-bandeau en bas du compteur (à la place de MJ DATA, retiré) ;
  lecteur plein écran couvre le compteur. La **NAV (droite) n'est jamais masquée** (vitesse déjà affichée sur la nav).
- Bouton retour musique = pastille **« ↺ COMPTEUR »** (`.mf-return`), remplace l'ancien bandeau direction GPS
  (supprimé → références `mns-dist`/`mns-street` sécurisées en `(el||{}).textContent`).
- **Clavier déplaçable** : `Keyboard.open({host})` — recherche Spotify → `#el-speedo .el-content` (gauche),
  sinon `.nav-circle` (droite, destination nav).
- **Indications de file (`.lanes`) masquées** (`display:none`) — se superposaient ; la manœuvre (incl. rond-point)
  reste dans l'encart du haut.
- **Carte nav décalée vers le bas** (`#nav-map top:-40`) → véhicule sous le centre, plus de route devant ;
  rotation cap-en-haut pivote autour du véhicule. Zoom d'approche en **scale CSS** (pas Leaflet → pas de reload tuiles).
- Éléments nav remontés + textes agrandis (cache rogne le bas). Marges Spotify augmentées (padding 122).
- **Persistance = fichiers serveur** (PAS de localStorage) : `config/layout.json`, `config/settings.json`.

## Calibration in-situ (rappel interaction)
Paramètres → Calibration → toucher un élément → **le module opposé devient la télécommande** (flèches 1px / +−taille /
pas 1-10px / px+mm live / élément suivant / enregistrer→POST layout). Sélection croisée rebascule le panneau.

## Reste à faire (prochaine session)
1. **Jalon 7 — Power/veille simulable** : détection charge USB-C (=contact), timer 15 min → veille (S3),
   <15% batterie → hibernation (S4), Wake-on-AC. Simuler sur PC (boutons contact ON/OFF + niveau batterie).
   Doc `docs/POWER.md` (stub à compléter).
2. **Jalon 8 — Déploiement Debian** : `docs/DEPLOY-DEBIAN.md` (kiosk 1920×720, autostart, tethering, espeak,
   tuiles/OSRM offline), pont capteurs réels (Arduino Nano serial + ADS1115 I²C + GPS u-blox) diffusant le MÊME
   payload sur ws:3001, `docs/HARDWARE.md` + calibration capteurs (`config/sensors.json`).
3. Peaufinage écran restant avec le cache physique posé (ajuster marges/positions au besoin).

## Runtime au moment de la pause
- Serveur + sim lancés en arrière-plan (scénario `city`). Skin actif : `mjdata`.
- Git : projet non commité (aucun commit demandé jusqu'ici).

# Déploiement Debian kiosk (jalon 8)

> Stub. Cible : ThinkPad L14, Debian 12 + Openbox + Chromium kiosk, écran 1920×720.

## Affichage 1920×720
- Forcer la résolution via `xrandr` (mode 1920×720) dans l'autostart Openbox.
- Chromium kiosk :
  ```bash
  chromium --kiosk --app=http://localhost:3000 \
    --window-size=1920,720 --window-position=0,0 \
    --disable-pinch --overscroll-history-navigation=0
  ```

## Autostart
- systemd user services ou `~/.config/openbox/autostart` : pont capteurs, serveur
  web, librespot, Chromium.

## Réseau
- Modem 4G du L14 HS → **tethering téléphone (USB/WiFi)** comme source par défaut.
  Spotify et Nominatim en dépendent.

## Tactile
- Calibrer l'écran tactile (xinput / libinput), désactiver l'économiseur et le
  curseur (`unclutter`).

## Navigation hors-ligne (jalon 6)
- **Leaflet** est déjà vendorisé en local (`public/vendor/leaflet/`).
- **Tuiles** : en ligne via CARTO/OSM. Pour l'offline région Charente-Maritime,
  pré-télécharger les tuiles (z 8→16) dans `public/tiles-cache/` et pointer le
  `L.tileLayer` dessus (ex. via `tilemaker`/`mbtiles` + serveur de tuiles local).
- **Routing/géocodage** : OSRM et Nominatim publics par défaut. Pour l'offline,
  self-host OSRM (extrait .osm.pbf région) + Nominatim, puis renseigner
  `OSRM_URL` / `NOMINATIM_URL` dans `.env`.
- **Alertes vocales** : le front utilise l'API Web Speech (dev/PC). En kiosk,
  installer **espeak-ng** et router la synthèse via un petit binôme (ou activer
  la voix Chromium). `sudo apt install -y espeak-ng`.

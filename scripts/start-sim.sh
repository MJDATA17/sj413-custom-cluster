#!/usr/bin/env bash
# start-sim.sh — lance le simulateur + le serveur web (dev Linux/Debian).
# En prod kiosk, on remplace `node sim/fake-vehicle.js` par le pont capteurs réel.
set -e
cd "$(dirname "$0")/.."

echo "[MJ Data] Démarrage simulateur (ws:3001) + serveur web (:3000)…"
node sim/fake-vehicle.js &
SIM_PID=$!
node server/index.js &
WEB_PID=$!

trap "echo '[MJ Data] Arrêt…'; kill $SIM_PID $WEB_PID 2>/dev/null" INT TERM EXIT

# Lancement Chromium kiosk en 1920×720 (décommenter sur la cible Debian) :
# chromium --kiosk --app=http://localhost:3000 \
#   --window-size=1920,720 --window-position=0,0 \
#   --disable-pinch --overscroll-history-navigation=0 &

wait

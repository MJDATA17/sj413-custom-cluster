@echo off
REM start-sim.bat — lance le simulateur + le serveur web (dev Windows).
REM Ouvre ensuite http://localhost:3000 dans le navigateur.
cd /d "%~dp0\.."
echo [MJ Data] Demarrage simulateur + serveur...
start "MJ Data SIM" cmd /k "node sim\fake-vehicle.js"
timeout /t 1 >nul
start "MJ Data WEB" cmd /k "node server\index.js"
timeout /t 2 >nul
start "" http://localhost:3000
echo [MJ Data] Pret. Ferme les deux fenetres pour arreter.

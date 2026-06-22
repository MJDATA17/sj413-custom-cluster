#!/usr/bin/env bash
# download-radars.sh — télécharge la base officielle des radars fixes (data.gouv).
#
# Dataset : « Radars » / sécurité routière sur data.gouv.fr. L'URL de la ressource
# CSV change parfois ; surcharge-la via RADARS_URL si besoin. Le parseur serveur
# (server/radars.js) détecte les colonnes par nom, donc tolère les variantes.
#
# En cas d'échec, l'échantillon Charente-Maritime déjà présent est conservé.
set -e
cd "$(dirname "$0")/.."
mkdir -p data
OUT="data/radars.csv"
TMP="data/radars.download.csv"

# Ressource data.gouv (modifiable). Voir https://www.data.gouv.fr/fr/datasets/radars-automatiques/
URL="${RADARS_URL:-https://www.data.gouv.fr/fr/datasets/r/8a22b5a8-4b6a-4c0a-... }"

echo "[radars] tentative de téléchargement depuis : $URL"
if curl -fsSL -m 30 "$URL" -o "$TMP" 2>/dev/null; then
  # validation minimale : présence de colonnes lat/lon
  if head -1 "$TMP" | grep -qiE 'lat|latitude' && [ "$(wc -l < "$TMP")" -gt 5 ]; then
    mv "$TMP" "$OUT"
    echo "[radars] OK → $OUT ($(wc -l < "$OUT") lignes)"
  else
    rm -f "$TMP"
    echo "[radars] fichier invalide (colonnes lat/lon absentes) — échantillon conservé."
  fi
else
  rm -f "$TMP"
  echo "[radars] téléchargement impossible — échantillon conservé ($OUT)."
  echo "[radars] renseigne l'URL réelle : RADARS_URL=... bash scripts/download-radars.sh"
fi

# Calibration

Deux calibrations distinctes :
1. **Positionnement des éléments à l'écran** (in-situ, casquette posée) — section A.
2. **Calibration des capteurs** (valeurs physiques) — section B.

---

## A. Calibration in-situ des éléments (derrière le cache du Samurai)

Objectif : caler chaque élément (compteur, jauge carburant, jauge température, nav)
EXACTEMENT derrière les ouvertures du cache plastique, en manipulant directement sur
l'écran réel **avec la casquette posée dessus**. Le code ne devine jamais les positions.

### Procédure
1. Ouvrir **Paramètres** (appui long sur une zone neutre de l'accueil, ou touche **S**).
2. Section **Calibration jauges** › **Entrer en mode calibration**.
3. Les éléments s'affichent à leur position actuelle sur fond neutre.
4. **Toucher un élément** → il est sélectionné (léger surlignage teal). **Le panneau de
   contrôle apparaît du côté OPPOSÉ** (élément à gauche → panneau à droite, et inversement),
   pour ne jamais être masqué par la casquette que l'on règle.
5. Avec le panneau :
   - **flèches ↑ ↓ ← →** : déplacer de 1 px (appui maintenu = déplacement continu accéléré) ;
   - **+ / −** : taille (scale uniforme — tout le contenu, chiffres compris) ;
   - **PAS 1 px / 10 px** : dégrossir puis affiner ;
   - lecture live **X / Y / taille en px ET en mm** (1920 px = 243,6 mm de large) ;
   - **Élément suivant** : passer au composant suivant sans repasser par l'accueil.
6. **Sélection croisée** : toucher un autre élément à tout moment → le panneau rebascule
   du bon côté.
7. **Enregistrer** → écrit `config/layout.json` (persistant, rechargé au démarrage).

Au pavé/trackpad : flèches = déplacement, +/− = taille, Tab = suivant, Entrée = enregistrer,
Échap = quitter sans enregistrer.

> Astuce : l'effet « pneu crevé » (bas des cercles rogné par le cache) se gère en
> remontant les éléments internes ; signaler les coupures pour ajuster les marges.

---

## B. Calibration des capteurs (jalon 8)

> Mesures à prendre sur le véhicule, à reporter dans `config/sensors.json`.

## Carburant (sonde résistive → ADS1115)
- Mesurer les **ohms réservoir plein** et **réservoir vide** → `fuel.ohm_full` / `fuel.ohm_empty`.
- Idéalement relever plusieurs points (1/4, 1/2, 3/4) pour une courbe non linéaire.
- Seuil réserve : `fuel.reserve_pct` (défaut 15 %).

## Température (NTC culasse → ADS1115)
- Relever résistance NTC à plusieurs températures connues (eau chaude + thermomètre).
- Ajuster `temp.ntc_beta`, `temp.ntc_r25`, `temp.series_resistor`.
- Seuils d'alerte : `warn_amber_c` (100 °C) / `warn_red_c` (110 °C).

## RPM
- `rpm.pulses_per_rev` = 2 (4 cyl. 4 temps). Vérifier au comparateur si possible.

## Vitesse (GPS)
- Pas de calibration ohm ; vérifier la latence/fix réels vs `speed.gps_latency_ms`.

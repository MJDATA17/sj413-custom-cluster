/**
 * sim/fake-gps-route.js — rejoue un trajet GPX pour tester la nav.
 *
 * JALON 1 : stub. La nav (étape 6) consommera ce module pour fournir
 * position + cap au composant carte/guidage. Pour l'instant fake-vehicle.js
 * fournit déjà une position GPS symbolique.
 *
 * Prévu :
 *  - charger un .gpx, interpoler les points dans le temps,
 *  - diffuser { lat, lon, heading, speed } pour piloter la nav et les radars.
 */
'use strict';

console.log('[gps-route] stub — sera implémenté au jalon navigation (étape 6).');
module.exports = { play() {}, stop() {} };

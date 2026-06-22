# Power / veille (jalon 7)

> Stub. Logique simulable sur PC avant déploiement.

## Principe
- **Détection charge USB-C** : présente = contact mis ; absente = contact coupé.
- Contact coupé → timer **15 min** → veille (S3).
- En veille, **batterie < 15 %** → hibernation (S4).
- **Wake-on-AC** (BIOS ThinkPad « Power On with AC ») : réveil depuis veille /
  hibernation / éteint dès que le courant revient. Documenter le réglage BIOS.

## Simulation (à implémenter)
Boutons contact ON/OFF + niveau batterie pour valider les transitions sans matériel.

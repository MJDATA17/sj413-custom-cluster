# Skins — format et création

Un **skin** change uniquement le VISUEL de tout le cluster (compteur, jauges, nav,
clavier, musique, menus). La logique (données, navigation, capteurs) reste identique.

Le skin actif est **persistant côté serveur** (`config/settings.json`, champ `activeSkin`),
il survit aux reboots. Les skins d'origine `mjdata` et `tva` ne sont pas supprimables.

## Structure d'un skin

Un dossier par skin dans `skins/<id>/`, contenant au minimum **`skin.json`** :

```
skins/
  mjdata/skin.json
  tva/skin.json
  mon-skin/skin.json      ← le vôtre
```

`<id>` : minuscules, lettres/chiffres/tirets (ex. `cyber-orange`). C'est la clé d'activation.

## `skin.json`

```json
{
  "name": "Cyber Orange",                // affiché dans le menu (requis)
  "render_style": "mjdata",              // style de rendu des composants canvas
  "crt": false,                          // true = overlay CRT (scanlines/vignette)
  "fonts": {
    "import": "https://fonts.googleapis.com/css2?family=Orbitron:wght@600;900&display=swap",
    "display": "Orbitron, sans-serif",   // titres / gros chiffres
    "mono": "Orbitron, monospace"        // labels / data
  },
  "vars": {                              // variables CSS appliquées à :root (requis : --accent)
    "--accent":     "#FF7A00",
    "--accent-2":   "#8B5CF6",
    "--alert":      "#FF3344",
    "--amber":      "#FF7A00",
    "--bg-cluster": "#0a0604",
    "--bg-nav":     "#0a0604",
    "--text":       "#ffffff",
    "--text-dim":   "rgba(255,255,255,0.5)"
  },
  "canvas": {                            // couleurs utilisées par le dessin canvas
    "amber": "#FF7A00", "amberDim": "#9a4a00", "amberFaint": "#3a1c00", "rust": "#FF3344"
  }
}
```

### Champs

| Champ | Rôle |
|---|---|
| `name` (requis) | nom affiché dans le menu Paramètres › Skins |
| `render_style` | **change la FAÇON de dessiner** les composants canvas. Valeurs reconnues : `mjdata` (cadran moderne + aiguille) et `tva_crt` (barregraphe radial de blocs ambre, sans aiguille). Toute autre valeur → rendu `mjdata` par défaut (le skin ne fait alors que reteinter via les couleurs). |
| `crt` | `true` affiche l'overlay CRT plein écran (scanlines + vignette + flicker). |
| `fonts.import` | URL d'une feuille de polices (ex. Google Fonts). Chargée automatiquement. |
| `fonts.display` / `fonts.mono` | familles CSS pour `--font-display` / `--font-mono`. |
| `vars` (requis : `--accent`) | variables CSS de couleur. Les surfaces et la route nav lisent ces variables. |
| `canvas` | couleurs lues par le rendu canvas (ex. `amber`, `rust` pour `tva_crt`). |

> Le **token clé** est `render_style` : certains skins changent la nature du rendu
> (cadran vs barregraphe vs CRT), pas seulement les couleurs.

## Importer un skin

**Depuis l'app** : Paramètres (appui long ou touche S) › **Skins** › **« Importer un skin (.json) »**
→ choisir un fichier `skin.json`. L'app le valide, l'ajoute à la liste et permet de l'activer.
Erreurs gérées : JSON invalide, `name`/`--accent` manquants, identifiant réservé.

**Manuellement** (skins avec polices/images locales) : créer `skins/<id>/` avec `skin.json`
(+ assets), puis redémarrer le serveur. Les assets sont servis sous `/skins/<id>/…`.

## Supprimer un skin

Paramètres › Skins › croix sur la carte du skin (skins d'origine protégés). Si le skin
supprimé était actif, l'app revient automatiquement à `mjdata`.

## Limites

- Import via l'app = un `skin.json` seul (couleurs + `render_style` + URL de police en ligne).
  Pour des polices/sons/images embarqués, passer par le dossier `skins/<id>/` manuel.
- Un `render_style` inconnu ne plante pas : il retombe sur le rendu `mjdata`.

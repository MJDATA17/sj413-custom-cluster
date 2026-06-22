# Spotify — intégration (jalon 5)

> Statut : **IMPLÉMENTÉ**. OAuth PKCE + proxy Web API côté serveur (`server/spotify.js`,
> token jamais exposé au front) et UI complète (lecteur, playlists, recherche, file).
> Il reste à **renseigner `SPOTIFY_CLIENT_ID`** dans `.env` et à **installer librespot**
> sur la cible Debian. Tant que les clés sont vides, l'app tourne en **mode démo**.

## Mise en route (3 étapes)
1. Créer l'app Spotify (ci-dessous) → copier `.env.example` en `.env`, remplir `SPOTIFY_CLIENT_ID`.
2. Démarrer le serveur, ouvrir l'app, **onglet Musique → bouton « Connecter »** (ou `http://localhost:3000/spotify/login`). Autoriser → retour automatique, token persisté.
3. (Prod) Installer + lancer **librespot** pour la sortie audio (section 3).

## Endpoints serveur (le front ne voit que ça)
| Méthode | Route | Rôle |
|---|---|---|
| GET | `/spotify/status` | configured / authenticated / premium |
| GET | `/spotify/login` · `/callback` | flow OAuth PKCE |
| GET | `/spotify/now` | lecture en cours (polling ~1 s) |
| POST | `/spotify/control` | play/pause/next/previous/seek/volume/shuffle/repeat |
| POST | `/spotify/play` | lancer un titre/contexte (+ bascule device) |
| GET | `/spotify/playlists` · `/playlist/:id/tracks` | playlists |
| GET | `/spotify/search?q=` | recherche (titres/artistes/albums/playlists) |
| GET | `/spotify/library/tracks` · `/recent` · `/queue` | bibliothèque + file |
| GET/POST | `/spotify/devices` · `/transfer` | appareils Connect |


## 1. Créer l'app Spotify
1. Aller sur https://developer.spotify.com/dashboard → **Create app**.
2. Noter le **Client ID** (le *client secret* n'est PAS nécessaire avec PKCE).
3. Dans **Redirect URIs**, ajouter EXACTEMENT : `http://localhost:3000/spotify/callback`
   (et l'URL réelle du L14 en prod, ex. `http://127.0.0.1:3000/spotify/callback`).
4. Copier `.env.example` → `.env` et renseigner `SPOTIFY_CLIENT_ID` + `SPOTIFY_REDIRECT_URI`.

## 2. Auth OAuth 2.0 (PKCE)
- Flow lancé une fois au setup : `GET /spotify/login` → autorisation → `/spotify/callback`.
- Échange `code` → `access_token` + `refresh_token`. **Persister le refresh_token**
  (`config/spotify-tokens.json`, gitignoré) pour survivre aux reboots.
- Rafraîchissement automatique avant expiration. **Le token ne quitte jamais le serveur.**

## 3. Lecture audio — librespot (Debian)
Le L14 devient une enceinte **Spotify Connect** (Premium requis).
```bash
sudo apt install -y librespot   # ou build cargo
librespot -n "MJ Data SJ413" --backend alsa --device default --bitrate 320
```
Démarrage auto via systemd (voir `docs/DEPLOY-DEBIAN.md`). Sortie audio → jack/BT voiture.

## 4. API Web (proxy serveur)
- `/spotify/now` (polling ~1s) : titre, artiste, album, pochette, position, état.
- `/spotify/control` : play / pause / next / prev / seek / volume / shuffle / repeat.
- `/spotify/playlists`, `/spotify/search`, bibliothèque (likés, albums, récents).

## 5. Robustesse
Perte réseau (tethering 4G), token expiré, Premium absent, aucun appareil actif
(→ démarrer librespot comme device par défaut). Messages d'erreur clairs en FR.

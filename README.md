# IRC TV PLAYER

Lecteur TV en direct : Xtream Codes, M3U par lien, M3U par fichier. Aucune chaîne fournie.
Serveur Node.js **sans dépendance** (Node 18+). Aucun `npm install` nécessaire.

## Lancer en local
    node server.js     # puis ouvrir http://localhost:3000
    npm test                  # 11 tests (parser, SSRF, proxy)

## Déployer (Render / Railway / VPS)
1. Mettre le dossier sur GitHub.
2. Render : New > Web Service > Build command vide, Start command `node server.js`.
   Railway : New Project > Deploy from repo (détecte `npm start`).
3. Le port est lu dans la variable `PORT` automatiquement. Le site est servi en https par l'hébergeur ;
   les flux http passent par le proxy, donc pas de blocage de contenu mixte.

## Architecture
- `index.html` : interface. `parser.js` : parser M3U partagé. hls.js et mpegts.js chargés via CDN.
- `server.js` : fichiers statiques, `POST /api/fetch` (listes, API Xtream), `GET /api/stream` (flux, playlists HLS réécrites).
- Sécurité : IP privées bloquées (vérifiées à la connexion, redirections incluses), timeout 20 s, 60 Mo max, 600 req/min/IP, aucun log d'URL ni d'identifiant, aucun stockage serveur.

## Limites honnêtes
- Les flux passent par ton serveur : la bande passante de l'hébergeur est consommée (les offres gratuites peuvent la limiter).
- MKV, HEVC/H.265 et certains codecs audio ne sont pas lisibles dans tous les navigateurs.
- Xtream : lecture des chaînes en direct uniquement (pas de films/séries) en V1. Flux demandés en .m3u8.
- Affichage limité à 400 chaînes à la fois (recherche et catégories pour affiner).
- Non testé avec un vrai serveur IPTV (pas d'accès réseau dans mon environnement) : fais un premier essai avec ta source.

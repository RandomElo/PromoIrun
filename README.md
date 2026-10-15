# PromoIrun

Script Node.js qui surveille des modèles de chaussures sur i-Run et m'envoie un message Discord quand l'un d'eux est en bonne promo dans ma pointure. Usage perso, tourne sur un Raspberry Pi.

![Licence MIT](https://img.shields.io/badge/licence-MIT-blue) ![Node.js](https://img.shields.io/badge/Node.js-TypeScript-339933) ![Docker](https://img.shields.io/badge/Docker-compose-2496ED)

## Fonctionnalités

- Suivi d'une liste de recherches i-Run (toutes les pages de résultats, éditions spéciales comprises) ou de fiches produit, tous coloris compris.
- Calcul de la remise par rapport au prix conseillé, seuil réglable par modèle (`remiseMin`) et prix plafond optionnel (`prixMax`).
- Vérification du stock : pas d'alerte si aucune de mes pointures n'est disponible.
- Message Discord (webhook) avec prix, remise, pointures en stock, photo du coloris et lien direct.
- Graphique de l'évolution du prix joint à chaque alerte (thème sombre, avec légende) : prix le plus bas dans ma pointure, toutes pointures et seuil, sur les 90 derniers jours.
- Mention @everyone sur tous les messages : alertes, graphiques, tests et erreurs.
- Pas de doublon : une promo n'est signalée qu'une fois, puis de nouveau seulement si le prix baisse encore ou si elle revient après avoir disparu.
- Historique des prix dans une base SQLite.
- Alerte Discord si un modèle échoue 3 fois d'affilée (URL morte, blocage du site, structure de page modifiée).

## Stack technique

| Partie       | Technologies                                                          |
| ------------ | --------------------------------------------------------------------- |
| Script       | Node.js 22.18+ (exécute le TypeScript directement)                    |
| Données      | Recherche et fiches i-Run, endpoint de stock `/productStock-….html`   |
| Notification | Webhook Discord                                                       |
| Graphiques   | Apache ECharts (rendu SVG côté serveur), resvg (SVG vers PNG), police Inter embarquée |
| Stockage     | SQLite (`node:sqlite`), dans un volume Docker                         |
| Conteneurs   | Docker, Docker Compose (image `node:22-slim`, Raspberry Pi 32 et 64 bits) |

## Fonctionnement

1. À chaque passage (toutes les `INTERVALLE_MINUTES`, avec ±10 % d'aléa), le script relit `config/modeles.json`.
2. Pour une recherche, il parcourt toutes les pages de résultats (60 par page, page 1 sans paramètre `page`), garde les coloris dont le nom contient tous les mots cherchés et du bon genre, puis lit le stock par pointure de tous ces coloris en une ou deux requêtes. Pour une fiche, il lit les coloris de la fiche.
3. Un coloris est en promo si sa remise atteint `remiseMin`, ou si son prix est sous `prixMax`, et qu'une des pointures voulues est en stock.
4. Les nouveaux coloris en promo d'un même modèle partent dans un seul message Discord.

Le site est protégé par Akamai : les requêtes envoient des en-têtes de navigateur, sinon il répond 403.

## Configuration des modèles

`config/modeles.json` (non versionné, modèle dans `config/modeles.example.json`) :

```json
{
    "pointures": ["42", "42.5"],
    "genre": "homme",
    "prixMax": 120,
    "modeles": [
        { "url": "https://www.i-run.fr/recherche.html?q=Marque+Modele+A" },
        { "url": "https://www.i-run.fr/recherche.html?q=Marque+Modele+B", "prixMax": 100 },
        { "url": "https://www.i-run.fr/chaussures_homme/…_fiche_123456.html", "remiseMin": 40 }
    ]
}
```

- `url` : une recherche i-Run (`recherche.html?q=…`) ou une fiche produit (`…_fiche_….html`). La recherche est conseillée : elle couvre aussi les éditions spéciales, qui ont leur propre fiche. Seuls les résultats contenant tous les mots cherchés sont gardés (« Marque Modele Plus » garde Modele Plus Trail, écarte Modele 2).
- `genre` : `homme`, `femme` ou `tous` (défaut), filtre les résultats d'une recherche. Les modèles mixtes sont toujours gardés.
- `pointures` : libellés tels qu'affichés sur i-Run (`42`, `42.5`, `42.2/3`). Liste vide : n'importe quelle pointure en stock.
- `remiseMin` : remise minimale en %. Vaut 25 par défaut, sauf si un `prixMax` est défini : seul le prix compte alors, à moins de donner aussi `remiseMin` au modèle.
- `prixMax` : prix plafond, alerte dès qu'un coloris dispo dans une des pointures passe à ce prix ou en dessous.

Les valeurs du haut servent de défaut, chaque modèle peut les surcharger. Le fichier est relu à chaque passage, pas besoin de redémarrer.

## Variables d'environnement

| Variable              | Rôle                                            | Exemple                              |
| --------------------- | ----------------------------------------------- | ------------------------------------ |
| `DISCORD_WEBHOOK_URL` | Webhook du salon Discord où envoyer les alertes | `https://discord.com/api/webhooks/…` |
| `INTERVALLE_MINUTES`  | Minutes entre deux vérifications (5 minimum)    | `60`                                 |
| `MODELES_FICHIER`     | Optionnel, emplacement de la liste des modèles  | `config/modeles.json`                |
| `BASE_FICHIER`        | Optionnel, emplacement de la base SQLite        | `data/promo-irun.sqlite`             |

## Démarrage rapide

Pour l'installation sur le Raspberry Pi (Docker, copie du projet, lancement, mises à jour, sauvegarde, dépannage), voir [DEPLOIEMENT.md](DEPLOIEMENT.md).

Prérequis : Docker sur le Raspberry Pi (64 bits conseillé), et un webhook Discord (Paramètres du salon > Intégrations > Webhooks).

```bash
cp .env.example .env
# renseigner DISCORD_WEBHOOK_URL
cp config/modeles.example.json config/modeles.json   # si pas déjà fait
# y mettre ses pointures et ses modèles

docker compose build
docker compose run --rm promo-irun npm run test-discord
docker compose up -d
docker compose logs -f promo-irun
```

Au premier passage, toutes les promos déjà en cours sont envoyées d'un coup. L'historique des prix commence au premier lancement : i-Run ne publie pas d'historique, le graphique se remplit donc au fil des jours.

En local, sans Docker :

```bash
npm install
npm run verifier
```

## Scripts utiles

| Commande               | Rôle                                     |
| ---------------------- | ---------------------------------------- |
| `npm start`            | Lance le service (boucle)                |
| `npm run dev`          | Lance le service en mode watch           |
| `npm run verifier`     | Fait un seul passage puis s'arrête       |
| `npm run test-discord` | Envoie un message de test sur le webhook |
| `npm run graphiques` | Envoie le graphique de prix de chaque modèle |
| `npm run graphiques -- --simulation` | Idem avec 90 jours d'historique fictif, pour tester le rendu |
| `npm run typecheck`    | Vérifie les types (`tsc --noEmit`)       |

## Licences

Projet sous licence MIT.

### Dépendances

| Licence    | Dépendances                        |
| ---------- | ---------------------------------- |
| Apache-2.0 | echarts, typescript (dev)          |
| MPL-2.0    | @resvg/resvg-js                    |
| MIT        | @types/node (dev)                  |
| OFL-1.1    | police Inter (`assets/fonts/`)     |

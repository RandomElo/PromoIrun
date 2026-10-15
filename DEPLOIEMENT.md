# Mise en production sur le Raspberry Pi

Ce guide installe PromoIrun sur un Raspberry Pi pour qu'il tourne en continu, redémarre tout seul après une coupure et garde son historique de prix.

Dans les commandes, remplacer `pi@raspberrypi.local` par l'utilisateur et l'adresse du Raspberry (son IP fonctionne aussi, par exemple `pi@192.168.1.20`).

## 1. Ce qu'il faut

- Un Raspberry Pi 3, 4 ou 5 avec Raspberry Pi OS (32 ou 64 bits, le 64 bits est conseillé), connecté au réseau et accessible en SSH.
- Environ 1 Go de libre sur la carte SD pour l'image Docker.
- Le projet sur le PC, avec le `.env` (webhook Discord) et le `config/modeles.json` déjà remplis.

Le service consomme peu : environ 180 Mo de mémoire au maximum pendant une vérification, presque rien entre deux.

## 2. Installer Docker sur le Raspberry

Se connecter au Raspberry :

```bash
ssh pi@raspberrypi.local
```

Puis installer Docker et le plugin Compose avec le script officiel :

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo systemctl enable docker
```

Se déconnecter puis se reconnecter en SSH pour que le groupe `docker` soit pris en compte, et vérifier :

```bash
docker --version
docker compose version
```

Vérifier aussi le fuseau horaire du système, utile pour lire les logs :

```bash
timedatectl
# si besoin : sudo timedatectl set-timezone Europe/Paris
```

## 3. Copier le projet

Depuis le PC, dans le dossier `a_Projets` :

```bash
rsync -av --exclude node_modules --exclude data --exclude .claude \
    PromoIrun/ pi@raspberrypi.local:~/promo-irun/
```

`rsync` copie aussi `.env` et `config/modeles.json`, qui ne sont pas versionnés et sont indispensables. Ils restent sur le réseau local, mais le `.env` contient l'URL du webhook : quiconque l'a peut écrire dans le salon Discord.

Sur le Raspberry, restreindre les droits du `.env` :

```bash
chmod 600 ~/promo-irun/.env
```

## 4. Construire l'image sur le Raspberry

L'image doit être construite sur le Raspberry lui-même, pour que `npm ci` installe la version ARM du moteur de rendu des graphiques. Une image construite sur le PC ne fonctionnera pas (erreur `exec format error`).

```bash
cd ~/promo-irun
docker compose build
```

Compter quelques minutes la première fois, surtout sur un Pi 3.

## 5. Tester avant de lancer

Ces commandes lancent un conteneur temporaire, qui s'arrête tout seul.

Message de test sur Discord, avec la mention @everyone comme tous les messages :

```bash
docker compose run --rm promo-irun npm run test-discord
```

Un passage complet sur les modèles suivis, avec le détail dans le terminal :

```bash
docker compose run --rm promo-irun npm run verifier
```

Graphiques avec un historique fictif, pour vérifier le rendu sur le Raspberry :

```bash
docker compose run --rm promo-irun npm run graphiques -- --simulation
```

Le passage de test enregistre déjà un premier relevé de prix dans la base, et marque comme signalées les promos qu'il a envoyées : le service ne les renverra pas au lancement.

## 6. Lancer le service

```bash
docker compose up -d
docker compose logs -f promo-irun
```

`Ctrl+C` quitte l'affichage des logs sans arrêter le service. Une vérification a lieu au démarrage, puis toutes les `INTERVALLE_MINUTES` (60 par défaut).

Grâce à `restart: unless-stopped` et au service Docker activé au démarrage, le conteneur repart tout seul après une coupure de courant ou un redémarrage du Raspberry.

## 7. Au quotidien

Modifier les modèles suivis, les pointures ou les seuils : éditer le fichier sur le Raspberry, il est relu à chaque vérification, sans redémarrage.

```bash
nano ~/promo-irun/config/modeles.json
```

Vérifier que le JSON est valide en lançant un passage de test (étape 5) : une erreur de syntaxe s'affiche tout de suite.

Changer le webhook ou l'intervalle (`.env`) : il faut recréer le conteneur.

```bash
docker compose up -d --force-recreate
```

Voir l'état et les derniers logs :

```bash
docker compose ps
docker compose logs --tail 50 promo-irun
```

Arrêter ou relancer :

```bash
docker compose stop
docker compose start
```

## 8. Mettre à jour le code

Depuis le PC, recopier le projet (même commande qu'à l'étape 3), puis sur le Raspberry :

```bash
cd ~/promo-irun
docker compose up -d --build
```

L'historique est conservé : il est dans un volume Docker, pas dans l'image.

Attention, `rsync` écrase aussi `config/modeles.json` sur le Raspberry. Si la liste a été modifiée directement sur le Raspberry, ajouter `--exclude config/modeles.json` à la commande.

## 9. Sauvegarder l'historique

La base SQLite est dans le volume `promo-irun_donnees`. Pour en faire une copie pendant que le service tourne :

```bash
cd ~/promo-irun
docker compose cp promo-irun:/app/data/promo-irun.sqlite ./sauvegarde-$(date +%F).sqlite
```

Puis la récupérer sur le PC si besoin :

```bash
scp pi@raspberrypi.local:~/promo-irun/sauvegarde-*.sqlite .
```

Ne jamais lancer `docker compose down -v` : l'option `-v` supprime le volume, donc tout l'historique.

## 10. Dépannage

Les logs indiquent `403 ... bloqué par la protection anti-robot` : i-Run (Akamai) refuse les requêtes. Une IP de box internet passe normalement. Si ça persiste, augmenter `INTERVALLE_MINUTES` dans `.env`. Après 3 échecs d'affilée sur un modèle, un message d'erreur arrive sur Discord.

`Discord a répondu 401` ou `404` : le webhook a été supprimé ou l'URL est fausse. En recréer un dans Discord, le mettre dans `.env`, puis `docker compose up -d --force-recreate`.

`exec format error` au démarrage : l'image a été construite sur une autre machine. La reconstruire sur le Raspberry avec `docker compose build --no-cache`.

`Graphique indisponible` dans les logs : l'alerte est quand même partie, sans l'image. Vérifier que le dossier `assets/fonts/` a bien été copié, puis reconstruire l'image.

Le conteneur redémarre en boucle (`docker compose ps` affiche `Restarting`) : lire la cause avec `docker compose logs --tail 20 promo-irun`. C'est en général `DISCORD_WEBHOOK_URL` manquant ou un `INTERVALLE_MINUTES` invalide dans `.env`.

Plus aucune alerte, rien sur Discord : une erreur dans `config/modeles.json` (JSON mal formé, URL refusée) n'arrête pas le service, mais chaque vérification échoue avec une ligne `Erreur : ...` dans les logs, sans message Discord. D'où l'intérêt de lancer un passage de test après chaque modification.

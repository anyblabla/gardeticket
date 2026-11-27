# 🧾 GardeTicket

Application web (PWA) pour garder ses tickets de caisse et suivre ses garanties.
Tout est stocké **uniquement dans le navigateur du téléphone** : aucune donnée n'est envoyée à un serveur.

- 📷 Photo du ticket (recadrage automatique, filtre scanner N&B) ou facture PDF
- 🔔 Alerte avant expiration de la garantie et rappel agenda (`.ics`)
- 💾 Sauvegarde locale (`.json`), envoi vers le cloud (`.txt`) et restauration (`.json` / `.txt`)
- 🎨 8 thèmes de couleurs, mode clair/sombre automatique
- 📴 Fonctionne hors connexion (service worker)

Application statique : HTML, CSS et JavaScript, sans dépendance ni build.

<p align="center">
  <img src="docs/apercu.png" alt="Aperçu de l'interface mobile GardeTicket" width="320">
</p>

## Structure du dépôt

```text
app/                fichiers publiés (index.html, aide.html, app.js, theme-init.js, style.css, sw.js, manifest.json, icônes)
deploy/             install.sh, gabarits nginx (proxied / standalone / docker), config NPM, page 403 « mobile uniquement »
Dockerfile          image Docker basée sur nginx:alpine
docker-compose.yml  déploiement prêt à l'emploi via ghcr.io
```

## Trois façons de l'héberger

### 1. Avec Docker / Docker Compose (recommandé pour auto-hébergeurs)

L'image multi-architecture (`linux/amd64` et `linux/arm64`) est publiée automatiquement sur GitHub Container Registry (`ghcr.io/anyblabla/gardeticket:latest`).

```bash
mkdir -p gardeticket && cd gardeticket
cat << 'YAML' > docker-compose.yml
services:
  gardeticket:
    image: ghcr.io/anyblabla/gardeticket:latest
    container_name: gardeticket
    restart: unless-stopped
    ports:
      - "8080:80"
YAML
docker compose up -d
```

> ℹ️ Même hébergée via Docker, l'application reste **100 % côté client** : aucun volume n'est nécessaire, les tickets restent stockés dans le navigateur de chaque téléphone. Place le conteneur derrière un reverse proxy en **HTTPS** (voir les réglages NPM ci-dessous) pour activer la PWA et l'appareil photo.

### 2. Derrière un reverse proxy (Nginx Proxy Manager) — script Debian

Depuis GitHub :

```bash
sudo apt-get install -y git
git clone https://github.com/anyblabla/gardeticket.git
cd gardeticket
sudo bash deploy/install.sh
```

Ou depuis le miroir Gitea :

```bash
sudo apt-get install -y git
git clone https://gitea.blablalinux.be/blablalinux/gardeticket.git
cd gardeticket
sudo bash deploy/install.sh
```

Le serveur sert l'appli en HTTP sur le port 80 avec un vhost minimal. Dans NPM :

- **Détails** : `http`, IP du serveur, port `80` (ou `8080` avec Docker) ;
- **SSL** : certificat, Forcer SSL, HTTP/2, HSTS ;
- **Configuration Nginx personnalisée** : colle le contenu de [`deploy/npm-advanced-config.conf`](deploy/npm-advanced-config.conf)
  (en-têtes de sécurité, CSP, blocage des ordinateurs de bureau). Copie aussi la page [`deploy/403_gardeticket/index.html`](deploy/403_gardeticket/index.html) dans le dossier `data/403_gardeticket/` de NPM (visible dans le conteneur sous `/data/403_gardeticket/`) : c'est ce que verront les visiteurs sur ordinateur.
- **Emplacements personnalisés** : ajoute `/sw.js` (vers `http://<IP_SERVEUR>:80`) avec `Cache-Control "no-cache, no-store, must-revalidate"` et `X-Content-Type-Options "nosniff"` pour éviter qu'un vieux service worker reste en cache.

### 3. Serveur autonome avec HTTPS (Let's Encrypt)

```bash
sudo bash deploy/install.sh --standalone --domain tickets.exemple.be --email toi@exemple.be
```

Le vhost nginx porte alors lui-même les en-têtes de sécurité, la CSP et le blocage des ordinateurs.

### Ce que fait le script `deploy/install.sh`

1. installe `nginx` (et `certbot` si `--email`) ;
2. copie `app/` dans `/var/www/gardeticket` (propriétaire `root`, dossiers `755`, fichiers `644`) ;
3. crée et active le vhost `/etc/nginx/sites-available/gardeticket.conf` ;
4. teste la configuration, recharge nginx et vérifie que le site répond.

Il est relançable : un vhost existant n'est pas écrasé (sauf `--force-nginx`). L'ancien contenu du site est conservé dans `/var/backups/gardeticket/previous`, et un ancien vhost nommé `gardeticket` (sans `.conf`) y est mis de côté.

### Options du script

| Option | Effet |
|---|---|
| `--domain NOM` | nom de domaine du vhost (défaut : site par défaut) |
| `--standalone` | vhost autonome (en-têtes, CSP, blocage bureau) |
| `--email ADRESSE` | HTTPS Let's Encrypt (implique `--standalone`, nécessite `--domain`) |
| `--web-root CHEMIN` | dossier de publication (défaut `/var/www/gardeticket`) |
| `--allow-desktop` | avec `--standalone` : n'interdit pas les ordinateurs |
| `--update` | redéploie seulement les fichiers, sans toucher à nginx |
| `--force-nginx` | régénère le vhost même s'il existe déjà |
| `--uninstall` | supprime le site (nginx reste installé) |

## Mise à jour

**Avec Docker Compose :**

```bash
docker compose pull && docker compose up -d
```

*(Compatible également avec Watchtower pour les mises à jour automatiques.)*

**Avec le script d'installation :**

```bash
cd gardeticket
git pull
sudo bash deploy/install.sh --update
```

> ⚠️ Le service worker fonctionne en « cache d'abord ». À chaque modification des fichiers de `app/`,
> incrémente `CACHE_NAME` dans `app/sw.js` (ex. `gardeticket-v26`), sinon les téléphones garderont l'ancienne version.

## Points importants

- **HTTPS obligatoire** : sans lui, le service worker et l'installation en application ne fonctionnent pas.
- **Publier à la racine d'un domaine ou sous-domaine** : `manifest.json` et `sw.js` utilisent des chemins absolus (`/`, `/icon-192.png`…).
- **CSP stricte** (`script-src 'self'`) : pas de JavaScript inline dans les pages, d'où le fichier `theme-init.js`. Pas de `onclick="…"` non plus.
- **Mobile uniquement** : détection par User-Agent, donc contournable ; l'exception `Uptime-Kuma` laisse passer la supervision.
- Le vhost envoie `Cache-Control: no-cache` pour que les mises à jour soient bien récupérées.

## Licence

Logiciel libre sous licence [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html) — voir le fichier [`LICENSE`](LICENSE).
Tu peux l'utiliser, l'étudier, le modifier et le partager ; si tu publies une version modifiée (y compris en l'hébergeant comme service), son code source doit rester disponible sous la même licence.

---

> **Author**: this guide is proposed by **Amaury aka BlablaLinux**. Find all my services on [blablalinux.be/mes-services-publics/](https://blablalinux.be/mes-services-publics/).

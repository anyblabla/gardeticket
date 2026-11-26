# 🧾 GardeTicket

Application web (PWA) pour garder ses tickets de caisse et suivre ses garanties.
Tout est stocké **uniquement dans le navigateur du téléphone** : aucune donnée n'est envoyée à un serveur.

- 📷 Photo du ticket (recadrage automatique, filtre scanner N&B) ou facture PDF
- 🔔 Alerte avant expiration de la garantie et rappel agenda (`.ics`)
- 💾 Sauvegarde locale (`.json`), envoi vers le cloud (`.txt`) et restauration (`.json` / `.txt`)
- 🎨 8 thèmes de couleurs, mode clair/sombre automatique
- 📴 Fonctionne hors connexion (service worker)

Application statique : HTML, CSS et JavaScript, sans dépendance ni build.

## Structure du dépôt

```
app/      fichiers publiés (index.html, aide.html, app.js, theme-init.js, style.css, sw.js, manifest.json, icônes)
deploy/   install.sh, gabarits nginx (proxied / standalone), config NPM de référence, page 403 « mobile uniquement »
```

## Deux façons de l'héberger

### 1. Derrière un reverse proxy (Nginx Proxy Manager) — mode par défaut

```bash
sudo apt-get install -y git
git clone [https://github.com/anyblabla/gardeticket.git](https://github.com/anyblabla/gardeticket.git)
cd gardeticket
sudo bash deploy/install.sh
```

Le serveur sert l'appli en HTTP sur le port 80 avec un vhost minimal. Dans NPM :

- **Détails** : `http`, IP du serveur, port `80` ;
- **SSL** : certificat, Forcer SSL, HTTP/2, HSTS ;
- **Configuration Nginx personnalisée** : colle le contenu de [`deploy/npm-advanced-config.conf`](deploy/npm-advanced-config.conf)
  (en-têtes de sécurité, CSP, blocage des ordinateurs de bureau). Copie aussi la page [`deploy/403_gardeticket/index.html`](deploy/403_gardeticket/index.html) dans le dossier `data/403_gardeticket/` de NPM (visible dans le conteneur sous `/data/403_gardeticket/`) : c'est ce que verront les visiteurs sur ordinateur.
- **Emplacements personnalisés** : ajoute `/sw.js` (vers `http://<IP_SERVEUR>:80`) avec `Cache-Control "no-cache, no-store, must-revalidate"` et `X-Content-Type-Options "nosniff"` pour éviter qu'un vieux service worker reste en cache.

### 2. Serveur autonome avec HTTPS (Let's Encrypt)

```bash
sudo bash deploy/install.sh --standalone --domain tickets.exemple.be --email toi@exemple.be
```

Le vhost nginx porte alors lui-même les en-têtes de sécurité, la CSP et le blocage des ordinateurs.

### Ce que fait le script

1. installe `nginx` (et `certbot` si `--email`) ;
2. copie `app/` dans `/var/www/gardeticket` (propriétaire `root`, dossiers `755`, fichiers `644`) ;
3. crée et active le vhost `/etc/nginx/sites-available/gardeticket.conf` ;
4. teste la configuration, recharge nginx et vérifie que le site répond.

Il est relançable : un vhost existant n'est pas écrasé (sauf `--force-nginx`). L'ancien contenu du site est conservé dans `/var/backups/gardeticket/previous`, et un ancien vhost nommé `gardeticket` (sans `.conf`) y est mis de côté.

### Options

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

```bash
cd gardeticket
git pull
sudo bash deploy/install.sh --update
```

> ⚠️ Le service worker fonctionne en « cache d'abord ». À chaque modification des fichiers de `app/`,
> incrémente `CACHE_NAME` dans `app/sw.js` (ex. `gardeticket-v25`), sinon les téléphones garderont l'ancienne version.

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

Auteur : ce guide est proposé par Amaury alias BlablaLinux. Retrouvez tous mes services sur [blablalinux.be/mes-services-publics](https://blablalinux.be/mes-services-publics/).

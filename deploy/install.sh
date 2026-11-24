#!/usr/bin/env bash
#
# GardeTicket — installation / mise à jour sur Debian (testé pour Debian 13 « Trixie »)
#
#   sudo bash deploy/install.sh [options]
#
# Options :
#   --domain NOM       nom de domaine du site (défaut : site par défaut du serveur)
#   --standalone       vhost autonome : en-têtes de sécurité + blocage bureau dans nginx
#                      (défaut : vhost minimal pour un site derrière un reverse proxy)
#   --email ADRESSE    HTTPS via Let's Encrypt (certbot) ; implique --standalone et --domain
#   --web-root CHEMIN  dossier de publication (défaut : /var/www/gardeticket)
#   --allow-desktop    (avec --standalone) ne bloque pas les ordinateurs de bureau
#   --update           redéploie uniquement les fichiers (ne touche pas à nginx)
#   --force-nginx      réécrit le vhost nginx même s'il existe déjà
#   --uninstall        supprime le site (vhost + fichiers), nginx reste installé
#   -h, --help         affiche cette aide
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$REPO_DIR/app"

SITE_NAME="gardeticket"
WEB_ROOT="/var/www/gardeticket"
DOMAIN="_"
EMAIL=""
BLOCK_DESKTOP=1
MODE="proxied"
DESKTOP_FLAG=0
UPDATE_ONLY=0
FORCE_NGINX=0
UNINSTALL=0

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mErreur :\033[0m %s\n' "$*" >&2; exit 1; }
usage() { awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)        DOMAIN="${2:?--domain demande une valeur}"; shift 2 ;;
    --email)         EMAIL="${2:?--email demande une valeur}"; shift 2 ;;
    --web-root)      WEB_ROOT="${2:?--web-root demande une valeur}"; shift 2 ;;
    --standalone)    MODE="standalone"; shift ;;
    --allow-desktop) BLOCK_DESKTOP=0; DESKTOP_FLAG=1; shift ;;
    --update)        UPDATE_ONLY=1; shift ;;
    --force-nginx)   FORCE_NGINX=1; shift ;;
    --uninstall)     UNINSTALL=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) die "option inconnue : $1 (voir --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "ce script doit être lancé en root (sudo)."
[[ "$DOMAIN" =~ ^(_|[A-Za-z0-9.-]+)$ ]] || die "nom de domaine invalide : $DOMAIN"
[[ "$WEB_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "chemin web-root invalide : $WEB_ROOT"
[[ "$WEB_ROOT" != "/" && "$WEB_ROOT" != "/var/www" ]] || die "web-root dangereux : $WEB_ROOT"
[[ -z "$EMAIL" || "$DOMAIN" != "_" ]] || die "--email nécessite --domain."
[[ -z "$EMAIL" ]] || MODE="standalone"
[[ $MODE == standalone || $DESKTOP_FLAG -eq 0 ]] || warn "--allow-desktop est ignoré sans --standalone (le blocage se règle dans le proxy)."
TEMPLATE="$SCRIPT_DIR/nginx-${MODE}.conf.template"
[[ -f "$TEMPLATE" ]] || die "gabarit introuvable : $TEMPLATE"

CONF_AVAIL="/etc/nginx/sites-available/${SITE_NAME}.conf"
CONF_ENAB="/etc/nginx/sites-enabled/${SITE_NAME}.conf"

# --- Désinstallation ---------------------------------------------------------
if [[ $UNINSTALL -eq 1 ]]; then
  log "Suppression du site GardeTicket"
  rm -f "$CONF_ENAB" "$CONF_AVAIL"
  rm -rf "$WEB_ROOT"
  if command -v nginx >/dev/null && nginx -t 2>/dev/null; then systemctl reload nginx; fi
  log "Terminé (nginx et les certificats Let's Encrypt éventuels sont conservés)."
  exit 0
fi

# --- Vérifications -----------------------------------------------------------
[[ -f "$SRC_DIR/index.html" ]] || die "fichiers de l'application introuvables dans $SRC_DIR"

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" != "debian" && "${ID_LIKE:-}" != *debian* ]]; then
    die "système non supporté (Debian/Ubuntu attendu)."
  fi
  [[ "${VERSION_ID:-}" == "13" ]] || warn "testé sur Debian 13 ; système détecté : ${PRETTY_NAME:-inconnu}."
fi

# --- Paquets -----------------------------------------------------------------
if [[ $UPDATE_ONLY -eq 0 ]]; then
  PKGS=(nginx curl)
  [[ -n "$EMAIL" ]] && PKGS+=(certbot python3-certbot-nginx)
  log "Installation des paquets : ${PKGS[*]}"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "${PKGS[@]}"
else
  command -v nginx >/dev/null || die "nginx n'est pas installé : lance d'abord l'installation complète."
fi

# --- Déploiement des fichiers (propriétaire root, lecture seule pour nginx) ---
log "Déploiement des fichiers dans $WEB_ROOT"
mkdir -p "$(dirname "$WEB_ROOT")"
STAGE="$(mktemp -d "$(dirname "$WEB_ROOT")/.${SITE_NAME}.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -a "$SRC_DIR"/. "$STAGE"/
chown -R root:root "$STAGE"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
if [[ -d "$WEB_ROOT" ]]; then
  # l'ancien contenu est gardé (une seule génération) dans /var/backups
  mkdir -p /var/backups/gardeticket
  rm -rf /var/backups/gardeticket/previous
  mv "$WEB_ROOT" /var/backups/gardeticket/previous
  log "Ancien contenu conservé dans /var/backups/gardeticket/previous"
fi
mv "$STAGE" "$WEB_ROOT"

# --- Configuration nginx -----------------------------------------------------
if [[ $UPDATE_ONLY -eq 0 ]]; then
  # Migration : ancien vhost sans extension (sites-*/gardeticket) -> mis de côté,
  # sinon il entre en conflit avec gardeticket.conf (même listen/server_name).
  for legacy in /etc/nginx/sites-enabled/gardeticket /etc/nginx/sites-available/gardeticket; do
    if [[ -e "$legacy" || -L "$legacy" ]]; then
      mkdir -p /var/backups/gardeticket
      mv "$legacy" "/var/backups/gardeticket/$(basename "$(dirname "$legacy")").gardeticket.$(date +%Y%m%d-%H%M%S)"
      warn "ancien vhost $legacy déplacé dans /var/backups/gardeticket/"
    fi
  done
  if [[ -f "$CONF_AVAIL" && $FORCE_NGINX -eq 0 ]]; then
    warn "$CONF_AVAIL existe déjà : conservé (utilise --force-nginx pour le régénérer)."
  else
    log "Écriture du vhost nginx ($CONF_AVAIL)"
    if [[ "$DOMAIN" == "_" ]]; then
      LISTEN='listen 80 default_server; listen [::]:80 default_server;'
      rm -f /etc/nginx/sites-enabled/default   # évite un conflit de default_server
    else
      LISTEN='listen 80; listen [::]:80;'
    fi
    sed -e "s|@LISTEN@|${LISTEN}|" \
        -e "s|@DOMAIN@|${DOMAIN}|" \
        -e "s|@WEBROOT@|${WEB_ROOT}|" \
        -e "s|@BLOCK_DEFAULT@|${BLOCK_DESKTOP}|g" \
        "$TEMPLATE" > "$CONF_AVAIL"
    chmod 644 "$CONF_AVAIL"
    ln -sf "$CONF_AVAIL" "$CONF_ENAB"
  fi
fi

log "Test de la configuration nginx"
nginx -t
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx

# --- HTTPS (optionnel) -------------------------------------------------------
if [[ -n "$EMAIL" && $UPDATE_ONLY -eq 0 ]]; then
  log "Certificat Let's Encrypt pour $DOMAIN"
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --non-interactive --redirect
fi

# --- Vérification ------------------------------------------------------------
UA='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36'
HOST_HDR="$DOMAIN"; [[ "$DOMAIN" == "_" ]] && HOST_HDR="localhost"
if curl -fsS -o /dev/null -A "$UA" -H "Host: $HOST_HDR" http://127.0.0.1/ ; then
  log "Le site répond correctement en local."
else
  warn "le test local a échoué : consulte /var/log/nginx/gardeticket.error.log"
fi

echo
log "GardeTicket est déployé."
if [[ $MODE == proxied ]]; then
  warn "Mode « derrière un reverse proxy » : le site est servi en HTTP (port 80)."
  warn "HTTPS est obligatoire pour la PWA : configure-le dans ton proxy (voir deploy/npm-advanced-config.conf)."
elif [[ -z "$EMAIL" ]]; then
  warn "Mode autonome sans --email : le site n'est pas en HTTPS, la PWA ne s'installera pas."
fi

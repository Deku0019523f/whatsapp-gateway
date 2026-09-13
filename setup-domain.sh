#!/usr/bin/env bash
#
# setup-domain.sh
# ----------------
# Configure un nom de domaine ou sous-domaine pour whatsapp-gateway :
#   - installe Nginx et Certbot si nécessaire
#   - demande le domaine/sous-domaine à rattacher
#   - demande si on garde le port 3000 (accès direct) ou si on passe
#     par Nginx en 80/443 avec SSL (recommandé)
#   - crée et active la config Nginx
#   - lance Certbot pour le SSL si le mode 80/443 est choisi
#   - redémarre l'app via PM2
#
# Usage : sudo bash setup-domain.sh
#

set -euo pipefail

APP_NAME="whatsapp-gateway"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${APP_DIR}/.env"

# ---------- couleurs ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[ERREUR]${NC} $1"; }

# ---------- vérifications de base ----------
if [[ $EUID -ne 0 ]]; then
  error "Ce script doit être lancé avec sudo/root (ex: sudo bash setup-domain.sh)"
  exit 1
fi

if ! command -v node &>/dev/null; then
  error "Node.js n'est pas installé. Lance d'abord fix-node.sh."
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  warn "Node.js $(node -v) détecté — ce projet nécessite Node 20+."
  warn "Lance d'abord fix-node.sh, sinon l'app risque de ne pas démarrer."
fi

echo ""
echo "=== Configuration du domaine — whatsapp-gateway ==="
echo ""

# ---------- 1. Domaine / sous-domaine ----------
read -rp "Nom de domaine ou sous-domaine à rattacher (ex: premium225.shop) : " DOMAIN
if [[ -z "$DOMAIN" ]]; then
  error "Le domaine ne peut pas être vide."
  exit 1
fi

# ---------- 2. Choix du port ----------
echo ""
echo "Comment veux-tu exposer l'application ?"
echo "  1) Garder le port 3000 en accès direct (http://$DOMAIN:3000, pas de SSL)"
echo "  2) Passer par Nginx en 80/443 avec HTTPS (https://$DOMAIN) [recommandé]"
read -rp "Choix [1/2] (défaut: 2) : " PORT_CHOICE
PORT_CHOICE="${PORT_CHOICE:-2}"

APP_PORT="3000"
if [[ -f "$ENV_FILE" ]]; then
  EXISTING_PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d'=' -f2 || true)
  if [[ -n "${EXISTING_PORT:-}" ]]; then
    APP_PORT="$EXISTING_PORT"
  fi
fi

if [[ "$PORT_CHOICE" == "1" ]]; then
  info "Mode choisi : accès direct sur le port ${APP_PORT} (pas de reverse proxy, pas de SSL)."
  echo ""
  warn "Pense à ouvrir le port dans le pare-feu : ufw allow ${APP_PORT}"
  echo ""
  echo "Ton API sera accessible sur : http://${DOMAIN}:${APP_PORT}"
  echo "(Assure-toi que le DNS de ${DOMAIN} pointe bien vers l'IP de ce VPS)"
  exit 0
fi

# ---------- Mode Nginx + SSL ----------
info "Mode choisi : reverse proxy Nginx + HTTPS (80/443)."

# Installer Nginx si absent
if ! command -v nginx &>/dev/null; then
  info "Installation de Nginx..."
  apt-get update -qq
  apt-get install -y nginx
else
  info "Nginx déjà installé."
fi

# Installer Certbot si absent
if ! command -v certbot &>/dev/null; then
  info "Installation de Certbot..."
  apt-get install -y certbot python3-certbot-nginx
else
  info "Certbot déjà installé."
fi

# ---------- 3. Créer la config Nginx ----------
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_LINK="/etc/nginx/sites-enabled/${DOMAIN}"

info "Création de la config Nginx pour ${DOMAIN}..."
cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

if [[ ! -L "$NGINX_LINK" ]]; then
  ln -s "$NGINX_CONF" "$NGINX_LINK"
fi

info "Test de la config Nginx..."
nginx -t

info "Redémarrage de Nginx..."
systemctl restart nginx

# ---------- 4. Certificat SSL ----------
echo ""
read -rp "Lancer Certbot maintenant pour obtenir le certificat SSL de ${DOMAIN} ? [O/n] : " RUN_CERTBOT
RUN_CERTBOT="${RUN_CERTBOT:-O}"

if [[ "$RUN_CERTBOT" =~ ^[OoYy]$ ]]; then
  certbot --nginx -d "$DOMAIN"
  info "Certificat SSL installé pour ${DOMAIN}."
else
  warn "Étape SSL sautée. Relance plus tard avec : certbot --nginx -d ${DOMAIN}"
fi

# ---------- 5. Mettre à jour le .env si besoin ----------
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^PUBLIC_URL=' "$ENV_FILE"; then
    sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://${DOMAIN}#" "$ENV_FILE"
  else
    echo "PUBLIC_URL=https://${DOMAIN}" >> "$ENV_FILE"
  fi
  info "PUBLIC_URL mis à jour dans .env → https://${DOMAIN}"
fi

# ---------- 6. Redémarrer l'app ----------
if command -v pm2 &>/dev/null; then
  info "Redémarrage de ${APP_NAME} via PM2..."
  pm2 restart "$APP_NAME" --update-env || warn "PM2 n'a pas trouvé de process nommé ${APP_NAME}, redémarre-le manuellement si besoin."
fi

echo ""
info "Terminé ! Ton API est accessible sur : https://${DOMAIN}"
echo ""
warn "Pense à mettre à jour côté client (My Atelier, webhookUrl, etc.) avec cette nouvelle URL."

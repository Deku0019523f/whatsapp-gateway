#!/usr/bin/env bash
#
# fix-node.sh
# -----------
# Installe/instale Node.js 20+ via nvm (n'affecte pas le Node système,
# évite les conflits avec d'autres projets sur le VPS), réinstalle les
# dépendances proprement, puis redémarre l'app via PM2 avec le bon
# interpréteur Node.
#
# Usage : bash fix-node.sh
#

set -euo pipefail

APP_NAME="whatsapp-gateway"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIRED_NODE_MAJOR=20

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

CURRENT_MAJOR="0"
if command -v node &>/dev/null; then
  CURRENT_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
fi

if [[ "$CURRENT_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]]; then
  info "Node.js $(node -v) déjà >= ${REQUIRED_NODE_MAJOR}. Rien à faire."
else
  warn "Node.js actuel : $(command -v node &>/dev/null && node -v || echo 'absent') — installation de Node ${REQUIRED_NODE_MAJOR} via nvm..."

  export NVM_DIR="$HOME/.nvm"
  if [[ ! -d "$NVM_DIR" ]]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  fi
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"

  nvm install ${REQUIRED_NODE_MAJOR}
  nvm alias default ${REQUIRED_NODE_MAJOR}
  nvm use ${REQUIRED_NODE_MAJOR}

  info "Node installé : $(node -v)"
fi

NODE_BIN="$(command -v node)"
info "Interpréteur Node utilisé : ${NODE_BIN}"

cd "$APP_DIR"

info "Nettoyage de node_modules / package-lock.json (ancienne version Node)..."
rm -rf node_modules package-lock.json

info "Réinstallation des dépendances..."
npm install

if command -v pm2 &>/dev/null; then
  info "Redémarrage propre via PM2 avec le nouvel interpréteur Node..."
  pm2 delete "$APP_NAME" 2>/dev/null || true
  pm2 start server.js --name "$APP_NAME" --interpreter "$NODE_BIN"
  pm2 save
  pm2 logs "$APP_NAME" --lines 20 --nostream
else
  warn "PM2 non installé. Installe-le avec : npm install -g pm2"
fi

info "Terminé."

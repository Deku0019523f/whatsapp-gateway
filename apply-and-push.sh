#!/usr/bin/env bash
#
# apply-and-push.sh
# ------------------
# À lancer depuis la racine du repo whatsapp-gateway sur le VPS.
#
# 1. Patch package.json (ajoute "engines": { "node": ">=20.0.0" })
# 2. Copie .npmrc, README.md, fix-node.sh, setup-domain.sh dans le repo
# 3. git add / commit / push vers GitHub avec un token (jamais stocké en clair)
#
# Usage :
#   cd ~/whatsapp-gateway
#   bash apply-and-push.sh
#
# Le script demande le token GitHub de façon masquée (il n'est jamais
# écrit dans un fichier ni dans l'historique bash).

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

if [[ ! -f "package.json" ]]; then
  echo "Ce script doit être lancé depuis la racine du repo (package.json introuvable)."
  exit 1
fi

FIXES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------- 1. Patch package.json ----------
info "Ajout de engines.node >=20.0.0 dans package.json..."
node -e "
const fs = require('fs');
const path = 'package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.engines = Object.assign({}, pkg.engines, { node: '>=20.0.0' });
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"
info "package.json mis à jour."

# ---------- 2. Copier les fichiers ----------
info "Copie de .npmrc, README.md, fix-node.sh, setup-domain.sh..."
cp "${FIXES_DIR}/.npmrc" ./.npmrc
cp "${FIXES_DIR}/README.md" ./README.md
cp "${FIXES_DIR}/fix-node.sh" ./fix-node.sh
cp "${FIXES_DIR}/setup-domain.sh" ./setup-domain.sh
chmod +x fix-node.sh setup-domain.sh

# ---------- 3. Commit ----------
git add package.json .npmrc README.md fix-node.sh setup-domain.sh
if git diff --cached --quiet; then
  warn "Rien à committer (aucun changement détecté)."
else
  git commit -m "chore: require Node 20+, add domain setup script and fix-node script"
  info "Commit créé."
fi

# ---------- 4. Push avec le token (jamais écrit sur disque) ----------
echo ""
read -rsp "Colle ton token GitHub (saisie masquée, jamais enregistrée) : " GH_TOKEN
echo ""

if [[ -z "$GH_TOKEN" ]]; then
  echo "Token vide, abandon."
  exit 1
fi

REMOTE_URL=$(git remote get-url origin)
# Transforme https://github.com/user/repo.git en URL avec token intégré, en mémoire uniquement
AUTH_URL=$(echo "$REMOTE_URL" | sed -E "s#https://#https://${GH_TOKEN}@#")

info "Push vers GitHub..."
git push "$AUTH_URL" HEAD

info "Push terminé."
warn "Pense à révoquer ce token maintenant sur GitHub (Settings > Developer settings > Personal access tokens), il n'est plus nécessaire."

unset GH_TOKEN
unset AUTH_URL

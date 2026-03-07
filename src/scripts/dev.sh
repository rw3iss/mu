#!/usr/bin/env bash
set -euo pipefail

# Mu - Development Helper Script

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

MU_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MU_DIR"

# Create data directories if missing
mkdir -p data/db data/cache/images data/cache/streams data/cache/subtitles data/logs

# Create .env if missing
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  COOKIE_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  sed -i.bak "s/MU_AUTH_JWT_SECRET=.*/MU_AUTH_JWT_SECRET=$JWT_SECRET/" .env 2>/dev/null || true
  sed -i.bak "s/MU_AUTH_COOKIE_SECRET=.*/MU_AUTH_COOKIE_SECRET=$COOKIE_SECRET/" .env 2>/dev/null || true
  rm -f .env.bak
  echo -e "${GREEN}[✓]${NC} Generated .env with random secrets"
fi

echo -e "${BOLD}${CYAN}"
echo "  Mu - Development Mode"
echo -e "${NC}"
echo -e "  Server: ${CYAN}http://localhost:8080${NC}"
echo -e "  Client: ${CYAN}http://localhost:3000${NC} (with proxy to server)"
echo ""

# Start dev servers
pnpm run dev

#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Mu — Setup
#
# One command to take a fresh clone to a runnable server:
#   1. Check prerequisites (node, pnpm, ffmpeg)
#   2. Ensure a .env exists
#   3. pnpm install
#   4. pnpm build           (server + client)
#   5. pnpm db:migrate      (create/upgrade the schema in your data dir)
#   6. Optionally install Mu as a system service (Linux/systemd, macOS, Windows)
#
# Safe to re-run. Run from anywhere:  bash src/setup.sh   (or  pnpm setup)
# ──────────────────────────────────────────────────────────────────────────────

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
log()  { echo -e "  ${GREEN}[+]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()  { echo -e "  ${RED}[x]${NC} $1"; }
info() { echo -e "  ${CYAN}[i]${NC} $1"; }
step() { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }

# INSTALL_DIR = the src/ directory (where package.json lives)
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$INSTALL_DIR"
[ -f package.json ] || { err "package.json not found in $INSTALL_DIR"; exit 1; }

echo -e "\n${BOLD}  Mu — Setup${NC}"
info "Project (src) dir: $INSTALL_DIR"

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
step "1/5  Checking prerequisites"

missing=0
if command -v node >/dev/null 2>&1; then
    node_major=$(node -p 'process.versions.node.split(".")[0]')
    if [ "$node_major" -ge 20 ]; then log "node $(node -v)"; else err "node >= 20 required (found $(node -v))"; missing=1; fi
else
    err "node not found — install Node.js >= 20"; missing=1
fi

if command -v pnpm >/dev/null 2>&1; then
    log "pnpm $(pnpm -v)"
else
    err "pnpm not found — install with: corepack enable && corepack prepare pnpm@latest --activate"; missing=1
fi

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    log "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
else
    warn "ffmpeg/ffprobe not found on PATH — transcoding will not work until installed."
    warn "Fedora: sudo dnf install ffmpeg ffmpeg-libs   (or run scripts/setup-fedora.sh for NVENC)"
fi

[ "$missing" -eq 0 ] || { err "Missing required prerequisites — aborting."; exit 1; }

# ── 2. .env ───────────────────────────────────────────────────────────────────
step "2/5  Environment file"
if [ -f .env ]; then
    log ".env present (left as-is)"
else
    if [ -f .env.example ]; then
        cp .env.example .env
        log "Created .env from .env.example — edit it to set MU_DATA_DIR / MU_CACHE_DIR / paths."
    else
        warn "No .env and no .env.example — the app will use defaults (./data)."
    fi
fi

# ── 3. Install ────────────────────────────────────────────────────────────────
step "3/5  Installing dependencies (pnpm install)"
pnpm install

# ── 4. Build ──────────────────────────────────────────────────────────────────
step "4/5  Building (pnpm build)"
pnpm build

# ── 5. Migrate ────────────────────────────────────────────────────────────────
step "5/5  Applying database schema (pnpm db:migrate)"
pnpm db:migrate

# ── Done — offer service install ──────────────────────────────────────────────
echo ""
log "Build complete."
echo ""
echo -e "  Run it now:"
echo -e "    ${CYAN}pnpm dev${NC}     # development (live reload; server + client)"
echo -e "    ${CYAN}pnpm start${NC}   # run the built production server"
echo ""

read -r -p "  Install Mu as a system service so it starts on boot? [y/N]: " yn
if [ "${yn,,}" = "y" ]; then
    bash "$INSTALL_DIR/scripts/service.sh" install
else
    info "Skipped service install. You can do it later with:  pnpm service install"
fi

echo ""
log "Setup finished."
echo ""

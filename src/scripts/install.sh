#!/usr/bin/env bash
set -euo pipefail

# Mu - Self-Hosted Movie Streaming Platform
# Install Script

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

MU_DIR="${MU_INSTALL_DIR:-$(pwd)}"

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info()  { echo -e "${CYAN}[i]${NC} $1"; }

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════╗"
echo "  ║       Mu - Movie Platform        ║"
echo "  ║         Install Script           ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"

# Check OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM="linux";;
  Darwin*) PLATFORM="macos";;
  *)       error "Unsupported OS: $OS";;
esac
info "Detected platform: $PLATFORM"

# Check Node.js
check_node() {
  if ! command -v node &>/dev/null; then
    warn "Node.js not found."
    if [ "$PLATFORM" = "linux" ]; then
      info "Install Node.js 22:"
      echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
      echo "  sudo apt-get install -y nodejs"
    else
      echo "  brew install node@22"
    fi
    error "Please install Node.js 22+ and re-run this script."
  fi

  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 20 ]; then
    error "Node.js 20+ required (found v$(node -v))"
  fi
  log "Node.js $(node -v) detected"
}

# Check pnpm
check_pnpm() {
  if ! command -v pnpm &>/dev/null; then
    info "Installing pnpm..."
    npm install -g pnpm@latest
  fi
  log "pnpm $(pnpm -v) detected"
}

# Check FFmpeg
check_ffmpeg() {
  if ! command -v ffmpeg &>/dev/null; then
    warn "FFmpeg not found. Streaming features require FFmpeg."
    if [ "$PLATFORM" = "linux" ]; then
      info "Install FFmpeg:"
      echo "  sudo apt-get install -y ffmpeg"
    else
      echo "  brew install ffmpeg"
    fi
    warn "Continuing without FFmpeg - install it later for streaming support."
  else
    log "FFmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}') detected"
  fi
}

# Create data directories
create_dirs() {
  info "Creating data directories..."
  mkdir -p "$MU_DIR/data/db"
  mkdir -p "$MU_DIR/data/cache/images"
  mkdir -p "$MU_DIR/data/cache/streams"
  mkdir -p "$MU_DIR/data/cache/subtitles"
  mkdir -p "$MU_DIR/data/logs"
  log "Data directories created"
}

# Install dependencies
install_deps() {
  info "Installing dependencies..."
  cd "$MU_DIR"
  pnpm install
  log "Dependencies installed"
}

# Build project
build_project() {
  info "Building project..."
  cd "$MU_DIR"
  pnpm run build
  log "Project built successfully"
}

# Create .env if not exists
setup_env() {
  if [ ! -f "$MU_DIR/.env" ]; then
    if [ -f "$MU_DIR/.env.example" ]; then
      cp "$MU_DIR/.env.example" "$MU_DIR/.env"
      # Generate random secrets
      JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
      COOKIE_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
      sed -i.bak "s/MU_AUTH_JWT_SECRET=.*/MU_AUTH_JWT_SECRET=$JWT_SECRET/" "$MU_DIR/.env" 2>/dev/null || true
      sed -i.bak "s/MU_AUTH_COOKIE_SECRET=.*/MU_AUTH_COOKIE_SECRET=$COOKIE_SECRET/" "$MU_DIR/.env" 2>/dev/null || true
      rm -f "$MU_DIR/.env.bak"
      log "Environment file created with generated secrets"
    fi
  else
    log "Environment file already exists"
  fi
}

# Run
main() {
  check_node
  check_pnpm
  check_ffmpeg
  create_dirs
  install_deps
  setup_env
  build_project

  echo ""
  echo -e "${GREEN}${BOLD}Installation complete!${NC}"
  echo ""
  echo -e "  Start the server:  ${CYAN}pnpm start${NC}"
  echo -e "  Development mode:  ${CYAN}pnpm dev${NC}"
  echo ""
  echo -e "  Open ${CYAN}http://localhost:8080${NC} to set up your admin account."
  echo ""
}

main "$@"

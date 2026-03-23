#!/usr/bin/env bash
# deploy.sh — Universal deploy & restart script.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Usage: ./deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR"
SERVER_DIST="$SRC_DIR/packages/server/dist/main.js"
PID_FILE="$PROJECT_ROOT/data/mu-server.pid"

# Detect Windows (Git Bash / MSYS2)
IS_WINDOWS=false
if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == mingw* ]] || [[ "$OSTYPE" == cygwin* ]] || [ -d "/c/Windows" ]; then
    IS_WINDOWS=true
fi

echo "=== Mu Deploy ==="
echo "Platform: $($IS_WINDOWS && echo 'Windows' || echo 'Unix')"

# ── 1. Pull latest code ──
cd "$PROJECT_ROOT"
echo "--- git pull ---"
git pull --ff-only || git pull

# ── 2. Install & build ──
cd "$SRC_DIR"
echo "--- pnpm install ---"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo "--- pnpm build ---"
pnpm build

# ── 2.5. Run database migrations ──
echo "--- database migrations ---"
cd "$SRC_DIR"
node scripts/migrate.js 2>/dev/null || echo "Migration script skipped"


# ── 3. Restart server ──
# restart.sh handles NSSM service on Windows, nohup fallback elsewhere
bash "$SRC_DIR/restart.sh"
echo "=== Deploy complete ==="

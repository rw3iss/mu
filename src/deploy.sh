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


# ── 3. Stop existing server ──
echo "--- stopping server ---"
source "$SRC_DIR/stop.sh"

# ── 4. Start server (detached) ──
echo "--- starting server ---"
cd "$SRC_DIR/packages/server"

if [ ! -f "$SERVER_DIST" ]; then
    echo "ERROR: $SERVER_DIST not found. Build may have failed."
    exit 1
fi

LOG_DIR="$PROJECT_ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"
mkdir -p "$(dirname "$PID_FILE")"

NODE_ENV=production nohup node "$SERVER_DIST" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
echo "$SERVER_PID" > "$PID_FILE"

echo "Server started (PID: $SERVER_PID)"
echo "Log file: $LOG_FILE"

# ── 5. Verify startup ──
sleep 3
if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== Deploy complete ==="
else
    echo "WARNING: Server may have failed to start. Check $LOG_FILE"
    tail -20 "$LOG_FILE" 2>/dev/null
    exit 1
fi

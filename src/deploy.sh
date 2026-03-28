#!/usr/bin/env bash
# deploy.sh — Universal deploy & restart script.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Usage: ./deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR"
SERVER_DIST="$SRC_DIR/packages/server/dist/main.js"

# Detect Windows (Git Bash / MSYS2)
IS_WINDOWS=false
if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == mingw* ]] || [[ "$OSTYPE" == cygwin* ]] || [ -d "/c/Windows" ]; then
    IS_WINDOWS=true
fi

# Read configured port
SERVER_PORT=4000
for config_path in \
    "$PROJECT_ROOT/data/config/config.yml" \
    "$SRC_DIR/data/config/config.yml" \
    "$SRC_DIR/packages/server/data/config/config.yml"; do
    if [ -f "$config_path" ]; then
        parsed_port=$(grep -E '^\s+port:\s*[0-9]+' "$config_path" 2>/dev/null | head -1 | grep -oE '[0-9]+')
        if [ -n "$parsed_port" ]; then
            SERVER_PORT="$parsed_port"
            break
        fi
    fi
done

echo "=== Mu Deploy ==="
echo "Platform: $($IS_WINDOWS && echo 'Windows' || echo 'Unix')"

# ── 1. Stop server FIRST (before pull/build) ──
echo "--- stopping server ---"
if $IS_WINDOWS && command -v nssm &>/dev/null && nssm status mu-server &>/dev/null; then
    nssm stop mu-server 2>/dev/null || true
    # Kill orphaned FFmpeg processes that NSSM doesn't clean up
    ffmpeg_pids=$(tasklist 2>/dev/null | grep -i "ffmpeg" | awk '{print $2}' || true)
    if [ -n "$ffmpeg_pids" ]; then
        for pid in $ffmpeg_pids; do
            taskkill //F //PID "$pid" 2>/dev/null || true
        done
        echo "Killed orphaned FFmpeg processes"
    fi
else
    source "$SRC_DIR/stop.sh" 2>/dev/null || true
fi

# Wait for port to be freed
for i in 1 2 3 4 5 6 7 8 9 10; do
    if $IS_WINDOWS; then
        if ! netstat -ano 2>/dev/null | grep -q ":${SERVER_PORT}.*LISTENING"; then
            break
        fi
    else
        if ! (command -v lsof &>/dev/null && lsof -ti ":${SERVER_PORT}" &>/dev/null) && \
           ! (command -v ss &>/dev/null && ss -tlnp "sport = :${SERVER_PORT}" 2>/dev/null | grep -q LISTEN); then
            break
        fi
    fi
    echo "Waiting for port $SERVER_PORT to be freed... ($i)"
    sleep 1
done
echo "Server stopped"

# ── 2. Pull latest code ──
cd "$PROJECT_ROOT"
echo "--- git pull ---"
git pull --ff-only || git pull

# ── 3. Install & build ──
cd "$SRC_DIR"
echo "--- pnpm install ---"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo "--- pnpm build ---"
pnpm build

# ── 4. Run database migrations ──
echo "--- database migrations ---"
cd "$SRC_DIR"
node scripts/migrate.js 2>/dev/null || echo "Migration script skipped"

# ── 5. Start server ──
echo "--- starting server ---"
if $IS_WINDOWS && command -v nssm &>/dev/null && nssm status mu-server &>/dev/null; then
    nssm start mu-server 2>/dev/null || true
    # Wait for it to bind
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if netstat -ano 2>/dev/null | grep -q ":${SERVER_PORT}.*LISTENING"; then
            echo "=== Deploy complete (NSSM service) ==="
            exit 0
        fi
        sleep 1
    done
    echo "WARNING: NSSM service may have failed to start"
    tail -10 "$PROJECT_ROOT/data/logs/server.log" 2>/dev/null
    exit 1
else
    bash "$SRC_DIR/restart.sh"
fi
echo "=== Deploy complete ==="

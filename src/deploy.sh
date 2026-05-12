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
    # Tell NSSM to stop. The broader Session-0 node.exe orphan sweep
    # runs AFTER `git pull` (see step 5) so that fixes to the kill
    # logic apply on the same deploy that introduces them — bash caches
    # the running script in memory and won't pick up pulled changes
    # from this file mid-execution, but `bash scripts/kill-orphans.sh`
    # is a fresh process that always reads the latest version.
    nssm stop mu-server 2>/dev/null || true
else
    source "$SRC_DIR/stop.sh" 2>/dev/null || true
fi

# Wait for port to be freed, then force-kill if still held
for i in 1 2 3 4 5 6 7 8 9 10; do
    if $IS_WINDOWS; then
        if ! netstat -ano 2>/dev/null | grep -q ":${SERVER_PORT}.*LISTENING"; then
            break
        fi
        # After 5 seconds, force-kill whatever holds the port
        if [ "$i" -ge 5 ]; then
            port_pids=$(netstat -ano 2>/dev/null | grep ":${SERVER_PORT} " | grep LISTENING | awk '{print $NF}' | sort -u || true)
            for pid in $port_pids; do
                echo "Force-killing PID $pid holding port $SERVER_PORT"
                taskkill //F //PID "$pid" 2>/dev/null || true
            done
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

# ── 3a. Verify the client SPA actually got written ──
# Turbo's cache occasionally restores a partial dist/ that contains only
# the public-folder assets (PNGs, favicon) but is missing index.html and
# the assets/ bundle. When that happens the server returns
# `{"message":"Cannot GET /"}` because the SPA fallback hook in main.ts
# has no index.html to read.
#
# Detect that case and force a fresh rebuild of just the client package,
# bypassing turbo's cache.
CLIENT_DIST="$SRC_DIR/packages/client/dist"
if [ ! -s "$CLIENT_DIST/index.html" ] || [ ! -d "$CLIENT_DIST/assets" ]; then
    echo "WARNING: client/dist is missing index.html or assets/ — forcing fresh rebuild"
    rm -rf "$CLIENT_DIST"
    # --force bypasses turbo cache for this run; the client package alone
    # rebuilds in 1-3s on this hardware, so the cost is negligible.
    pnpm --filter @mu/client build --force 2>&1 | tail -10 || pnpm --filter @mu/client build
    if [ ! -s "$CLIENT_DIST/index.html" ] || [ ! -d "$CLIENT_DIST/assets" ]; then
        echo "ERROR: client/dist still missing index.html or assets/ after rebuild — aborting deploy"
        exit 1
    fi
    echo "client/dist rebuilt OK"
fi

# ── 4. Run database migrations ──
echo "--- database migrations ---"
cd "$SRC_DIR"
node scripts/migrate.js 2>/dev/null || echo "Migration script skipped"

# ── 5. Kill orphan FFmpeg / Session-0 node.exe ──
# This runs as a fresh `bash` invocation so the just-pulled version of
# kill-orphans.sh executes (the running deploy.sh is cached in memory
# from before `git pull`).
echo "--- killing orphans ---"
bash "$SRC_DIR/scripts/kill-orphans.sh" || true

# ── 6. Start server ──
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

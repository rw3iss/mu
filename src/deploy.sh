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
# Force-checkout main first. If prod ever ends up on a detached HEAD
# (manual bisect, accidental checkout) the next `git pull` would
# silently pull into the wrong ref and the new code never lands. `-f`
# discards any local untracked-but-not-ignored changes — prod should
# never have meaningful local edits, so this is the right default.
cd "$PROJECT_ROOT"
echo "--- git sync to origin/main ---"
git fetch origin main --quiet
git checkout -f main
git reset --hard origin/main
echo "HEAD now $(git rev-parse --short HEAD)"

# ── 3. Install & build ──
cd "$SRC_DIR"
echo "--- pnpm install ---"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# ── 3. Build ──
# Always nuke client/dist before building. We've been bitten 3+ times
# by Turbo's cache restoring a partial dist (PNGs but no index.html /
# no assets/), which presents as a 404 at `/`. A clean dist directory
# every deploy eliminates the entire failure mode at the cost of ~2s
# of build time — trivially worth it.
CLIENT_DIST="$SRC_DIR/packages/client/dist"
rm -rf "$CLIENT_DIST"

echo "--- pnpm build ---"
pnpm build

# Guard against the cache regression coming back: vite-direct rebuild
# if pnpm/turbo somehow produced a partial dist anyway.
if [ ! -s "$CLIENT_DIST/index.html" ] || [ ! -d "$CLIENT_DIST/assets" ]; then
    echo "WARNING: client/dist is missing index.html or assets/ after pnpm build — forcing direct vite build"
    rm -rf "$CLIENT_DIST"
    (cd "$SRC_DIR/packages/client" && pnpm exec vite build) || {
        echo "ERROR: vite build failed"
        exit 1
    }
    if [ ! -s "$CLIENT_DIST/index.html" ] || [ ! -d "$CLIENT_DIST/assets" ]; then
        echo "ERROR: client/dist still missing index.html or assets/ — aborting deploy"
        exit 1
    fi
fi
echo "client/dist OK ($(ls "$CLIENT_DIST/assets" 2>/dev/null | wc -l) asset files)"

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

# ── 6. Start server + verify HTTP 200 (with one retry) ──
#
# Two-step verification: first confirm the port is bound (process is
# alive), then confirm an actual HTTP request to / returns 200 (SPA
# is being served, not a 404 from a broken dist or a stuck Nest
# bootstrap). If either fails on the first start, restart once and
# retry. If it still fails, tail the log and bail with non-zero.
start_and_verify() {
    local attempt="$1"
    echo "--- starting server (attempt $attempt) ---"
    if $IS_WINDOWS && command -v nssm &>/dev/null && nssm status mu-server &>/dev/null; then
        nssm start mu-server 2>/dev/null || true
    else
        bash "$SRC_DIR/restart.sh" 2>/dev/null || true
    fi

    # Wait for port bind
    local bound=false
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if $IS_WINDOWS; then
            if netstat -ano 2>/dev/null | grep -q ":${SERVER_PORT}.*LISTENING"; then
                bound=true
                break
            fi
        else
            if (command -v lsof &>/dev/null && lsof -ti ":${SERVER_PORT}" &>/dev/null) || \
               (command -v ss &>/dev/null && ss -tlnp "sport = :${SERVER_PORT}" 2>/dev/null | grep -q LISTEN); then
                bound=true
                break
            fi
        fi
        sleep 1
    done
    if ! $bound; then
        echo "FAIL: port $SERVER_PORT never bound on attempt $attempt"
        return 1
    fi

    # Then verify HTTP 200 from a real request to /
    local code=""
    for i in 1 2 3 4 5 6 7 8 9 10; do
        if command -v curl &>/dev/null; then
            code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "https://localhost:${SERVER_PORT}/" 2>/dev/null || true)
            [ "$code" = "200" ] && {
                echo "Verified: GET / → 200"
                return 0
            }
            code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${SERVER_PORT}/" 2>/dev/null || true)
            [ "$code" = "200" ] && {
                echo "Verified: GET / → 200"
                return 0
            }
        else
            # No curl — treat port-bound as good enough.
            echo "(no curl; port-bound check passed)"
            return 0
        fi
        sleep 1
    done
    echo "FAIL: HTTP probe returned '$code' on attempt $attempt (expected 200)"
    return 1
}

if start_and_verify 1; then
    echo "=== Deploy complete ==="
    exit 0
fi

echo "--- first start did not verify — stopping + retrying ---"
if $IS_WINDOWS && command -v nssm &>/dev/null; then
    nssm stop mu-server 2>/dev/null || true
fi
sleep 2
bash "$SRC_DIR/scripts/kill-orphans.sh" 2>/dev/null || true
sleep 1
if start_and_verify 2; then
    echo "=== Deploy complete (after retry) ==="
    exit 0
fi

echo "FATAL: server failed to verify after 2 attempts. Last 20 log lines:"
tail -20 "$PROJECT_ROOT/data/logs/server.log" 2>/dev/null
exit 1

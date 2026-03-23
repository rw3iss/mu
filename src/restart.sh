#!/usr/bin/env bash
# restart.sh — Restart the Mu server without rebuilding.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# On Windows, prefers NSSM service if installed (avoids nohup FFmpeg issues).
# Usage: ./restart.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR"
SERVER_DIST="$SRC_DIR/packages/server/dist/main.js"
PID_FILE="$PROJECT_ROOT/data/mu-server.pid"

IS_WINDOWS=false
if [[ "$(uname -s)" == CYGWIN* ]] || [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]]; then
    IS_WINDOWS=true
fi

echo "=== Mu Restart ==="

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

# ── Windows: use NSSM service if available ──
if $IS_WINDOWS && command -v nssm &>/dev/null; then
    # Check if service exists
    if nssm status mu-server &>/dev/null; then
        echo "Stopping NSSM service..."
        nssm stop mu-server 2>/dev/null || true

        # Wait for port to actually be freed (Windows can take a few seconds)
        for i in 1 2 3 4 5 6 7 8; do
            if ! netstat -ano 2>/dev/null | grep -q ":${SERVER_PORT:-4000}.*LISTENING"; then
                break
            fi
            echo "Waiting for port ${SERVER_PORT:-4000} to be freed... ($i)"
            sleep 1
        done

        echo "Starting NSSM service..."
        nssm start mu-server 2>/dev/null || true

        # Wait for the service to bind the port
        for i in 1 2 3 4 5 6 7 8 9 10; do
            if netstat -ano 2>/dev/null | grep -q ":${SERVER_PORT:-4000}.*LISTENING"; then
                echo "=== Restart complete (NSSM service) ==="
                exit 0
            fi
            sleep 1
        done

        echo "WARNING: NSSM service may have failed to start"
        tail -10 "$PROJECT_ROOT/data/logs/server.log" 2>/dev/null
        exit 1
    fi
    # Service doesn't exist — fall through to nohup method
fi

# ── Stop existing server ──
source "$SRC_DIR/stop.sh"

# ── Start server ──
if [ ! -f "$SERVER_DIST" ]; then
    echo "ERROR: $SERVER_DIST not found. Run deploy.sh first to build."
    exit 1
fi

LOG_DIR="$PROJECT_ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"
mkdir -p "$(dirname "$PID_FILE")"

cd "$SRC_DIR/packages/server"
NODE_ENV=production nohup node "$SERVER_DIST" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
echo "$SERVER_PID" > "$PID_FILE"

echo "Server started (PID: $SERVER_PID)"
echo "Log: $LOG_FILE"

sleep 3
if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== Restart complete ==="
else
    echo "WARNING: Server may have failed to start."
    tail -20 "$LOG_FILE" 2>/dev/null
    exit 1
fi

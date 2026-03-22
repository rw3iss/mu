#!/usr/bin/env bash
# restart.sh — Restart the Mu server without rebuilding.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
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
if $IS_WINDOWS; then
    # On Windows, nohup breaks child process spawning (FFmpeg gets 0xC0000142).
    # Use PowerShell Start-Process to launch in a proper Windows process context.
    WIN_NODE="$(cygpath -w "$(which node)")"
    WIN_DIST="$(cygpath -w "$SERVER_DIST")"
    WIN_LOG="$(cygpath -w "$LOG_FILE")"
    powershell.exe -Command "Start-Process -FilePath '$WIN_NODE' -ArgumentList '$WIN_DIST' -RedirectStandardOutput '$WIN_LOG' -RedirectStandardError '$WIN_LOG' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id" > /tmp/mu-server-pid.txt 2>/dev/null
    SERVER_PID=$(cat /tmp/mu-server-pid.txt 2>/dev/null | tr -d '[:space:]')
    rm -f /tmp/mu-server-pid.txt
    # Set NODE_ENV in the registry for the process (or just accept it won't be set — NestJS defaults to production when not 'development')
else
    NODE_ENV=production nohup node "$SERVER_DIST" >> "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    disown "$SERVER_PID" 2>/dev/null || true
fi
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

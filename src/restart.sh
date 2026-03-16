#!/usr/bin/env bash
# restart.sh — Restart the Mu server without rebuilding.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Usage: ./restart.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIST="$SCRIPT_DIR/packages/server/dist/main.js"

echo "=== Mu Restart ==="

# ── Stop existing server ──
echo "--- stopping server ---"
PIDS=""

# Method 1: pgrep (Linux/macOS)
if command -v pgrep &>/dev/null; then
    PIDS=$(pgrep -f "node.*dist/main\.js" 2>/dev/null || true)
fi

# Method 2: ps + grep (Git Bash / MSYS2 / generic Unix)
if [ -z "$PIDS" ]; then
    PIDS=$(ps aux 2>/dev/null | grep "[n]ode.*dist/main\.js" | awk '{print $2}' || true)
fi

# Method 3: Windows wmic
if [ -z "$PIDS" ] && ([ -f "/c/Windows/System32/wbem/wmic.exe" ] || command -v wmic.exe &>/dev/null); then
    WMIC_OUT=$(cmd.exe /c "wmic process where \"commandline like '%dist/main.js%'\" get processid /format:list" 2>/dev/null || true)
    PIDS=$(echo "$WMIC_OUT" | grep -oP 'ProcessId=\K\d+' 2>/dev/null || echo "$WMIC_OUT" | sed -n 's/ProcessId=//p' | tr -d '\r' || true)
fi

if [ -n "$PIDS" ]; then
    for pid in $PIDS; do
        echo "Killing PID $pid"
        kill "$pid" 2>/dev/null || taskkill.exe /PID "$pid" /F 2>/dev/null || true
    done
    sleep 2
else
    echo "No running server found"
fi

# ── Start server ──
if [ ! -f "$SERVER_DIST" ]; then
    echo "ERROR: $SERVER_DIST not found. Run deploy.sh first to build."
    exit 1
fi

LOG_DIR="$PROJECT_ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"

cd "$SCRIPT_DIR/packages/server"
NODE_ENV=production nohup node "$SERVER_DIST" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true

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

#!/usr/bin/env bash
# deploy.sh — Universal deploy & restart script.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Usage: ./deploy.sh
#
# What it does:
#   1. git pull
#   2. pnpm install (if needed) + pnpm build
#   3. Find and kill the running Mu server process
#   4. Start the server in the background (detached)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR"
SERVER_DIST="$SRC_DIR/packages/server/dist/main.js"

echo "=== Mu Deploy ==="
echo "Project root: $PROJECT_ROOT"
echo "Source dir:    $SRC_DIR"

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

# ── 3. Stop existing server ──
echo "--- stopping server ---"
stop_server() {
    # Try multiple methods to find and kill the Mu server process

    # Method 1: Find node process running main.js
    local pids=""

    if command -v pgrep &>/dev/null; then
        pids=$(pgrep -f "node.*dist/main\.js" 2>/dev/null || true)
    fi

    if [ -z "$pids" ]; then
        # Method 2: ps + grep (works on Git Bash / MSYS2)
        pids=$(ps aux 2>/dev/null | grep "[n]ode.*dist/main\.js" | awk '{print $2}' || true)
    fi

    if [ -z "$pids" ]; then
        # Method 3: Windows tasklist (Git Bash can call Windows commands via cmd)
        if [ -f "/c/Windows/System32/tasklist.exe" ] || command -v tasklist.exe &>/dev/null; then
            # Get node.exe PIDs, then check their command lines via wmic
            local wmic_result
            wmic_result=$(cmd.exe /c "wmic process where \"commandline like '%dist/main.js%'\" get processid /format:list" 2>/dev/null || true)
            pids=$(echo "$wmic_result" | grep -oP 'ProcessId=\K\d+' || true)
        fi
    fi

    if [ -n "$pids" ]; then
        echo "Killing server process(es): $pids"
        for pid in $pids; do
            kill "$pid" 2>/dev/null || taskkill.exe /PID "$pid" /F 2>/dev/null || true
        done
        # Wait for processes to exit
        sleep 2
    else
        echo "No running server found"
    fi
}
stop_server

# ── 4. Start server (detached) ──
echo "--- starting server ---"
cd "$SRC_DIR/packages/server"

if [ ! -f "$SERVER_DIST" ]; then
    echo "ERROR: $SERVER_DIST not found. Build may have failed."
    exit 1
fi

# Use nohup to detach; redirect output to a log file
LOG_DIR="$PROJECT_ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"

# Cross-platform: nohup works on Linux/macOS/Git Bash
NODE_ENV=production nohup node "$SERVER_DIST" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true

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

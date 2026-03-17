#!/usr/bin/env bash
# stop.sh — Stop the running CineHost server process.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Can be sourced (from deploy.sh/restart.sh) or run directly.

SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PID_FILE="$PROJECT_ROOT/data/mu-server.pid"

# Detect Windows (Git Bash / MSYS2)
IS_WINDOWS=false
if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == mingw* ]] || [[ "$OSTYPE" == cygwin* ]] || [ -d "/c/Windows" ]; then
    IS_WINDOWS=true
fi

# Read configured port from config.yml (default 4000)
SERVER_PORT=4000
for config_path in \
    "$PROJECT_ROOT/data/config/config.yml" \
    "$SCRIPT_DIR/data/config/config.yml" \
    "$SCRIPT_DIR/packages/server/data/config/config.yml"; do
    if [ -f "$config_path" ]; then
        parsed_port=$(grep -E '^\s+port:\s*[0-9]+' "$config_path" 2>/dev/null | head -1 | grep -oE '[0-9]+')
        if [ -n "$parsed_port" ]; then
            SERVER_PORT="$parsed_port"
            break
        fi
    fi
done

kill_pid() {
    local pid="$1"
    if $IS_WINDOWS; then
        taskkill.exe //PID "$pid" //F 2>/dev/null && echo "Killed PID $pid" || true
    else
        kill "$pid" 2>/dev/null && echo "Killed PID $pid" || true
    fi
}

killed=false

# ── Method 1: PID file ──
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$OLD_PID" ]; then
        echo "Found PID file: $OLD_PID"
        kill_pid "$OLD_PID"
        killed=true
        rm -f "$PID_FILE"
    fi
fi

# ── Method 2: Kill by port (most reliable fallback) ──
# Find PID listening on the configured port and kill it
if $IS_WINDOWS; then
    # Windows: use netstat to find PID on the port
    PORT_PID=$(netstat -aon 2>/dev/null | grep ":${SERVER_PORT} " | grep "LISTENING" | awk '{print $NF}' | head -1 | tr -d '[:space:]')
    if [ -n "$PORT_PID" ] && [ "$PORT_PID" != "0" ]; then
        echo "Found process on port ${SERVER_PORT}: PID $PORT_PID"
        kill_pid "$PORT_PID"
        killed=true
    fi
else
    # Unix: try lsof first, then ss, then fuser
    PORT_PID=""
    if command -v lsof &>/dev/null; then
        PORT_PID=$(lsof -ti ":${SERVER_PORT}" 2>/dev/null | head -1)
    elif command -v ss &>/dev/null; then
        PORT_PID=$(ss -tlnp "sport = :${SERVER_PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
    elif command -v fuser &>/dev/null; then
        PORT_PID=$(fuser "${SERVER_PORT}/tcp" 2>/dev/null | tr -d '[:space:]')
    fi
    if [ -n "$PORT_PID" ]; then
        echo "Found process on port ${SERVER_PORT}: PID $PORT_PID"
        kill_pid "$PORT_PID"
        killed=true
    fi
fi

# ── Method 3: pgrep / ps fallback (by process name) ──
if ! $killed; then
    if ! $IS_WINDOWS && command -v pgrep &>/dev/null; then
        PIDS=$(pgrep -f "node.*dist/main" 2>/dev/null || true)
    else
        PIDS=$(ps aux 2>/dev/null | grep "[n]ode.*dist/main" | awk '{print $2}' || true)
    fi
    if [ -n "$PIDS" ]; then
        for pid in $PIDS; do
            kill_pid "$pid"
            killed=true
        done
    fi
fi

if $killed; then
    sleep 2
    # Verify the port is actually free now
    if $IS_WINDOWS; then
        STILL=$(netstat -aon 2>/dev/null | grep ":${SERVER_PORT} " | grep "LISTENING" | awk '{print $NF}' | head -1 | tr -d '[:space:]')
        if [ -n "$STILL" ] && [ "$STILL" != "0" ]; then
            echo "Port ${SERVER_PORT} still in use (PID: $STILL), force killing..."
            taskkill.exe //PID "$STILL" //F 2>/dev/null || true
            sleep 1
        fi
    fi
    echo "Server stopped"
else
    echo "No running server found"
fi

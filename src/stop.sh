#!/usr/bin/env bash
# stop.sh — Stop the running CineHost server process.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Can be sourced (from deploy.sh/restart.sh) or run directly.

SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)}"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PID_FILE="$PROJECT_ROOT/data/mu-server.pid"

# Detect Windows (Git Bash / MSYS2)
IS_WINDOWS=false
if [[ "$(uname -s)" == CYGWIN* ]] || [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]]; then
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

# ── Kill by port (most reliable) ──
kill_port() {
    local port="$1"
    if $IS_WINDOWS; then
        local pids
        pids=$(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $NF}' | sort -u)
        if [ -z "$pids" ]; then
            return 1
        fi
        for pid in $pids; do
            echo "Killing PID $pid on port $port..."
            taskkill //F //PID "$pid" 2>&1
        done
        # Verify
        local remaining
        remaining=$(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING)
        if [ -n "$remaining" ]; then
            echo "Warning: port $port still in use, retrying..."
            sleep 1
            pids=$(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $NF}' | sort -u)
            for pid in $pids; do
                taskkill //F //PID "$pid" 2>&1
            done
        fi
        return 0
    else
        # Unix: try lsof, ss, fuser
        local port_pid=""
        if command -v lsof &>/dev/null; then
            port_pid=$(lsof -ti ":${port}" 2>/dev/null | head -1)
        elif command -v ss &>/dev/null; then
            port_pid=$(ss -tlnp "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
        elif command -v fuser &>/dev/null; then
            port_pid=$(fuser "${port}/tcp" 2>/dev/null | tr -d '[:space:]')
        fi
        if [ -n "$port_pid" ]; then
            echo "Killing PID $port_pid on port $port..."
            kill "$port_pid" 2>/dev/null
            return 0
        fi
        return 1
    fi
}

killed=false

# ── Method 1: Kill by PID file ──
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$OLD_PID" ]; then
        echo "Found PID file: $OLD_PID"
        if $IS_WINDOWS; then
            taskkill //F //PID "$OLD_PID" 2>/dev/null && echo "Killed PID $OLD_PID" || true
        else
            kill "$OLD_PID" 2>/dev/null && echo "Killed PID $OLD_PID" || true
        fi
        killed=true
        rm -f "$PID_FILE"
    fi
fi

# ── Method 2: Kill by port (always run to catch orphans) ──
if kill_port "$SERVER_PORT"; then
    killed=true
fi

# ── Method 3: pgrep / ps fallback ──
if ! $killed; then
    if ! $IS_WINDOWS && command -v pgrep &>/dev/null; then
        PIDS=$(pgrep -f "node.*dist/main" 2>/dev/null || true)
    else
        PIDS=$(ps aux 2>/dev/null | grep "[n]ode.*dist/main" | awk '{print $2}' || true)
    fi
    if [ -n "$PIDS" ]; then
        for pid in $PIDS; do
            if $IS_WINDOWS; then
                taskkill //F //PID "$pid" 2>&1
            else
                kill "$pid" 2>/dev/null
            fi
            echo "Killed PID $pid"
            killed=true
        done
    fi
fi

if $killed; then
    # Wait for the port to actually be freed (Windows can take a few seconds)
    for i in 1 2 3 4 5; do
        if $IS_WINDOWS; then
            still_listening=$(netstat -ano 2>/dev/null | grep ":${SERVER_PORT} " | grep LISTENING || true)
        else
            still_listening=""
            if command -v lsof &>/dev/null; then
                still_listening=$(lsof -ti ":${SERVER_PORT}" 2>/dev/null || true)
            elif command -v ss &>/dev/null; then
                still_listening=$(ss -tlnp "sport = :${SERVER_PORT}" 2>/dev/null | grep LISTEN || true)
            fi
        fi
        if [ -z "$still_listening" ]; then
            break
        fi
        echo "Waiting for port $SERVER_PORT to be freed... ($i)"
        sleep 1
    done
    echo "Server stopped"
else
    echo "No running server found"
fi

#!/usr/bin/env bash
# stop.sh — Stop the running Mu server process.
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

kill_pid() {
    local pid="$1"
    if $IS_WINDOWS; then
        taskkill.exe //PID "$pid" //F 2>/dev/null && echo "Killed PID $pid" || true
    else
        kill "$pid" 2>/dev/null && echo "Killed PID $pid" || true
    fi
}

killed=false

# ── Method 1: PID file (fastest, most reliable) ──
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$OLD_PID" ]; then
        echo "Found PID file: $OLD_PID"
        kill_pid "$OLD_PID"
        killed=true
        rm -f "$PID_FILE"
    fi
fi

# ── Method 2: pgrep (Linux/macOS) ──
if ! $killed && ! $IS_WINDOWS && command -v pgrep &>/dev/null; then
    PIDS=$(pgrep -f "node.*dist/main" 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        for pid in $PIDS; do
            kill_pid "$pid"
            killed=true
        done
    fi
fi

# ── Method 3: Windows — use taskkill via PowerShell to find and kill node processes ──
# (wmic via cmd.exe hangs in Git Bash; PowerShell is more reliable)
if ! $killed && $IS_WINDOWS; then
    echo "Searching for Mu server processes..."
    # Use PowerShell to find node processes with "dist" + "main" in command line
    PIDS=$(powershell.exe -NoProfile -Command \
        "Get-WmiObject Win32_Process -Filter \"name='node.exe'\" | Where-Object { \$_.CommandLine -match 'dist.*main' } | ForEach-Object { \$_.ProcessId }" \
        2>/dev/null | tr -d '\r' | grep -E '^[0-9]+$' || true)
    if [ -n "$PIDS" ]; then
        for pid in $PIDS; do
            kill_pid "$pid"
            killed=true
        done
    fi
fi

# ── Method 4: ps (fallback for any Unix-like system) ──
if ! $killed; then
    PIDS=$(ps aux 2>/dev/null | grep "[n]ode.*dist/main" | awk '{print $2}' || true)
    if [ -n "$PIDS" ]; then
        for pid in $PIDS; do
            kill_pid "$pid"
            killed=true
        done
    fi
fi

if $killed; then
    sleep 2
    echo "Server stopped"
else
    echo "No running server found"
fi

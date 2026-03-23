#!/usr/bin/env bash
# status.sh — Show server status: how it's running, PID, port, uptime.
# Usage: pnpm status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
PID_FILE="$DATA_ROOT/data/mu-server.pid"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

IS_WINDOWS=false
if [[ "$(uname -s)" == CYGWIN* ]] || [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]]; then
    IS_WINDOWS=true
fi

echo "=== Mu Server Status ==="

# Detect NSSM service
NSSM_RUNNING=false
if $IS_WINDOWS && command -v nssm &>/dev/null; then
    NSSM_STATUS=$(nssm status mu-server 2>/dev/null)
    if [ -n "$NSSM_STATUS" ]; then
        if echo "$NSSM_STATUS" | grep -qiE "RUNNING|PAUSED"; then
            NSSM_RUNNING=true
            echo -e "  Mode:    ${GREEN}NSSM Service${NC} ($NSSM_STATUS)"
        else
            echo -e "  Mode:    ${YELLOW}NSSM Service${NC} ($NSSM_STATUS)"
        fi
    fi
fi

# Detect systemd service
SYSTEMD_RUNNING=false
if ! $IS_WINDOWS && command -v systemctl &>/dev/null; then
    if systemctl is-active mu-server &>/dev/null; then
        SYSTEMD_RUNNING=true
        echo -e "  Mode:    ${GREEN}systemd service${NC} (active)"
    elif systemctl is-enabled mu-server &>/dev/null 2>&1; then
        echo -e "  Mode:    ${YELLOW}systemd service${NC} (stopped)"
    fi
fi

# Detect launchd
LAUNCHD_RUNNING=false
if [[ "$(uname -s)" == "Darwin" ]] && [ -f "$HOME/Library/LaunchAgents/net.ryanweiss.mu-server.plist" ]; then
    if launchctl list 2>/dev/null | grep -q "net.ryanweiss.mu-server"; then
        LAUNCHD_RUNNING=true
        echo -e "  Mode:    ${GREEN}launchd service${NC} (loaded)"
    else
        echo -e "  Mode:    ${YELLOW}launchd plist${NC} (not loaded)"
    fi
fi

# Detect PID file (nohup mode)
if ! $NSSM_RUNNING && ! $SYSTEMD_RUNNING && ! $LAUNCHD_RUNNING; then
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "  Mode:    ${YELLOW}nohup (PID file)${NC}"
        else
            echo -e "  Mode:    ${RED}nohup (stale PID file)${NC}"
        fi
    else
        echo -e "  Mode:    ${RED}Not running${NC}"
    fi
fi

# Check port
SERVER_PORT=4000
PORT_PID=""
if $IS_WINDOWS; then
    PORT_PID=$(netstat -ano 2>/dev/null | grep ":${SERVER_PORT} " | grep LISTENING | awk '{print $NF}' | head -1)
else
    if command -v lsof &>/dev/null; then
        PORT_PID=$(lsof -ti ":${SERVER_PORT}" 2>/dev/null | head -1)
    elif command -v ss &>/dev/null; then
        PORT_PID=$(ss -tlnp "sport = :${SERVER_PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
    fi
fi

if [ -n "$PORT_PID" ]; then
    echo -e "  Port:    ${GREEN}${SERVER_PORT}${NC} (PID: $PORT_PID)"
else
    echo -e "  Port:    ${RED}${SERVER_PORT} (not listening)${NC}"
fi

# Check health endpoint
HEALTH=$(curl -s --max-time 3 "http://localhost:${SERVER_PORT}/api/v1/health/stats" 2>/dev/null)
if [ -n "$HEALTH" ]; then
    UPTIME=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(round(d['system']['uptime']))" 2>/dev/null || echo "?")
    MEMORY=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(round(d['system']['memoryUsed']/1048576))" 2>/dev/null || echo "?")
    PENDING=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['services']['pendingJobs'])" 2>/dev/null || echo "?")
    RUNNING=$(echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['services']['runningJobs'])" 2>/dev/null || echo "?")
    echo -e "  Health:  ${GREEN}OK${NC}"
    echo -e "  Uptime:  ${UPTIME}s"
    echo -e "  Memory:  ${MEMORY} MB"
    echo -e "  Jobs:    ${RUNNING} running, ${PENDING} pending"
else
    echo -e "  Health:  ${RED}Not responding${NC}"
fi

# Log file location
for log_path in \
    "$DATA_ROOT/data/logs/server.log" \
    "$PROJECT_ROOT/data/logs/server.log" \
    "$PROJECT_ROOT/packages/server/data/logs/server.log"; do
    if [ -f "$log_path" ]; then
        echo -e "  Log:     ${CYAN}$log_path${NC}"
        break
    fi
done

# Management commands
echo ""
if $NSSM_RUNNING; then
    echo "  Commands:"
    echo "    nssm restart mu-server    # restart"
    echo "    nssm stop mu-server       # stop"
    echo "    pnpm logs                 # tail logs"
elif $SYSTEMD_RUNNING; then
    echo "  Commands:"
    echo "    sudo systemctl restart mu-server"
    echo "    sudo systemctl stop mu-server"
    echo "    pnpm logs"
else
    echo "  Commands:"
    echo "    bash restart.sh           # restart"
    echo "    bash stop.sh              # stop"
    echo "    pnpm logs                 # tail logs"
fi

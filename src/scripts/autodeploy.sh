#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Mu — Auto-Deploy manager (Linux / systemd user service)
#
#   autodeploy.sh install     Install + enable + start the mu-autodeploy watcher
#   autodeploy.sh uninstall   Stop + disable + remove it
#   autodeploy.sh status      Show watcher state
#   autodeploy.sh start        | stop | restart
#   autodeploy.sh logs         Follow the deploy log
#   autodeploy.sh run          Run the watcher in the foreground (debug)
#
# Usage:  pnpm autodeploy <command>   (or  bash scripts/autodeploy.sh <command>)
#
# Installs `mu-autodeploy.service` (user unit) that runs auto-deploy-watch.sh:
# it polls origin/main and, on a new commit with a CLEAN working tree, rebuilds
# and restarts the `mu-server` user service. With `git push`, this box updates
# itself within the poll interval. A user service (not system) because the repo
# + node live under /home (SELinux) and it drives `systemctl --user`.
# ──────────────────────────────────────────────────────────────────────────────

SERVICE_NAME="mu-autodeploy"
USER_UNIT_DIR="$HOME/.config/systemd/user"
UNIT_PATH="$USER_UNIT_DIR/${SERVICE_NAME}.service"

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
log()  { echo -e "  ${GREEN}[+]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
info() { echo -e "  ${CYAN}[i]${NC} $1"; }
step() { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()  { echo -e "  ${RED}[x]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"        # src/
PROJECT_ROOT="$(cd "$INSTALL_DIR/.." && pwd)"
WATCHER="$INSTALL_DIR/scripts/auto-deploy-watch.sh"

require_systemd() { command -v systemctl >/dev/null 2>&1 || die "systemd (systemctl) not found."; }
ensure_xdg() { [ -n "${XDG_RUNTIME_DIR:-}" ] || export XDG_RUNTIME_DIR="/run/user/$(id -u)"; }
uctl() { systemctl --user "$@"; }

cmd_install() {
    require_systemd; ensure_xdg
    step "Installing auto-deploy watcher: ${SERVICE_NAME}"
    [ -f "$WATCHER" ] || die "Watcher not found at $WATCHER"
    local bash_bin; bash_bin="$(command -v bash)"

    # Boot-start without login (idempotent; usually already enabled for mu-server).
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
        info "Enabling linger (boot-start without login) — needs sudo once..."
        sudo loginctl enable-linger "$(id -un)" || warn "Could not enable linger; will start on login instead."
    fi

    info "Watcher:  $WATCHER"
    info "Repo:     $PROJECT_ROOT"
    info "Log:      $PROJECT_ROOT/data/logs/auto-deploy.log"
    echo ""

    mkdir -p "$USER_UNIT_DIR"
    cat > "$UNIT_PATH" <<UNIT
[Unit]
Description=Mu Auto-Deploy (poll origin/main → build → restart mu-server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$bash_bin $WATCHER
Restart=on-failure
RestartSec=30
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=default.target
UNIT

    uctl daemon-reload
    uctl enable --now "$SERVICE_NAME"
    log "Installed, enabled (start on boot), and started."
    echo ""
    sleep 1
    cmd_status || true
}

cmd_uninstall() {
    require_systemd; ensure_xdg
    step "Removing auto-deploy watcher: ${SERVICE_NAME}"
    [ -f "$UNIT_PATH" ] || { info "Not installed."; return 0; }
    uctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$UNIT_PATH"
    uctl daemon-reload
    log "Removed. (mu-server and the app are untouched.)"
}

cmd_start()   { require_systemd; ensure_xdg; uctl start   "$SERVICE_NAME" && log "started"; }
cmd_stop()    { require_systemd; ensure_xdg; uctl stop    "$SERVICE_NAME" && log "stopped"; }
cmd_restart() { require_systemd; ensure_xdg; uctl restart "$SERVICE_NAME" && log "restarted"; }

cmd_status() {
    require_systemd; ensure_xdg
    step "Auto-deploy status"
    if [ ! -f "$UNIT_PATH" ]; then warn "Not installed. Install with:  pnpm autodeploy install"; return 0; fi
    local active enabled
    active="$(uctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
    enabled="$(uctl is-enabled "$SERVICE_NAME" 2>/dev/null || true)"
    [ "$active" = "active" ] && echo -e "  State:    ${GREEN}active${NC}" || echo -e "  State:    ${RED}${active:-unknown}${NC}"
    echo -e "  On boot:  ${enabled:-unknown}"
    uctl status "$SERVICE_NAME" --no-pager -n 0 2>/dev/null | sed 's/^/  /' || true
    local logf="$PROJECT_ROOT/data/logs/auto-deploy.log"
    [ -f "$logf" ] && { echo ""; info "Recent deploy log:"; tail -n 5 "$logf" | sed 's/^/    /'; }
    echo ""; info "Logs:  pnpm autodeploy logs"
}

cmd_logs() {
    local logf="$PROJECT_ROOT/data/logs/auto-deploy.log"
    if [ -f "$logf" ]; then echo "=== tail -f $logf ==="; tail -n "${2:-80}" -f "$logf";
    else ensure_xdg; journalctl --user -u "$SERVICE_NAME" -n "${2:-80}" -f; fi
}

cmd_run() { exec "$WATCHER"; }

usage() { awk 'NR>=4 && /^#/{sub(/^# ?/,"");print;next} NR>=4{exit}' "${BASH_SOURCE[0]}"; }

case "${1:-}" in
    install)   cmd_install ;;
    uninstall) cmd_uninstall ;;
    status)    cmd_status ;;
    start)     cmd_start ;;
    stop)      cmd_stop ;;
    restart)   cmd_restart ;;
    logs)      cmd_logs "$@" ;;
    run)       cmd_run ;;
    ""|-h|--help|help) usage ;;
    *) die "Unknown command: $1 (try --help)" ;;
esac

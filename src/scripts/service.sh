#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Mu — Service Manager (Linux / systemd, user service)
#
#   service.sh install     Install + enable + start the mu-server user service
#   service.sh uninstall   Stop + disable + remove the unit  (KEEPS app & data)
#   service.sh status      Show service + port + health
#   service.sh start        | stop | restart
#   service.sh enable       | disable        (start-on-boot on/off)
#   service.sh logs         Follow the journal for the service
#
# Usage:  pnpm service <command>      (or  bash scripts/service.sh <command>)
#
# This installs a **user** service (`systemctl --user`), not a system one.
# Why: the app + nvm node live under /home (SELinux type user_home_t). A system
# service runs in the init_t domain, which SELinux forbids from executing /home
# binaries or reading /home files (status=203/EXEC, AVC denials) — even as root.
# A user service runs in your unconfined user context, so it Just Works in place.
# `loginctl enable-linger` makes it start at boot without an interactive login.
#
# The unit runs the BUILT server (run `pnpm build` / `pnpm setup` first), loads
# src/.env (MU_DATA_DIR / MU_CACHE_DIR / …), waits for the data + cache mounts
# (RequiresMountsFor) so it never shadows an unmounted removable drive, logs to
# the journal, and restarts on failure. No sudo needed except a one-time linger
# enable for boot-start.
# ──────────────────────────────────────────────────────────────────────────────

SERVICE_NAME="mu-server"
USER_UNIT_DIR="$HOME/.config/systemd/user"
UNIT_PATH="$USER_UNIT_DIR/${SERVICE_NAME}.service"
SYSTEM_UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
log()  { echo -e "  ${GREEN}[+]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()  { echo -e "  ${RED}[x]${NC} $1"; }
info() { echo -e "  ${CYAN}[i]${NC} $1"; }
step() { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()  { err "$1"; exit 1; }

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"        # the src/ dir
PROJECT_ROOT="$(cd "$INSTALL_DIR/.." && pwd)"      # repo root (holds data/)
MAIN_JS="${INSTALL_DIR}/packages/server/dist/main.js"
ENV_FILE="${INSTALL_DIR}/.env"

require_systemd() { command -v systemctl >/dev/null 2>&1 || die "systemd (systemctl) not found."; }

# `systemctl --user` / `journalctl --user` need XDG_RUNTIME_DIR in non-login shells.
ensure_xdg() { [ -n "${XDG_RUNTIME_DIR:-}" ] || export XDG_RUNTIME_DIR="/run/user/$(id -u)"; }
uctl()  { systemctl --user "$@"; }

# Read a KEY from src/.env (uncommented). Echoes value or empty.
env_get() {
    [ -f "$ENV_FILE" ] || return 0
    grep -E "^[[:space:]]*$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2- | sed 's/^["'\'']//;s/["'\'']$//'
}

resolve_dirs() {
    DATA_DIR="$(env_get MU_DATA_DIR)"; DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data}"
    CACHE_DIR="$(env_get MU_CACHE_DIR)"
}

# Remove a leftover SYSTEM unit (e.g. from a prior setup-fedora.sh) so the two
# don't collide. Needs root; skipped silently if not present.
remove_stale_system_unit() {
    [ -f "$SYSTEM_UNIT_PATH" ] || return 0
    warn "Found a conflicting system unit at $SYSTEM_UNIT_PATH — removing it."
    sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    sudo rm -f "$SYSTEM_UNIT_PATH"
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
}

# ── install ───────────────────────────────────────────────────────────────────
cmd_install() {
    require_systemd; ensure_xdg
    step "Installing user service: ${SERVICE_NAME}"

    [ -f "$MAIN_JS" ] || die "Built server not found at $MAIN_JS — run 'pnpm build' (or 'pnpm setup') first."
    local node_path; node_path="$(command -v node)" || die "node not found on PATH."
    resolve_dirs

    remove_stale_system_unit

    # Enable linger so the user manager (and our service) start at boot without login.
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
        info "Enabling linger (boot-start without login) — needs sudo once..."
        sudo loginctl enable-linger "$(id -un)" || warn "Could not enable linger; service will start on login instead."
    fi

    local mounts="$DATA_DIR"
    [ -n "$CACHE_DIR" ] && mounts="$mounts $CACHE_DIR"

    info "User:        $(id -un)  (user service)"
    info "Node:        $node_path"
    info "Server:      $MAIN_JS"
    info "Data dir:    $DATA_DIR"
    info "Cache dir:   ${CACHE_DIR:-<under data dir>}"
    info "Logs:        journal (journalctl --user -u $SERVICE_NAME)"
    info "Waits for:   $mounts"
    echo ""

    mkdir -p "$USER_UNIT_DIR"
    cat > "$UNIT_PATH" <<UNIT
[Unit]
Description=Mu Movie Server (CineHost)
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$mounts

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=-$ENV_FILE
Environment=NODE_ENV=production
ExecStart=$node_path $MAIN_JS
Restart=on-failure
RestartSec=5
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=default.target
UNIT

    uctl daemon-reload
    uctl enable --now "$SERVICE_NAME"
    log "Installed, enabled (start on boot), and started."
    echo ""
    sleep 2
    cmd_status || true
}

# ── uninstall (service only — never touches app or data) ──────────────────────
cmd_uninstall() {
    require_systemd; ensure_xdg
    step "Removing user service: ${SERVICE_NAME}"
    if [ ! -f "$UNIT_PATH" ]; then info "No ${SERVICE_NAME} user unit installed."; remove_stale_system_unit; return 0; fi
    uctl disable --now "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$UNIT_PATH"
    uctl daemon-reload
    log "Service removed. Your app, database, and data dir are untouched."
    info "(Linger left enabled; disable with: sudo loginctl disable-linger $(id -un))"
}

# ── pass-throughs ─────────────────────────────────────────────────────────────
cmd_start()   { require_systemd; ensure_xdg; uctl start   "$SERVICE_NAME" && log "started"; }
cmd_stop()    { require_systemd; ensure_xdg; uctl stop    "$SERVICE_NAME" && log "stopped"; }
cmd_restart() { require_systemd; ensure_xdg; uctl restart "$SERVICE_NAME" && log "restarted"; }
cmd_enable()  { require_systemd; ensure_xdg; uctl enable  "$SERVICE_NAME" && log "enabled (will start on boot)"; }
cmd_disable() { require_systemd; ensure_xdg; uctl disable "$SERVICE_NAME" && log "disabled (won't start on boot)"; }

# ── status ────────────────────────────────────────────────────────────────────
cmd_status() {
    require_systemd; ensure_xdg
    step "Mu service status"
    if [ ! -f "$UNIT_PATH" ]; then
        warn "Service not installed. Install with:  pnpm service install"
        return 0
    fi
    local active enabled
    active="$(uctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
    enabled="$(uctl is-enabled "$SERVICE_NAME" 2>/dev/null || true)"
    [ "$active" = "active" ] && echo -e "  State:    ${GREEN}active${NC}" || echo -e "  State:    ${RED}${active:-unknown}${NC}"
    echo -e "  On boot:  ${enabled:-unknown}  (linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null))"
    uctl status "$SERVICE_NAME" --no-pager -n 0 2>/dev/null | sed 's/^/  /' || true

    local port=4000
    if command -v ss >/dev/null 2>&1 && ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
        echo -e "  Port:     ${GREEN}$port listening${NC}"
    else
        echo -e "  Port:     ${YELLOW}$port not listening${NC}"
    fi
    if curl -fsS --max-time 3 "http://localhost:$port/api/v1/health/stats" >/dev/null 2>&1; then
        echo -e "  Health:   ${GREEN}OK${NC}"
    else
        echo -e "  Health:   ${YELLOW}not responding (ok if a user exists — endpoint needs auth)${NC}"
    fi
    echo ""
    info "Logs:  pnpm service logs    (or: journalctl --user -u $SERVICE_NAME -f)"
}

# ── logs ──────────────────────────────────────────────────────────────────────
cmd_logs() {
    ensure_xdg
    echo "=== journalctl --user -u $SERVICE_NAME -f ==="
    journalctl --user -u "$SERVICE_NAME" -n "${2:-80}" -f
}

usage() { sed -n '4,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
    install)   cmd_install ;;
    uninstall) cmd_uninstall ;;
    status)    cmd_status ;;
    start)     cmd_start ;;
    stop)      cmd_stop ;;
    restart)   cmd_restart ;;
    enable)    cmd_enable ;;
    disable)   cmd_disable ;;
    logs)      cmd_logs "$@" ;;
    ""|-h|--help|help) usage ;;
    *) err "Unknown command: $1"; echo ""; usage; exit 1 ;;
esac

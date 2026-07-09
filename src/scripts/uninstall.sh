#!/usr/bin/env bash
set -euo pipefail

# Mu - Uninstall Script
# Cross-platform script to remove Mu server, services, and optionally data (Linux, macOS, Windows)

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# ── Helpers ──────────────────────────────────────────────────────────────────

log()    { echo -e "  ${GREEN}[+]${NC} $1"; }
warn()   { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()    { echo -e "  ${RED}[x]${NC} $1"; }
info()   { echo -e "  ${CYAN}[i]${NC} $1"; }
step()   { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()    { err "$1"; exit 1; }

# ── Platform Detection ───────────────────────────────────────────────────────

detect_platform() {
    local os
    os="$(uname -s)"
    case "$os" in
        Linux*)               PLATFORM="linux" ;;
        Darwin*)              PLATFORM="macos" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *)                    die "Unsupported OS: $os" ;;
    esac
}

# ── Directory Detection ─────────────────────────────────────────────────────

detect_dirs() {
    # INSTALL_DIR is the src/ directory (where package.json lives)
    INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    if [ ! -f "$INSTALL_DIR/package.json" ]; then
        die "Cannot find package.json in $INSTALL_DIR — run this script from the project's scripts/ directory."
    fi

    # PROJECT_ROOT is the parent of src/ (contains data/, assets/, etc.)
    PROJECT_ROOT="$(cd "$INSTALL_DIR/.." && pwd)"

    # DATA_DIR is ../data relative to INSTALL_DIR
    DATA_DIR="${PROJECT_ROOT}/data"
}

# ── Safety Check ─────────────────────────────────────────────────────────────

safe_rm() {
    local target="$1"
    local label="$2"

    # Refuse to delete root, home, or obviously dangerous paths
    case "$target" in
        /|/home|/usr|/etc|/var|/tmp|/bin|/sbin|/lib|/opt|"$HOME")
            err "Refusing to delete $label at '$target' — path looks dangerous."
            return 1
            ;;
    esac

    if [ ${#target} -lt 5 ]; then
        err "Refusing to delete $label at '$target' — path too short."
        return 1
    fi

    if [ -d "$target" ]; then
        rm -rf "$target"
        log "Removed $label: $target"
    else
        info "$label not found at $target (already removed?)"
    fi
}

# ── Stop Services ────────────────────────────────────────────────────────────

stop_services_windows() {
    step "Stopping Windows services"

    if command -v nssm &>/dev/null; then
        if nssm status mu-server &>/dev/null; then
            info "Stopping mu-server service..."
            nssm stop mu-server 2>/dev/null || true
            nssm remove mu-server confirm 2>/dev/null || true
            log "mu-server service removed."
        else
            info "No mu-server NSSM service found."
        fi

        if nssm status mu-nginx &>/dev/null; then
            info "Stopping mu-nginx service..."
            nssm stop mu-nginx 2>/dev/null || true
            nssm remove mu-nginx confirm 2>/dev/null || true
            log "mu-nginx service removed."
        fi
    else
        info "NSSM not found — no Windows services to remove."
    fi

    # Also try stop.sh as fallback
    if [ -f "$INSTALL_DIR/stop.sh" ]; then
        bash "$INSTALL_DIR/stop.sh" 2>/dev/null || true
    fi
}

stop_services_linux() {
    step "Stopping Linux services"

    local service_file="/etc/systemd/system/mu-server.service"
    local legacy_service="/etc/systemd/system/mu.service"

    for svc_file in "$service_file" "$legacy_service"; do
        if [ -f "$svc_file" ]; then
            local svc_name
            svc_name=$(basename "$svc_file" .service)
            info "Stopping and disabling $svc_name..."
            sudo systemctl stop "$svc_name" 2>/dev/null || true
            sudo systemctl disable "$svc_name" 2>/dev/null || true
            sudo rm -f "$svc_file"
            log "Removed $svc_file"
        fi
    done

    if command -v systemctl &>/dev/null; then
        sudo systemctl daemon-reload 2>/dev/null || true
    fi

    # Also try stop.sh as fallback
    if [ -f "$INSTALL_DIR/stop.sh" ]; then
        bash "$INSTALL_DIR/stop.sh" 2>/dev/null || true
    fi
}

stop_services_macos() {
    step "Stopping macOS services"

    local plist_file="$HOME/Library/LaunchAgents/net.ryanweiss.mu-server.plist"
    if [ -f "$plist_file" ]; then
        info "Unloading launchd agent..."
        launchctl unload "$plist_file" 2>/dev/null || true
        rm -f "$plist_file"
        log "Removed $plist_file"
    else
        info "No launchd agent found."
    fi

    # Also try stop.sh as fallback
    if [ -f "$INSTALL_DIR/stop.sh" ]; then
        bash "$INSTALL_DIR/stop.sh" 2>/dev/null || true
    fi
}

# ── Kill FFmpeg Processes ────────────────────────────────────────────────────

kill_ffmpeg() {
    step "Stopping FFmpeg processes"

    # Kill FFmpeg processes that were spawned from the install directory
    local count=0
    local pids
    pids=$(pgrep -f "ffmpeg.*$(basename "$INSTALL_DIR")" 2>/dev/null || true)

    if [ -n "$pids" ]; then
        while read -r pid; do
            if [ -n "$pid" ]; then
                kill "$pid" 2>/dev/null || true
                ((count++))
            fi
        done <<< "$pids"
        log "Killed $count FFmpeg process(es)."
    else
        info "No FFmpeg processes found for this installation."
    fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    echo -e "\n${BOLD}  Mu — Uninstall${NC}\n"

    detect_platform
    detect_dirs

    info "Platform:    $PLATFORM"
    info "Install dir: $INSTALL_DIR"
    info "Data dir:    $DATA_DIR"
    echo ""

    echo -e "  ${YELLOW}This will remove the Mu server and all services.${NC}"
    echo ""

    # Ask about data deletion
    local delete_data="n"
    echo -en "  ${CYAN}Delete data directory (database, config, cache)? [y/N]:${NC} "
    read -r delete_data
    delete_data="${delete_data:-n}"
    delete_data="${delete_data,,}"

    echo ""
    echo -en "  ${CYAN}Proceed with uninstall? [y/N]:${NC} "
    read -r confirm
    if [ "${confirm,,}" != "y" ]; then
        info "Uninstall cancelled."
        exit 0
    fi

    # 1. Stop and remove services
    case "$PLATFORM" in
        windows) stop_services_windows ;;
        linux)   stop_services_linux ;;
        macos)   stop_services_macos ;;
    esac

    # 2. Kill FFmpeg processes
    kill_ffmpeg

    # 3. Optionally delete data directory
    if [ "$delete_data" = "y" ]; then
        step "Removing data directory"
        safe_rm "$DATA_DIR" "data directory"
    else
        info "Keeping data directory at $DATA_DIR"
    fi

    # 4. Remove install directory
    step "Removing install directory"

    # We need to leave the directory before deleting it
    cd /tmp 2>/dev/null || cd /

    safe_rm "$INSTALL_DIR" "install directory"

    # Also remove project root if it's now empty (only contains assets/ or is empty)
    if [ -d "$PROJECT_ROOT" ]; then
        local remaining
        remaining=$(ls -A "$PROJECT_ROOT" 2>/dev/null | wc -l)
        if [ "$remaining" -eq 0 ]; then
            safe_rm "$PROJECT_ROOT" "project root (empty)"
        else
            info "Project root $PROJECT_ROOT still has files — not removing."
        fi
    fi

    # 5. Success
    echo ""
    echo -e "${BOLD}${GREEN}"
    echo "  ╔═══════════════════════════════════════════╗"
    echo "  ║     Mu uninstalled successfully     ║"
    echo "  ╚═══════════════════════════════════════════╝"
    echo -e "${NC}"

    if [ "$delete_data" != "y" ]; then
        info "Data preserved at: $DATA_DIR"
        info "To delete it manually: rm -rf $DATA_DIR"
    fi

    echo ""
}

main "$@"

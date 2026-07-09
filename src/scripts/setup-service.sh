#!/usr/bin/env bash
set -euo pipefail

# Mu - Auto-Start Service Setup
# Cross-platform script to install Mu as a system service (Linux, macOS, Windows)

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

    # DATA_DIR is ../data relative to INSTALL_DIR
    DATA_DIR="$(cd "$INSTALL_DIR/.." && pwd)/data"
    mkdir -p "$DATA_DIR/logs"
}

# ── Windows (NSSM) ──────────────────────────────────────────────────────────

setup_windows() {
    step "Setting up Mu as a Windows service (via NSSM)"

    # Check/install NSSM
    if ! command -v nssm &>/dev/null; then
        info "NSSM not found. Installing via winget..."
        winget install NSSM.NSSM --accept-source-agreements --accept-package-agreements 2>&1 | tail -5 \
            || die "Failed to install NSSM. Install it manually: https://nssm.cc"
        # Refresh PATH
        export PATH="$PATH:/c/Program Files/NSSM:/c/Program Files (x86)/NSSM"
        hash -r 2>/dev/null || true
        if ! command -v nssm &>/dev/null; then
            warn "NSSM installed but not on PATH. You may need to restart your terminal."
            warn "Then re-run this script."
            return 1
        fi
    fi
    log "NSSM found: $(command -v nssm)"

    # Detect node.exe path
    local node_path
    node_path=$(command -v node)
    if [ -z "$node_path" ]; then
        die "Node.js not found on PATH."
    fi
    # Convert to Windows-style forward-slash path for NSSM
    local node_win
    node_win=$(cygpath -m "$node_path" 2>/dev/null || echo "$node_path")

    local install_win
    install_win=$(cygpath -m "$INSTALL_DIR" 2>/dev/null || echo "$INSTALL_DIR")

    local data_win
    data_win=$(cygpath -m "$DATA_DIR" 2>/dev/null || echo "$DATA_DIR")

    local main_js="${install_win}/packages/server/dist/main.js"
    local log_file="${data_win}/logs/server.log"

    # Remove existing service if present
    if nssm status mu-server &>/dev/null; then
        info "Existing mu-server service found, removing..."
        nssm stop mu-server 2>/dev/null || true
        nssm remove mu-server confirm 2>/dev/null || true
    fi

    info "Creating mu-server service..."
    nssm install mu-server "$node_win" "$main_js" \
        || die "Failed to create service."

    nssm set mu-server AppDirectory "$install_win/packages/server"
    nssm set mu-server AppEnvironmentExtra "NODE_ENV=production"
    nssm set mu-server Start SERVICE_AUTO_START
    nssm set mu-server AppStdout "$log_file"
    nssm set mu-server AppStderr "$log_file"
    nssm set mu-server AppStdoutCreationDisposition 4
    nssm set mu-server AppStderrCreationDisposition 4
    nssm set mu-server Description "Mu Movie Streaming Server"

    # GPU access: offer to run service as the current user instead of SYSTEM.
    # Windows services run in Session 0 which has no GPU access by default.
    # Running as the logged-in user enables NVENC hardware encoding.
    local has_gpu=false
    if command -v nvidia-smi &>/dev/null && nvidia-smi --query-gpu=name --format=csv,noheader &>/dev/null 2>&1; then
        has_gpu=true
    fi

    if $has_gpu; then
        echo ""
        info "NVIDIA GPU detected. Windows services run in Session 0 which cannot"
        info "access the GPU for hardware encoding (NVENC). To enable NVENC, the"
        info "service can run as your user account instead of SYSTEM."
        echo ""
        echo -en "  ${CYAN}Run service as current user for GPU access? (Y/n):${NC} "
        read -r gpu_yn
        if [ "${gpu_yn,,}" != "n" ]; then
            local current_user
            current_user=$(whoami)
            # Get Windows-style username (DOMAIN\User)
            local win_user
            win_user=$(cmd.exe //c "echo %USERDOMAIN%\%USERNAME%" 2>/dev/null | tr -d '\r' || echo "$current_user")
            echo -en "  ${CYAN}Enter password for ${win_user} (needed by NSSM):${NC} "
            read -rs user_pass
            echo ""
            nssm set mu-server ObjectName "$win_user" "$user_pass" \
                && log "Service will run as $win_user (GPU access enabled)." \
                || warn "Failed to set service account. Service will run as SYSTEM (no GPU access)."
        else
            info "Service will run as SYSTEM (software encoding only)."
        fi
    fi

    info "Starting mu-server service..."
    nssm start mu-server \
        && log "Service started successfully." \
        || warn "Failed to start service. Try: nssm start mu-server"

    log "Windows service 'mu-server' installed and set to auto-start."

    # Offer nginx service if nginx is found
    if command -v nginx &>/dev/null; then
        echo ""
        echo -en "  ${CYAN}nginx detected. Set up nginx as a Windows service too? (y/N):${NC} "
        read -r yn
        if [ "${yn,,}" = "y" ]; then
            local nginx_path
            nginx_path=$(command -v nginx)
            local nginx_win
            nginx_win=$(cygpath -m "$nginx_path" 2>/dev/null || echo "$nginx_path")
            local nginx_dir
            nginx_dir=$(dirname "$nginx_win")

            if nssm status mu-nginx &>/dev/null; then
                nssm stop mu-nginx 2>/dev/null || true
                nssm remove mu-nginx confirm 2>/dev/null || true
            fi

            nssm install mu-nginx "$nginx_win"
            nssm set mu-nginx AppDirectory "$nginx_dir"
            nssm set mu-nginx Start SERVICE_AUTO_START
            nssm set mu-nginx Description "Nginx (Mu reverse proxy)"
            nssm start mu-nginx 2>/dev/null \
                && log "nginx service installed and started." \
                || warn "nginx service installed but failed to start."
        fi
    fi
}

# ── Linux (systemd) ─────────────────────────────────────────────────────────

setup_linux() {
    step "Setting up Mu as a systemd service"

    if ! command -v systemctl &>/dev/null; then
        die "systemd not found. This script requires systemd on Linux."
    fi

    local node_path
    node_path=$(command -v node)
    if [ -z "$node_path" ]; then
        die "Node.js not found on PATH."
    fi

    local current_user
    current_user=$(whoami)

    local service_file="/etc/systemd/system/mu-server.service"

    info "Creating systemd service at $service_file..."
    sudo tee "$service_file" > /dev/null << UNIT
[Unit]
Description=Mu Movie Server
After=network.target

[Service]
Type=simple
User=${current_user}
WorkingDirectory=${INSTALL_DIR}/packages/server
ExecStart=${node_path} ${INSTALL_DIR}/packages/server/dist/main.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=append:${DATA_DIR}/logs/server.log
StandardError=append:${DATA_DIR}/logs/server.log

[Install]
WantedBy=multi-user.target
UNIT

    info "Enabling and starting service..."
    sudo systemctl daemon-reload
    sudo systemctl enable mu-server
    sudo systemctl start mu-server

    log "systemd service 'mu-server' installed, enabled, and started."
    info "Check status:  sudo systemctl status mu-server"
    info "View logs:     sudo journalctl -u mu-server -f"
}

# ── macOS (launchd) ──────────────────────────────────────────────────────────

setup_macos() {
    step "Setting up Mu as a launchd agent"

    local node_path
    node_path=$(command -v node)
    if [ -z "$node_path" ]; then
        die "Node.js not found on PATH."
    fi

    local plist_dir="$HOME/Library/LaunchAgents"
    local plist_file="${plist_dir}/net.ryanweiss.mu-server.plist"
    mkdir -p "$plist_dir"

    # Unload existing if present
    if [ -f "$plist_file" ]; then
        info "Existing plist found, unloading..."
        launchctl unload "$plist_file" 2>/dev/null || true
    fi

    info "Creating launchd plist at $plist_file..."
    cat > "$plist_file" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>net.ryanweiss.mu-server</string>
    <key>ProgramArguments</key><array>
        <string>${node_path}</string>
        <string>${INSTALL_DIR}/packages/server/dist/main.js</string>
    </array>
    <key>WorkingDirectory</key><string>${INSTALL_DIR}/packages/server</string>
    <key>EnvironmentVariables</key><dict>
        <key>NODE_ENV</key><string>production</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${DATA_DIR}/logs/server.log</string>
    <key>StandardErrorPath</key><string>${DATA_DIR}/logs/server.log</string>
</dict>
</plist>
PLIST

    info "Loading launchd agent..."
    launchctl load "$plist_file"

    log "launchd agent 'net.ryanweiss.mu-server' installed and loaded."
    info "Check status:  launchctl list | grep mu-server"
    info "Unload:        launchctl unload $plist_file"
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    echo -e "\n${BOLD}  Mu — Service Setup${NC}\n"

    detect_platform
    detect_dirs

    info "Platform:    $PLATFORM"
    info "Install dir: $INSTALL_DIR"
    info "Data dir:    $DATA_DIR"
    echo ""

    echo -en "  ${CYAN}Would you like to start Mu automatically on boot? [Y/n]:${NC} "
    read -r yn
    if [ "${yn,,}" = "n" ]; then
        info "Skipped — no service installed."
        exit 0
    fi

    case "$PLATFORM" in
        windows) setup_windows ;;
        linux)   setup_linux ;;
        macos)   setup_macos ;;
    esac

    echo ""
    log "Service setup complete."
    echo ""
}

main "$@"

#!/usr/bin/env bash
# Mu — self-hosted movie streaming. Universal installer.
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash
#
# Flags (pass after `--`):
#   --reinstall     Update an existing install in place; preserves data by default.
#   --uninstall     Remove the install; prompts about keeping data / db / cache.
#   --yes           Non-interactive, accept all defaults.
#   --dir <path>    Install directory (default: $HOME/mu).
#   --branch <name> Git branch to install (default: main).
#   --help          Show this help and exit.
#
# Supported platforms:
#   Linux:   Fedora / RHEL family (dnf), Ubuntu / Debian (apt), Arch (pacman),
#            Alpine (apk), openSUSE (zypper).
#   macOS:   Homebrew (brew) — auto-installed if missing.
#   Windows: see install.ps1 (PowerShell). This script also runs under WSL.

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────
REPO_URL="${MU_REPO_URL:-https://github.com/rw3iss/mu.git}"
REPO_BRANCH="${MU_REPO_BRANCH:-main}"
DEFAULT_INSTALL_DIR="${MU_INSTALL_DIR:-$HOME/mu}"
DEFAULT_PORT="${MU_PORT:-4000}"
DEFAULT_CONCURRENT="${MU_CONCURRENT_JOBS:-2}"
MIN_NODE_MAJOR=20

# ── Colors ────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    B=$'\033[1m'; D=$'\033[2m'; R=$'\033[0m'
    GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'
    CYAN=$'\033[36m'; MAGENTA=$'\033[35m'
else
    B=""; D=""; R=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; MAGENTA=""
fi

ok()    { printf '  %s[+]%s %s\n' "$GREEN" "$R" "$*"; }
warn()  { printf '  %s[!]%s %s\n' "$YELLOW" "$R" "$*"; }
err()   { printf '  %s[x]%s %s\n' "$RED" "$R" "$*" >&2; }
info()  { printf '  %s[i]%s %s\n' "$CYAN" "$R" "$*"; }
step()  { printf '\n%s%s%s\n' "$MAGENTA$B" "$*" "$R"; }
die()   { err "$*"; exit 1; }

banner() {
    cat <<EOF
${B}${MAGENTA}
  ╔══════════════════════════════════════════════╗
  ║                  Mu                          ║
  ║      Self-hosted Movie Streaming             ║
  ╚══════════════════════════════════════════════╝
${R}
EOF
}

# Prompt user; respects --yes / piped stdin (defaults accepted automatically).
prompt() {
    local varname="$1" question="$2" default="${3:-}"
    if [ "$INTERACTIVE" = "0" ]; then
        eval "$varname=\"\$default\""
        return
    fi
    # When the script is piped (curl | bash) stdin is the pipe, not a TTY.
    # Read from /dev/tty so prompts still work.
    local value=""
    if [ -r /dev/tty ]; then
        if [ -n "$default" ]; then
            printf '  %s%s%s [%s]: ' "$CYAN" "$question" "$R" "$default" >/dev/tty
        else
            printf '  %s%s%s: ' "$CYAN" "$question" "$R" >/dev/tty
        fi
        IFS= read -r value </dev/tty || true
    fi
    eval "$varname=\"\${value:-\$default}\""
}

confirm() {
    local question="$1" default="${2:-Y}"
    if [ "$INTERACTIVE" = "0" ]; then
        [ "$default" = "Y" ] && return 0 || return 1
    fi
    local hint="[Y/n]"
    [ "$default" = "N" ] && hint="[y/N]"
    local ans=""
    if [ -r /dev/tty ]; then
        printf '  %s%s%s %s: ' "$CYAN" "$question" "$R" "$hint" >/dev/tty
        IFS= read -r ans </dev/tty || true
    fi
    ans="${ans:-$default}"
    case "$ans" in
        y|Y|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

# ── Flag parsing ──────────────────────────────────────────────────────────
ACTION="install"
INTERACTIVE=1
INSTALL_DIR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --reinstall) ACTION="reinstall"; shift ;;
        --uninstall) ACTION="uninstall"; shift ;;
        --yes|-y)    INTERACTIVE=0; shift ;;
        --dir)       INSTALL_DIR="$2"; shift 2 ;;
        --branch)    REPO_BRANCH="$2"; shift 2 ;;
        --help|-h)
            sed -n '1,/^set -e/p' "$0" | head -n 25 | tail -n +2 | sed 's/^# \?//'
            exit 0
            ;;
        *) die "Unknown flag: $1 (try --help)" ;;
    esac
done
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

# ── Platform detection ────────────────────────────────────────────────────
OS=""; DISTRO=""; PKG=""; SUDO=""
detect_platform() {
    case "$(uname -s)" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
        *) die "Unsupported OS: $(uname -s). Try install.ps1 on Windows." ;;
    esac

    if [ "$OS" = "linux" ]; then
        if [ -r /etc/os-release ]; then
            # shellcheck disable=SC1091
            . /etc/os-release
            DISTRO="${ID:-unknown}"
        fi
        if   command -v dnf    >/dev/null 2>&1; then PKG="dnf"
        elif command -v apt-get>/dev/null 2>&1; then PKG="apt"
        elif command -v pacman >/dev/null 2>&1; then PKG="pacman"
        elif command -v apk    >/dev/null 2>&1; then PKG="apk"
        elif command -v zypper >/dev/null 2>&1; then PKG="zypper"
        else warn "No supported package manager found — you'll need to install prereqs manually."
        fi
        # `sudo` is only needed for root operations; honour explicit unset.
        if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
    elif [ "$OS" = "macos" ]; then
        if ! command -v brew >/dev/null 2>&1; then
            warn "Homebrew not found — will offer to install during prereqs."
        fi
        PKG="brew"
    fi
    info "Platform: ${OS}${DISTRO:+ ($DISTRO)}, package manager: ${PKG:-none}"
}

pkg_install() {
    [ $# -eq 0 ] && return 0
    case "$PKG" in
        dnf)    $SUDO dnf install -y "$@" ;;
        apt)    $SUDO apt-get update -qq && $SUDO apt-get install -y "$@" ;;
        pacman) $SUDO pacman -S --noconfirm --needed "$@" ;;
        apk)    $SUDO apk add --no-cache "$@" ;;
        zypper) $SUDO zypper install -y "$@" ;;
        brew)   brew install "$@" ;;
        *) die "No package manager — install manually: $*" ;;
    esac
}

# ── Prerequisites ─────────────────────────────────────────────────────────
ensure_homebrew() {
    [ "$OS" = "macos" ] || return 0
    command -v brew >/dev/null 2>&1 && return 0
    info "Installing Homebrew (will prompt for sudo password)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for the rest of this script.
    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
}

ensure_git() {
    command -v git >/dev/null 2>&1 && return 0
    info "Installing git…"
    case "$PKG" in
        apt) pkg_install git ;;
        dnf|zypper) pkg_install git ;;
        pacman) pkg_install git ;;
        apk) pkg_install git ;;
        brew) pkg_install git ;;
    esac
}

ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local major
        major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
        if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
            ok "node $(node -v) (>= $MIN_NODE_MAJOR)"
            return 0
        fi
        warn "node $(node -v) is older than required ($MIN_NODE_MAJOR). Upgrading…"
    fi
    case "$PKG" in
        dnf)    pkg_install nodejs ;;
        apt)
            # Default Ubuntu/Debian nodejs is too old; use NodeSource.
            curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | $SUDO -E bash -
            pkg_install nodejs
            ;;
        pacman) pkg_install nodejs ;;
        apk)    pkg_install nodejs ;;
        zypper) pkg_install nodejs20 || pkg_install nodejs ;;
        brew)   pkg_install "node@${MIN_NODE_MAJOR}" || pkg_install node ;;
        *)
            warn "Install Node $MIN_NODE_MAJOR+ manually then re-run."
            die "node not available"
            ;;
    esac
}

ensure_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
        ok "pnpm $(pnpm -v)"
        return 0
    fi
    # Prefer corepack (ships with modern Node) — no extra global install.
    if command -v corepack >/dev/null 2>&1; then
        corepack enable >/dev/null 2>&1 || true
        corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
    fi
    if ! command -v pnpm >/dev/null 2>&1; then
        info "Installing pnpm via npm…"
        $SUDO npm install -g pnpm
    fi
    ok "pnpm $(pnpm -v)"
}

ensure_ffmpeg() {
    if command -v ffmpeg >/dev/null 2>&1; then
        ok "ffmpeg $(ffmpeg -version | head -1 | awk '{print $3}')"
        return 0
    fi
    info "Installing ffmpeg…"
    pkg_install ffmpeg
}

ensure_build_tools() {
    # better-sqlite3 needs a C++ compiler for native modules on some
    # systems. Headers usually aren't installed by default.
    case "$PKG" in
        dnf)    pkg_install gcc-c++ make python3 ;;
        apt)    pkg_install build-essential python3 ;;
        pacman) pkg_install base-devel python ;;
        apk)    pkg_install build-base python3 ;;
        zypper) pkg_install gcc-c++ make python3 ;;
        brew)   : ;; # Xcode CLT brings these in.
    esac
}

# ── Configuration prompts ─────────────────────────────────────────────────
CONF_MEDIA_DIR=""
CONF_DATA_DIR=""
CONF_PORT=""
CONF_CONCURRENT=""
CONF_INSTALL_SERVICE=""
CONF_START_NOW=""

phase_configure() {
    step "Configuration"

    info "We'll ask a few questions. Press Enter to accept the default."
    info "Install directory: ${B}${INSTALL_DIR}${R}"

    prompt CONF_DATA_DIR "Data directory (database, cache, logs)" "${INSTALL_DIR%/}/data"
    prompt CONF_MEDIA_DIR "Initial media directory to scan (a folder of movies)" \
        "${HOME}/Movies"
    prompt CONF_PORT "HTTP server port" "$DEFAULT_PORT"
    if ! [[ "$CONF_PORT" =~ ^[0-9]+$ ]]; then
        warn "Port must be numeric; falling back to $DEFAULT_PORT"
        CONF_PORT="$DEFAULT_PORT"
    fi
    prompt CONF_CONCURRENT "Max concurrent jobs (transcoding etc.; raise on dedicated boxes)" \
        "$DEFAULT_CONCURRENT"

    if [ "$OS" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
        if confirm "Install a systemd service so Mu starts on boot?" "Y"; then
            CONF_INSTALL_SERVICE="systemd"
        fi
    elif [ "$OS" = "macos" ]; then
        if confirm "Install a launchd agent so Mu starts on login?" "N"; then
            CONF_INSTALL_SERVICE="launchd"
        fi
    fi

    if confirm "Start Mu immediately after install?" "Y"; then
        CONF_START_NOW="yes"
    fi

    info "Will use:"
    info "  Install dir:    ${INSTALL_DIR}"
    info "  Data dir:       ${CONF_DATA_DIR}"
    info "  Media dir:      ${CONF_MEDIA_DIR}"
    info "  Port:           ${CONF_PORT}"
    info "  Concurrent:     ${CONF_CONCURRENT}"
    info "  Service:        ${CONF_INSTALL_SERVICE:-none}"
    info "  Start now:      ${CONF_START_NOW:-no}"
    if ! confirm "Proceed?" "Y"; then
        die "Aborted by user."
    fi
}

# ── Clone / update repo ───────────────────────────────────────────────────
phase_fetch() {
    step "Fetching Mu source"
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Existing git checkout at $INSTALL_DIR — pulling latest from $REPO_BRANCH"
        ( cd "$INSTALL_DIR" && git fetch origin "$REPO_BRANCH" && git checkout "$REPO_BRANCH" && git pull --ff-only )
    elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
        die "$INSTALL_DIR exists and is not empty. Use --reinstall, or pick another --dir."
    else
        mkdir -p "$INSTALL_DIR"
        git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
    fi
}

# ── Install + build ───────────────────────────────────────────────────────
phase_build() {
    step "Installing dependencies & building"
    ( cd "$INSTALL_DIR/src" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install )
    ( cd "$INSTALL_DIR/src" && pnpm build )
}

# ── Config file + migrations ─────────────────────────────────────────────
phase_config() {
    step "Writing config + applying migrations"
    mkdir -p "$CONF_DATA_DIR/db" "$CONF_DATA_DIR/config" "$CONF_DATA_DIR/logs" "$CONF_DATA_DIR/cache"

    local config_file="$CONF_DATA_DIR/config/config.yml"
    if [ -f "$config_file" ]; then
        info "Existing config preserved at $config_file"
    else
        local jwt_secret cookie_secret
        jwt_secret=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 64)
        cookie_secret=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 64)
        cat > "$config_file" <<YAML
# Mu config — generated $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# Override any value with MU_ env vars; e.g. MU_SERVER__PORT=8080.
server:
  host: "0.0.0.0"
  port: ${CONF_PORT}
  logLevel: info

auth:
  jwtSecret: "${jwt_secret}"
  cookieSecret: "${cookie_secret}"
  allowRegistration: true

dataDir: "${CONF_DATA_DIR}"

mediaSources:
  - path: "${CONF_MEDIA_DIR}"
    name: "Default"

transcoding:
  hwAccel: none
  maxConcurrent: ${CONF_CONCURRENT}

cache:
  type: memory

thirdParty:
  tmdb:
    apiKey: ""
  omdb:
    apiKey: ""
  opensubtitles:
    apiKey: ""

jobs:
  backend: in-memory
YAML
        ok "Wrote $config_file"
    fi

    info "Applying database schema"
    ( cd "$INSTALL_DIR/src" && MU_DATA_DIR="$CONF_DATA_DIR" pnpm db:migrate )
}

# ── Service setup ─────────────────────────────────────────────────────────
phase_service() {
    [ -z "$CONF_INSTALL_SERVICE" ] && return 0
    step "Installing system service"
    case "$CONF_INSTALL_SERVICE" in
        systemd) install_systemd ;;
        launchd) install_launchd ;;
    esac
}

install_systemd() {
    local unit_file="/etc/systemd/system/mu-server.service"
    local node_bin entry_point
    node_bin=$(command -v node)
    entry_point="$INSTALL_DIR/src/packages/server/dist/main.js"

    $SUDO tee "$unit_file" >/dev/null <<UNIT
[Unit]
Description=Mu — self-hosted movie streaming
Documentation=https://github.com/rw3iss/mu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${INSTALL_DIR}/src/packages/server
Environment=NODE_ENV=production
Environment=MU_DATA_DIR=${CONF_DATA_DIR}
ExecStart=${node_bin} ${entry_point}
Restart=on-failure
RestartSec=5
StandardOutput=append:${CONF_DATA_DIR}/logs/server.log
StandardError=append:${CONF_DATA_DIR}/logs/server.log

[Install]
WantedBy=multi-user.target
UNIT

    $SUDO systemctl daemon-reload
    $SUDO systemctl enable mu-server.service
    ok "systemd unit installed at $unit_file"
}

install_launchd() {
    local plist="$HOME/Library/LaunchAgents/com.mu.server.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    local node_bin entry_point
    node_bin=$(command -v node)
    entry_point="$INSTALL_DIR/src/packages/server/dist/main.js"

    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mu.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${entry_point}</string>
  </array>
  <key>WorkingDirectory</key><string>${INSTALL_DIR}/src/packages/server</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>MU_DATA_DIR</key><string>${CONF_DATA_DIR}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${CONF_DATA_DIR}/logs/server.log</string>
  <key>StandardErrorPath</key><string>${CONF_DATA_DIR}/logs/server.log</string>
</dict>
</plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    ok "launchd agent installed at $plist"
}

# ── Start + finish messaging ──────────────────────────────────────────────
detect_lan_ip() {
    case "$OS" in
        linux)
            ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1
            ;;
        macos)
            ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null
            ;;
    esac
}

phase_start() {
    if [ "$CONF_START_NOW" != "yes" ]; then return 0; fi
    step "Starting Mu"
    case "$CONF_INSTALL_SERVICE" in
        systemd) $SUDO systemctl start mu-server.service && ok "systemd: mu-server started" ;;
        launchd) launchctl start com.mu.server && ok "launchd: com.mu.server started" ;;
        *)
            info "Starting in background; logs at ${CONF_DATA_DIR}/logs/server.log"
            ( cd "$INSTALL_DIR/src/packages/server" && \
              MU_DATA_DIR="$CONF_DATA_DIR" \
              nohup node dist/main.js \
                >> "$CONF_DATA_DIR/logs/server.log" 2>&1 &
              echo $! > "$CONF_DATA_DIR/mu-server.pid"
            )
            ok "started (pid $(cat "$CONF_DATA_DIR/mu-server.pid"))"
            ;;
    esac
}

phase_finish() {
    local lan_ip
    lan_ip=$(detect_lan_ip || echo "")
    step "Done"
    cat <<EOF

  ${GREEN}${B}Mu is installed.${R}

  Open the app:
    ${B}http://localhost:${CONF_PORT}${R}
${lan_ip:+    ${B}http://${lan_ip}:${CONF_PORT}${R}  (from other devices on this LAN)}

  Useful commands (run from ${INSTALL_DIR}/src):
    ${D}pnpm dev${R}              start dev mode
    ${D}pnpm logs${R}             tail server log
    ${D}pnpm db:migrate${R}       apply schema changes
    ${D}bash deploy.sh${R}        rebuild + restart from latest git pull

  Update / reinstall later:
    ${D}curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash -s -- --reinstall${R}

  Uninstall:
    ${D}curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash -s -- --uninstall${R}

EOF

    if [ -n "$lan_ip" ]; then
        cat <<EOF
  ${B}Want to access Mu from outside your home network?${R}
    1. Log into your router (usually http://192.168.1.1 or http://192.168.0.1).
    2. Find "Port forwarding" (sometimes under Advanced / NAT / Virtual server).
    3. Forward an external TCP port (e.g. ${CONF_PORT}) to:
         IP:    ${lan_ip}
         Port:  ${CONF_PORT}
    4. Your router's WAN IP becomes the public URL. Use a dynamic-DNS
       provider (DuckDNS, no-ip) if your ISP changes that IP.
    5. For HTTPS, put a reverse proxy (Caddy, nginx, traefik) in front
       — it'll fetch a free Let's Encrypt cert automatically.

EOF
    fi
}

# ── Uninstall ─────────────────────────────────────────────────────────────
phase_uninstall() {
    step "Uninstalling Mu"

    # Default data dir guess: <install>/data
    local data_dir="$INSTALL_DIR/data"
    if [ ! -d "$data_dir" ]; then
        prompt data_dir "Data directory (we couldn't auto-detect)" "$INSTALL_DIR/data"
    fi

    # 1. Stop service
    if [ -f /etc/systemd/system/mu-server.service ]; then
        info "Stopping systemd service…"
        $SUDO systemctl stop mu-server.service 2>/dev/null || true
        if confirm "Remove systemd service file?" "Y"; then
            $SUDO systemctl disable mu-server.service 2>/dev/null || true
            $SUDO rm -f /etc/systemd/system/mu-server.service
            $SUDO systemctl daemon-reload
            ok "systemd unit removed"
        fi
    fi
    local launchd_plist="$HOME/Library/LaunchAgents/com.mu.server.plist"
    if [ -f "$launchd_plist" ]; then
        info "Unloading launchd agent…"
        launchctl unload "$launchd_plist" 2>/dev/null || true
        if confirm "Remove launchd plist?" "Y"; then
            rm -f "$launchd_plist"
            ok "launchd plist removed"
        fi
    fi
    # Stop nohup-started server too
    if [ -f "$data_dir/mu-server.pid" ]; then
        local pid
        pid=$(cat "$data_dir/mu-server.pid" 2>/dev/null || true)
        [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
        rm -f "$data_dir/mu-server.pid"
    fi

    # 2. Ask about data
    local keep_db=0 keep_cache=0
    if [ -f "$data_dir/db/mu.db" ]; then
        if confirm "Keep the database file ($data_dir/db/mu.db)?" "N"; then
            keep_db=1
        fi
    fi
    if [ -d "$data_dir/cache" ]; then
        if confirm "Keep the transcode/image cache ($data_dir/cache)?" "N"; then
            keep_cache=1
        fi
    fi

    # 3. Remove install dir
    if confirm "Remove the install directory ($INSTALL_DIR)?" "Y"; then
        if [ "$keep_db" = 1 ] || [ "$keep_cache" = 1 ]; then
            # Move keepers out of harm's way first.
            local stash="$HOME/mu-preserved-$(date +%Y%m%d-%H%M%S)"
            mkdir -p "$stash"
            [ "$keep_db" = 1 ] && cp -a "$data_dir/db" "$stash/db" && ok "DB preserved at $stash/db"
            [ "$keep_cache" = 1 ] && cp -a "$data_dir/cache" "$stash/cache" && ok "Cache preserved at $stash/cache"
        fi
        rm -rf "$INSTALL_DIR"
        ok "Removed $INSTALL_DIR"
    else
        info "Install dir preserved at $INSTALL_DIR"
    fi

    step "Uninstall complete"
    info "Re-install any time: curl -fsSL https://raw.githubusercontent.com/rw3iss/mu/main/install.sh | bash"
}

# ── Reinstall ─────────────────────────────────────────────────────────────
phase_reinstall() {
    step "Reinstalling Mu"
    if [ ! -d "$INSTALL_DIR" ]; then
        warn "$INSTALL_DIR doesn't exist — running fresh install instead."
        return 1
    fi
    info "Updating source"
    ( cd "$INSTALL_DIR" && git fetch origin "$REPO_BRANCH" && git checkout "$REPO_BRANCH" && git pull --ff-only )
    info "Reinstalling dependencies"
    ( cd "$INSTALL_DIR/src" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install )
    info "Rebuilding"
    ( cd "$INSTALL_DIR/src" && pnpm build )
    info "Applying migrations"
    local data_dir
    if [ -f "$INSTALL_DIR/data/config/config.yml" ]; then
        data_dir="$INSTALL_DIR/data"
    else
        prompt data_dir "Data directory" "$INSTALL_DIR/data"
    fi
    ( cd "$INSTALL_DIR/src" && MU_DATA_DIR="$data_dir" pnpm db:migrate )
    info "Restarting service (if installed)"
    [ -f /etc/systemd/system/mu-server.service ] && $SUDO systemctl restart mu-server.service && ok "systemd restarted" || true
    [ -f "$HOME/Library/LaunchAgents/com.mu.server.plist" ] && launchctl kickstart -k gui/$(id -u)/com.mu.server 2>/dev/null && ok "launchd kicked" || true
    ok "Reinstall complete"
    return 0
}

# ── Main ──────────────────────────────────────────────────────────────────
banner
detect_platform

case "$ACTION" in
    uninstall)
        phase_uninstall
        ;;
    reinstall)
        if ! phase_reinstall; then
            ACTION="install"
        else
            exit 0
        fi
        ;;
esac

if [ "$ACTION" = "install" ]; then
    step "Prerequisites"
    [ "$OS" = "macos" ] && ensure_homebrew
    ensure_git
    ensure_node
    ensure_pnpm
    ensure_ffmpeg
    ensure_build_tools

    phase_configure
    phase_fetch
    phase_build
    phase_config
    phase_service
    phase_start
    phase_finish
fi

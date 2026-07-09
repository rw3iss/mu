#!/usr/bin/env bash
set -euo pipefail

# Mu - Update Script
# Cross-platform script to update Mu to the latest release (Linux, macOS, Windows)

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

GITHUB_REPO="rw3iss/mu"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}"

# ── Helpers ──────────────────────────────────────────────────────────────────

log()    { echo -e "  ${GREEN}[+]${NC} $1"; }
warn()   { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()    { echo -e "  ${RED}[x]${NC} $1"; }
info()   { echo -e "  ${CYAN}[i]${NC} $1"; }
step()   { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()    { err "$1"; exit 1; }

cleanup() {
    [ -n "${TMPDIR_CREATED:-}" ] && rm -rf "$TMPDIR_CREATED"
}
trap cleanup EXIT

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

# ── JSON Parsing ─────────────────────────────────────────────────────────────

json_parse_cmd=""

detect_json_parser() {
    if command -v jq &>/dev/null; then
        json_parse_cmd="jq"
    elif command -v python3 &>/dev/null; then
        json_parse_cmd="python3"
    elif command -v python &>/dev/null; then
        json_parse_cmd="python"
    elif command -v node &>/dev/null; then
        json_parse_cmd="node"
    else
        json_parse_cmd=""
    fi
}

# Extract a single string field from a JSON object
json_get_field() {
    local json="$1" field="$2"
    case "$json_parse_cmd" in
        jq)
            echo "$json" | jq -r ".$field"
            ;;
        python3|python)
            echo "$json" | "$json_parse_cmd" -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('$field', ''))
"
            ;;
        node)
            echo "$json" | node -e "
const chunks=[];
process.stdin.on('data',c=>chunks.push(c));
process.stdin.on('end',()=>{
    const data=JSON.parse(chunks.join(''));
    console.log(data['$field']||'');
});
"
            ;;
        *)
            die "No JSON parser available (need jq, python3, or node)"
            ;;
    esac
}

# ── Version Helpers ──────────────────────────────────────────────────────────

get_current_version() {
    if [ -f "$INSTALL_DIR/package.json" ]; then
        case "$json_parse_cmd" in
            jq)
                jq -r '.version' "$INSTALL_DIR/package.json"
                ;;
            python3|python)
                "$json_parse_cmd" -c "import json; print(json.load(open('$INSTALL_DIR/package.json'))['version'])"
                ;;
            node)
                node -e "console.log(require('$INSTALL_DIR/package.json').version)"
                ;;
            *)
                echo "unknown"
                ;;
        esac
    else
        echo "unknown"
    fi
}

# ── Stop Server ──────────────────────────────────────────────────────────────

stop_server() {
    step "Stopping server"

    case "$PLATFORM" in
        windows)
            if command -v nssm &>/dev/null && nssm status mu-server &>/dev/null; then
                info "Stopping NSSM service..."
                nssm stop mu-server 2>/dev/null || true
                RESTART_VIA="nssm"
                log "NSSM service stopped."
                return
            fi
            ;;
        linux)
            if command -v systemctl &>/dev/null && systemctl is-active mu-server &>/dev/null; then
                info "Stopping systemd service..."
                sudo systemctl stop mu-server 2>/dev/null || true
                RESTART_VIA="systemd"
                log "systemd service stopped."
                return
            fi
            # Also check legacy service name
            if command -v systemctl &>/dev/null && systemctl is-active mu &>/dev/null; then
                info "Stopping systemd service (mu)..."
                sudo systemctl stop mu 2>/dev/null || true
                RESTART_VIA="systemd-legacy"
                log "systemd service stopped."
                return
            fi
            ;;
        macos)
            local plist="$HOME/Library/LaunchAgents/net.ryanweiss.mu-server.plist"
            if [ -f "$plist" ]; then
                info "Unloading launchd agent..."
                launchctl unload "$plist" 2>/dev/null || true
                RESTART_VIA="launchd"
                log "launchd agent unloaded."
                return
            fi
            ;;
    esac

    # Fallback: use stop.sh
    if [ -f "$INSTALL_DIR/stop.sh" ]; then
        info "Using stop.sh..."
        bash "$INSTALL_DIR/stop.sh" 2>/dev/null || true
        RESTART_VIA="stop-script"
        log "Server stopped via stop.sh."
    else
        RESTART_VIA="manual"
        warn "Could not detect running server — it may not be running."
    fi
}

# ── Restart Server ───────────────────────────────────────────────────────────

restart_server() {
    step "Restarting server"

    case "${RESTART_VIA:-manual}" in
        nssm)
            info "Starting NSSM service..."
            nssm start mu-server 2>/dev/null \
                && log "NSSM service started." \
                || warn "Failed to start NSSM service. Try: nssm start mu-server"
            ;;
        systemd)
            info "Starting systemd service..."
            sudo systemctl start mu-server \
                && log "systemd service started." \
                || warn "Failed to start service. Try: sudo systemctl start mu-server"
            ;;
        systemd-legacy)
            info "Starting systemd service (mu)..."
            sudo systemctl start mu \
                && log "systemd service started." \
                || warn "Failed to start service. Try: sudo systemctl start mu"
            ;;
        launchd)
            local plist="$HOME/Library/LaunchAgents/net.ryanweiss.mu-server.plist"
            info "Loading launchd agent..."
            launchctl load "$plist" \
                && log "launchd agent loaded." \
                || warn "Failed to load agent. Try: launchctl load $plist"
            ;;
        stop-script)
            if [ -f "$INSTALL_DIR/restart.sh" ]; then
                info "Using restart.sh..."
                bash "$INSTALL_DIR/restart.sh" 2>/dev/null \
                    && log "Server restarted." \
                    || warn "Failed to restart. Try: bash $INSTALL_DIR/restart.sh"
            else
                warn "No restart mechanism found. Start manually:"
                info "cd $INSTALL_DIR && NODE_ENV=production node packages/server/dist/main.js"
            fi
            ;;
        manual)
            warn "No service detected. Start manually:"
            info "cd $INSTALL_DIR && NODE_ENV=production node packages/server/dist/main.js"
            ;;
    esac
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    echo -e "\n${BOLD}  Mu — Update${NC}\n"

    detect_platform
    detect_dirs
    detect_json_parser

    if [ -z "$json_parse_cmd" ]; then
        die "No JSON parser found (need jq, python3, or node)"
    fi

    info "Platform:    $PLATFORM"
    info "Install dir: $INSTALL_DIR"

    # 1. Get current version
    step "Checking versions"
    local current_version
    current_version=$(get_current_version)
    info "Current version: ${current_version}"

    # 2. Fetch latest release from GitHub
    info "Fetching latest release from GitHub..."
    local release_json
    release_json=$(curl -fsSL "${GITHUB_API}/releases/latest" \
        -H "Accept: application/vnd.github+json" 2>/dev/null) \
        || die "Failed to fetch latest release from GitHub. Check your internet connection."

    local latest_tag latest_zipball
    latest_tag=$(json_get_field "$release_json" "tag_name")
    latest_zipball=$(json_get_field "$release_json" "zipball_url")

    if [ -z "$latest_tag" ] || [ "$latest_tag" = "null" ]; then
        die "No releases found at ${GITHUB_API}/releases/latest"
    fi

    # Strip leading 'v' for comparison
    local latest_version="${latest_tag#v}"
    info "Latest version:  ${latest_tag}"

    # 3. Check if already up to date
    if [ "$current_version" = "$latest_version" ] || [ "v${current_version}" = "$latest_tag" ]; then
        echo ""
        log "Already up to date (${latest_tag})."
        echo ""
        exit 0
    fi

    echo ""
    echo -e "  ${BOLD}Update available:${NC} ${current_version} -> ${latest_tag}"
    echo ""
    echo -en "  ${CYAN}Proceed with update? [Y/n]:${NC} "
    read -r confirm
    if [ "${confirm,,}" = "n" ]; then
        info "Update cancelled."
        exit 0
    fi

    # 4. Download release
    step "Downloading ${latest_tag}"
    TMPDIR_CREATED=$(mktemp -d 2>/dev/null || mktemp -d -t 'mu-update')
    local archive_file="${TMPDIR_CREATED}/mu-release"

    local download_url
    if [ "$PLATFORM" = "windows" ]; then
        download_url="$latest_zipball"
    else
        # Use tarball for non-Windows
        local latest_tarball
        latest_tarball=$(json_get_field "$release_json" "tarball_url")
        download_url="${latest_tarball:-$latest_zipball}"
    fi

    info "Downloading..."
    curl -fSL -o "$archive_file" "$download_url" 2>&1 | tail -1 \
        || die "Download failed."
    log "Download complete."

    # 5. Stop the server
    RESTART_VIA=""
    stop_server

    # 6. Backup current install
    step "Creating backup"
    local backup_date
    backup_date=$(date '+%Y%m%d-%H%M%S')
    local backup_dir="${INSTALL_DIR}.backup-${backup_date}"

    info "Backing up to ${backup_dir}..."
    cp -r "$INSTALL_DIR" "$backup_dir"
    log "Backup created."

    # 7. Extract release over current install
    step "Extracting update"
    info "Extracting..."

    if [ "$PLATFORM" = "windows" ]; then
        unzip -o -q "$archive_file" -d "$TMPDIR_CREATED/extracted"
    else
        mkdir -p "$TMPDIR_CREATED/extracted"
        command tar --extract --gzip -f "$archive_file" -C "$TMPDIR_CREATED/extracted"
    fi

    local inner
    inner=$(find "$TMPDIR_CREATED/extracted" -mindepth 1 -maxdepth 1 -type d | head -1)
    if [ -z "$inner" ]; then
        err "Failed to extract release archive."
        warn "Restoring from backup..."
        rm -rf "$INSTALL_DIR"
        mv "$backup_dir" "$INSTALL_DIR"
        die "Update failed — restored from backup."
    fi

    # The source code lives inside a src/ directory in the repo
    if [ -d "$inner/src" ]; then
        # Copy src/ contents over the install dir, preserving data
        # Remove old source files first (but not node_modules to speed up install)
        find "$INSTALL_DIR" -maxdepth 1 -not -name 'node_modules' -not -name '.' -not -name '..' | while read -r item; do
            rm -rf "$item"
        done
        cp -a "$inner/src/." "$INSTALL_DIR/"
    else
        # Flat layout
        find "$INSTALL_DIR" -maxdepth 1 -not -name 'node_modules' -not -name '.' -not -name '..' | while read -r item; do
            rm -rf "$item"
        done
        cp -a "$inner/." "$INSTALL_DIR/"
    fi

    log "Files updated."

    # 8. Check for upgrade patch script
    if [ -f "$INSTALL_DIR/scripts/upgrade-patch.sh" ]; then
        step "Running upgrade patch"
        info "Found scripts/upgrade-patch.sh, executing..."
        bash "$INSTALL_DIR/scripts/upgrade-patch.sh" \
            && log "Upgrade patch complete." \
            || warn "Upgrade patch had errors (continuing anyway)."
    fi

    # 9. Install dependencies and build
    step "Installing dependencies"
    cd "$INSTALL_DIR"

    info "Running pnpm install..."
    pnpm install --frozen-lockfile 2>&1 | tail -5 || pnpm install 2>&1 | tail -5
    log "Dependencies installed."

    info "Building project..."
    pnpm build 2>&1 | tail -10
    log "Build complete."

    # 10. Run DB migrations
    step "Running database migrations"
    if [ -f "$INSTALL_DIR/scripts/migrate.js" ]; then
        info "Running migrations..."
        node "$INSTALL_DIR/scripts/migrate.js" \
            && log "Migrations complete." \
            || warn "Migration had errors (check database manually)."
    else
        info "No migration script found — skipping."
    fi

    # 11. Restart the server
    restart_server

    # 12. Clean up backup on success
    step "Cleaning up"
    info "Removing backup..."
    rm -rf "$backup_dir"
    log "Backup removed."

    # 13. Success
    echo ""
    echo -e "${BOLD}${GREEN}"
    echo "  ╔═══════════════════════════════════════════╗"
    echo "  ║     Mu updated successfully!        ║"
    echo "  ╚═══════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${BOLD}Previous:${NC}  ${current_version}"
    echo -e "  ${BOLD}Current:${NC}   ${latest_tag}"
    echo -e "  ${BOLD}Location:${NC}  ${INSTALL_DIR}"
    echo ""
}

main "$@"

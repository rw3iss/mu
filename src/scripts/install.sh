#!/usr/bin/env bash
set -euo pipefail

# CineHost - Self-Hosted Movie Streaming Platform
# Cross-platform install script (Linux, macOS, Windows Git Bash / MSYS2)

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

GITHUB_REPO="rw3iss/cinehost"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}"
MIN_NODE=20
MIN_PNPM=9
MIN_FFMPEG=5

# ── Helpers ──────────────────────────────────────────────────────────────────

log()    { echo -e "  ${GREEN}[+]${NC} $1"; }
warn()   { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()    { echo -e "  ${RED}[x]${NC} $1"; }
info()   { echo -e "  ${CYAN}[i]${NC} $1"; }
step()   { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
prompt() {
    local varname="$1" text="$2" default="$3"
    local value
    echo -en "  ${CYAN}${text}${NC} [${default}]: "
    read -r value
    eval "$varname=\"\${value:-$default}\""
}

die() { err "$1"; exit 1; }

cleanup() {
    [ -n "${TMPDIR_CREATED:-}" ] && rm -rf "$TMPDIR_CREATED"
}
trap cleanup EXIT

# ── Platform Detection ───────────────────────────────────────────────────────

detect_platform() {
    local os
    os="$(uname -s)"
    ARCH="$(uname -m)"

    case "$os" in
        Linux*)            PLATFORM="linux" ;;
        Darwin*)           PLATFORM="macos" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *)                 die "Unsupported OS: $os" ;;
    esac

    # Detect Linux package manager
    if [ "$PLATFORM" = "linux" ]; then
        if command -v apt-get &>/dev/null; then
            PKG_MGR="apt"
        elif command -v dnf &>/dev/null; then
            PKG_MGR="dnf"
        elif command -v pacman &>/dev/null; then
            PKG_MGR="pacman"
        elif command -v apk &>/dev/null; then
            PKG_MGR="apk"
        else
            PKG_MGR="unknown"
        fi
    fi
}

# ── Version Checking ─────────────────────────────────────────────────────────

version_major() {
    echo "$1" | grep -oE '[0-9]+' | head -1
}

check_cmd_version() {
    local cmd="$1" min_major="$2" version_flag="${3:---version}"
    if ! command -v "$cmd" &>/dev/null; then
        return 1
    fi
    local ver_str major
    ver_str="$("$cmd" "$version_flag" 2>&1 | head -1)"
    major=$(version_major "$ver_str")
    [ -n "$major" ] && [ "$major" -ge "$min_major" ] 2>/dev/null
}

# ── JSON Parsing ─────────────────────────────────────────────────────────────
# We need to parse GitHub API JSON. Try jq, python3, then node as fallback.

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

# Extract release info from JSON: outputs "tag_name|published_at|tarball_url|zipball_url" per line
parse_releases_json() {
    local json="$1"
    case "$json_parse_cmd" in
        jq)
            echo "$json" | jq -r '.[] | "\(.tag_name)|\(.published_at)|\(.tarball_url)|\(.zipball_url)"'
            ;;
        python3|python)
            echo "$json" | "$json_parse_cmd" -c "
import json, sys
data = json.load(sys.stdin)
if isinstance(data, list):
    for r in data:
        print(f\"{r['tag_name']}|{r['published_at']}|{r['tarball_url']}|{r['zipball_url']}\")
elif isinstance(data, dict):
    r = data
    print(f\"{r['tag_name']}|{r['published_at']}|{r['tarball_url']}|{r['zipball_url']}\")
"
            ;;
        node)
            echo "$json" | node -e "
const chunks=[];
process.stdin.on('data',c=>chunks.push(c));
process.stdin.on('end',()=>{
    let data=JSON.parse(chunks.join(''));
    if(!Array.isArray(data)) data=[data];
    data.forEach(r=>console.log(r.tag_name+'|'+r.published_at+'|'+r.tarball_url+'|'+r.zipball_url));
});
"
            ;;
        *)
            die "No JSON parser available (need jq, python3, or node)"
            ;;
    esac
}

# ── Banner ───────────────────────────────────────────────────────────────────

show_banner() {
    echo -e "${BOLD}"
    echo "  ╔═══════════════════════════════════════════╗"
    echo "  ║                                           ║"
    echo "  ║          CineHost Install Wizard          ║"
    echo "  ║     Self-Hosted Movie Streaming Server    ║"
    echo "  ║                                           ║"
    echo "  ╚═══════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ── Phase 1: Prerequisites ──────────────────────────────────────────────────

install_nodejs() {
    case "$PLATFORM" in
        linux)
            case "${PKG_MGR:-}" in
                apt)
                    info "Installing Node.js 22 via NodeSource..."
                    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                    ;;
                dnf)
                    info "Installing Node.js 22 via NodeSource..."
                    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
                    sudo dnf install -y nodejs
                    ;;
                pacman)
                    sudo pacman -S --noconfirm nodejs npm
                    ;;
                *)
                    die "Cannot auto-install Node.js. Install Node.js 20+ manually: https://nodejs.org"
                    ;;
            esac
            ;;
        macos)
            if command -v brew &>/dev/null; then
                brew install node@22
            else
                die "Homebrew not found. Install Node.js 20+ manually: https://nodejs.org"
            fi
            ;;
        windows)
            info "Downloading Node.js installer..."
            local node_url="https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi"
            local node_msi="/tmp/nodejs-install.msi"
            curl -fSL -o "$node_msi" "$node_url"
            info "Running Node.js installer (this may open a GUI)..."
            msiexec //i "$(cygpath -w "$node_msi")" //passive //norestart
            rm -f "$node_msi"
            # Refresh PATH
            export PATH="/c/Program Files/nodejs:$PATH"
            ;;
    esac
}

install_pnpm() {
    info "Installing pnpm..."
    npm install -g pnpm@latest 2>&1 | tail -3
}

install_ffmpeg() {
    case "$PLATFORM" in
        linux)
            case "${PKG_MGR:-}" in
                apt)    sudo apt-get install -y ffmpeg ;;
                dnf)    sudo dnf install -y ffmpeg ;;
                pacman) sudo pacman -S --noconfirm ffmpeg ;;
                *)      warn "Cannot auto-install FFmpeg. Install it manually." ;;
            esac
            ;;
        macos)
            if command -v brew &>/dev/null; then
                brew install ffmpeg
            else
                warn "Homebrew not found. Install FFmpeg manually: https://ffmpeg.org"
            fi
            ;;
        windows)
            local ff_dir="/c/ffmpeg"
            mkdir -p "$ff_dir"

            # Check if WinGet installed FFmpeg (symlinks may have permission issues)
            local winget_ffmpeg
            winget_ffmpeg=$(find "/c/Users/$(whoami)/AppData/Local/Microsoft/WinGet/Packages" \
                -name 'ffmpeg.exe' -path '*/bin/*' 2>/dev/null | head -1)

            if [ -n "$winget_ffmpeg" ]; then
                info "Found WinGet FFmpeg, copying binaries to $ff_dir..."
                local bin_dir
                bin_dir=$(dirname "$winget_ffmpeg")
                cp "$bin_dir/ffmpeg.exe" "$ff_dir/" 2>/dev/null || true
                cp "$bin_dir/ffprobe.exe" "$ff_dir/" 2>/dev/null || true
                cp "$bin_dir/ffplay.exe" "$ff_dir/" 2>/dev/null || true
            else
                info "Downloading FFmpeg for Windows..."
                local ff_url="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
                local ff_zip="/tmp/ffmpeg.zip"
                curl -fSL -o "$ff_zip" "$ff_url"
                unzip -o -q "$ff_zip" -d "$ff_dir"
                local inner_dir
                inner_dir=$(find "$ff_dir" -maxdepth 1 -type d -name 'ffmpeg-*' | head -1)
                if [ -n "$inner_dir" ]; then
                    cp "$inner_dir/bin/"* "$ff_dir/" 2>/dev/null || true
                fi
                rm -f "$ff_zip"
            fi

            export PATH="$ff_dir:$PATH"
            # Add to .bash_profile for Git Bash sessions
            if [ -f "$HOME/.bash_profile" ] && ! grep -q "/c/ffmpeg" "$HOME/.bash_profile" 2>/dev/null; then
                echo 'export PATH="/c/ffmpeg:$PATH"' >> "$HOME/.bash_profile"
                log "Added C:\\ffmpeg to Git Bash PATH"
            elif [ -f "$HOME/.bashrc" ] && ! grep -q "/c/ffmpeg" "$HOME/.bashrc" 2>/dev/null; then
                echo 'export PATH="/c/ffmpeg:$PATH"' >> "$HOME/.bashrc"
                log "Added C:\\ffmpeg to Git Bash PATH"
            fi

            # Add to Windows system PATH (required for Node.js child processes)
            echo -en "  ${CYAN}Add C:\\ffmpeg to Windows system PATH? (required for transcoding) (Y/n):${NC} "
            read -r add_sys_path
            if [ "${add_sys_path,,}" != "n" ]; then
                powershell.exe -NoProfile -Command "
                    \$p = [Environment]::GetEnvironmentVariable('PATH','Machine');
                    if (\$p -notlike '*C:\\ffmpeg*') {
                        [Environment]::SetEnvironmentVariable('PATH','C:\\ffmpeg;'+\$p,'Machine');
                        Write-Host 'Added C:\\ffmpeg to Windows system PATH'
                    } else {
                        Write-Host 'C:\\ffmpeg already in system PATH'
                    }
                " 2>/dev/null && log "Windows system PATH updated" || warn "Failed to update system PATH (may need admin privileges)"
            fi

            info "FFmpeg installed to $ff_dir"
            ;;
    esac
}

check_prerequisites() {
    step "Phase 1: Checking prerequisites"

    # Node.js
    if check_cmd_version node $MIN_NODE "-v"; then
        log "Node.js $(node -v) detected"
    else
        if command -v node &>/dev/null; then
            warn "Node.js $(node -v) detected, but v${MIN_NODE}+ is required."
        else
            warn "Node.js not found."
        fi
        echo -en "  ${CYAN}Install Node.js automatically? (Y/n):${NC} "
        read -r yn
        if [ "${yn,,}" != "n" ]; then
            install_nodejs
            if check_cmd_version node $MIN_NODE "-v"; then
                log "Node.js $(node -v) installed successfully"
            else
                die "Node.js installation failed. Install v${MIN_NODE}+ manually: https://nodejs.org"
            fi
        else
            die "Node.js ${MIN_NODE}+ is required. Install it and re-run this script."
        fi
    fi

    # pnpm
    if check_cmd_version pnpm $MIN_PNPM "-v"; then
        log "pnpm $(pnpm -v) detected"
    else
        if command -v pnpm &>/dev/null; then
            warn "pnpm $(pnpm -v) detected, but v${MIN_PNPM}+ is required."
        else
            info "pnpm not found, installing..."
        fi
        install_pnpm
        if check_cmd_version pnpm $MIN_PNPM "-v"; then
            log "pnpm $(pnpm -v) installed"
        else
            die "pnpm installation failed."
        fi
    fi

    # FFmpeg
    if check_cmd_version ffmpeg $MIN_FFMPEG "-version"; then
        local ff_ver
        ff_ver=$(ffmpeg -version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
        log "FFmpeg ${ff_ver} detected"
    else
        warn "FFmpeg ${MIN_FFMPEG}+ not found. Required for video transcoding."
        echo -en "  ${CYAN}Install FFmpeg automatically? (Y/n):${NC} "
        read -r yn
        if [ "${yn,,}" != "n" ]; then
            install_ffmpeg
            if command -v ffmpeg &>/dev/null; then
                log "FFmpeg installed"
            else
                warn "FFmpeg installation may require reopening your terminal."
            fi
        else
            warn "Skipping FFmpeg -- streaming/transcoding won't work without it."
        fi
    fi

    echo ""
    log "Prerequisites check complete"
}

# ── Phase 2: Release Selection ───────────────────────────────────────────────

select_release() {
    step "Phase 2: Select CineHost release"
    info "Fetching available releases..."

    detect_json_parser
    if [ -z "$json_parse_cmd" ]; then
        die "No JSON parser found (need jq, python3, or node)"
    fi

    local releases_json
    releases_json=$(curl -fsSL "${GITHUB_API}/releases" \
        -H "Accept: application/vnd.github+json" 2>/dev/null) || die "Failed to fetch releases from GitHub"

    # Parse into lines: tag|date|tarball|zipball
    local release_lines
    release_lines=$(parse_releases_json "$releases_json")

    if [ -z "$release_lines" ]; then
        die "No releases found at ${GITHUB_API}/releases"
    fi

    # Display releases
    echo ""
    echo -e "  ${BOLD}Available CineHost Releases:${NC}"
    echo ""

    local i=1
    local tags=() dates=() tarballs=() zipballs=()
    while IFS='|' read -r tag date tarball zipball; do
        local pretty_date
        pretty_date=$(echo "$date" | cut -c1-10)
        local label=""
        [ $i -eq 1 ] && label="  ${GREEN}(latest)${NC}"
        printf "    ${BOLD}%2d)${NC}  %-20s  ${DIM}%s${NC}%b\n" "$i" "$tag" "$pretty_date" "$label"
        tags+=("$tag")
        dates+=("$pretty_date")
        tarballs+=("$tarball")
        zipballs+=("$zipball")
        ((i++))
    done <<< "$release_lines"

    echo ""
    local choice
    echo -en "  ${CYAN}Select release [1]:${NC} "
    read -r choice
    choice="${choice:-1}"

    # Validate
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#tags[@]}" ]; then
        die "Invalid selection: $choice"
    fi

    local idx=$((choice - 1))
    SELECTED_TAG="${tags[$idx]}"
    SELECTED_DATE="${dates[$idx]}"
    SELECTED_TARBALL="${tarballs[$idx]}"
    SELECTED_ZIPBALL="${zipballs[$idx]}"

    log "Selected: ${SELECTED_TAG} (${SELECTED_DATE})"
}

# ── Phase 3: Configuration ──────────────────────────────────────────────────

configure_install() {
    step "Phase 3: Configure installation"

    # Default install directory
    local default_dir
    case "$PLATFORM" in
        linux)   default_dir="$HOME/cinehost" ;;
        macos)   default_dir="$HOME/cinehost" ;;
        windows) default_dir="/c/cinehost" ;;
    esac

    prompt INSTALL_DIR "Install directory" "$default_dir"

    # Data directory
    prompt DATA_DIR "Data directory (database, cache, config)" "${INSTALL_DIR}/data"

    # Port
    prompt SERVER_PORT "Server port" "4000"
    while ! [[ "$SERVER_PORT" =~ ^[0-9]+$ ]] || [ "$SERVER_PORT" -lt 1 ] || [ "$SERVER_PORT" -gt 65535 ]; do
        warn "Invalid port number."
        prompt SERVER_PORT "Server port" "4000"
    done

    # Firewall
    echo -en "  ${CYAN}Open port ${SERVER_PORT} in firewall for external access? (y/N):${NC} "
    read -r OPEN_FIREWALL
    OPEN_FIREWALL="${OPEN_FIREWALL,,}"

    # Install as service (Linux only)
    INSTALL_SERVICE="n"
    if [ "$PLATFORM" = "linux" ] && command -v systemctl &>/dev/null; then
        echo -en "  ${CYAN}Install as systemd service (auto-start on boot)? (Y/n):${NC} "
        read -r INSTALL_SERVICE
        INSTALL_SERVICE="${INSTALL_SERVICE:-y}"
        INSTALL_SERVICE="${INSTALL_SERVICE,,}"
    fi

    echo ""
    echo -e "  ${BOLD}Configuration Summary:${NC}"
    echo -e "    Release:       ${SELECTED_TAG}"
    echo -e "    Install dir:   ${INSTALL_DIR}"
    echo -e "    Data dir:      ${DATA_DIR}"
    echo -e "    Port:          ${SERVER_PORT}"
    echo -e "    Firewall:      $([ "$OPEN_FIREWALL" = "y" ] && echo "open port" || echo "no change")"
    [ "$PLATFORM" = "linux" ] && echo -e "    Service:       $([ "${INSTALL_SERVICE}" = "y" ] && echo "yes" || echo "no")"
    echo ""

    echo -en "  ${CYAN}Proceed with installation? (Y/n):${NC} "
    read -r confirm
    if [ "${confirm,,}" = "n" ]; then
        info "Installation cancelled."
        exit 0
    fi
}

# ── Phase 4: Download & Extract ──────────────────────────────────────────────

download_release() {
    step "Phase 5: Downloading CineHost ${SELECTED_TAG}"

    local download_url
    if [ "$PLATFORM" = "windows" ]; then
        download_url="$SELECTED_ZIPBALL"
    else
        download_url="$SELECTED_TARBALL"
    fi

    TMPDIR_CREATED=$(mktemp -d 2>/dev/null || mktemp -d -t 'cinehost-install')
    local archive_file="${TMPDIR_CREATED}/cinehost-release"

    info "Downloading from GitHub..."
    curl -fSL -o "$archive_file" "$download_url" 2>&1 | tail -1 || die "Download failed"
    log "Download complete"

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    info "Extracting..."
    if [ "$PLATFORM" = "windows" ]; then
        unzip -o -q "$archive_file" -d "$TMPDIR_CREATED/extracted"
    else
        mkdir -p "$TMPDIR_CREATED/extracted"
        # Use 'command' to bypass shell aliases on tar
        command tar --extract --gzip -f "$archive_file" -C "$TMPDIR_CREATED/extracted"
    fi

    # GitHub tarballs have a top-level directory like "owner-repo-sha/"
    local inner
    inner=$(find "$TMPDIR_CREATED/extracted" -mindepth 1 -maxdepth 1 -type d | head -1)
    if [ -z "$inner" ]; then
        die "Failed to extract release archive"
    fi

    # The source code lives inside a src/ directory in the repo
    if [ -d "$inner/src" ]; then
        # Copy the src contents (which is the monorepo root with package.json)
        cp -a "$inner/src/." "$INSTALL_DIR/"
        # Also copy top-level scripts and configs if present
        for f in "$inner/README.md" "$inner/LICENSE"; do
            [ -f "$f" ] && cp "$f" "$INSTALL_DIR/"
        done
    else
        # Flat layout -- copy everything
        cp -a "$inner/." "$INSTALL_DIR/"
    fi

    log "Extracted to ${INSTALL_DIR}"
}

# ── Phase 5: Build ───────────────────────────────────────────────────────────

build_project() {
    step "Phase 6: Building CineHost"
    cd "$INSTALL_DIR"

    info "Installing dependencies (this may take a minute)..."
    pnpm install --frozen-lockfile 2>&1 | tail -5 || pnpm install 2>&1 | tail -5
    log "Dependencies installed"

    info "Building project..."
    pnpm build 2>&1 | tail -10
    log "Build complete"
}

# ── Phase 6: Generate Config ────────────────────────────────────────────────

generate_config() {
    step "Phase 7: Generating configuration"

    local config_dir="${DATA_DIR}/config"
    mkdir -p "$config_dir"
    mkdir -p "${DATA_DIR}/db"
    mkdir -p "${DATA_DIR}/cache/images"
    mkdir -p "${DATA_DIR}/cache/streams"
    mkdir -p "${DATA_DIR}/thumbnails"
    mkdir -p "${DATA_DIR}/logs"

    local jwt_secret cookie_secret
    if command -v openssl &>/dev/null; then
        jwt_secret=$(openssl rand -hex 32)
        cookie_secret=$(openssl rand -hex 32)
    else
        jwt_secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        cookie_secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    fi

    # Resolve data dir relative to install dir if needed
    local config_data_dir="$DATA_DIR"
    # If data dir is inside install dir, use relative path
    case "$DATA_DIR" in
        "$INSTALL_DIR"/*)
            config_data_dir="./${DATA_DIR#$INSTALL_DIR/}"
            ;;
    esac

    # Build thirdParty YAML block only if any keys are set
    local third_party_block=""
    if [ -n "$API_KEY_TMDB" ] || [ -n "$API_KEY_OMDB" ] || [ -n "$API_KEY_OPENSUBTITLES" ]; then
        third_party_block=$'\nthirdParty:'
        if [ -n "$API_KEY_TMDB" ]; then
            third_party_block+=$'\n  tmdb:'
            third_party_block+=$'\n    apiKey: "'"${API_KEY_TMDB}"'"'
        fi
        if [ -n "$API_KEY_OMDB" ]; then
            third_party_block+=$'\n  omdb:'
            third_party_block+=$'\n    apiKey: "'"${API_KEY_OMDB}"'"'
        fi
        if [ -n "$API_KEY_OPENSUBTITLES" ]; then
            third_party_block+=$'\n  opensubtitles:'
            third_party_block+=$'\n    apiKey: "'"${API_KEY_OPENSUBTITLES}"'"'
        fi
    fi

    cat > "${config_dir}/config.yml" << YAML
# CineHost configuration
# Generated by install script on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# Override values with MU_ prefixed environment variables.
# Example: MU_SERVER__PORT=8080

server:
  host: "0.0.0.0"
  port: ${SERVER_PORT}

auth:
  jwtSecret: "${jwt_secret}"
  cookieSecret: "${cookie_secret}"

dataDir: "${config_data_dir}"

media:
  libraryPaths: []
${third_party_block}
YAML

    log "Configuration saved to ${config_dir}/config.yml"
}

# ── Phase 7: API Keys ────────────────────────────────────────────────────────

# Global API key variables
API_KEY_TMDB=""
API_KEY_OMDB=""
API_KEY_OPENSUBTITLES=""

configure_api_keys() {
    step "Phase 4: API Keys"
    echo ""
    info "API keys enable metadata fetching, ratings, and subtitle search."
    info "You can skip this step and configure keys later in the config file."
    echo ""

    echo -en "  ${CYAN}Configure API keys now? (Y/n):${NC} "
    read -r yn
    if [ "${yn,,}" = "n" ]; then
        info "Skipped — features requiring API keys will be disabled until configured."
        return
    fi

    while true; do
        echo ""
        echo -e "  ${BOLD}API Keys:${NC}"
        echo ""

        # TMDB
        if [ -n "$API_KEY_TMDB" ]; then
            echo -e "    ${BOLD}1)${NC}  TMDB            ${GREEN}(key: ${API_KEY_TMDB})${NC}"
        else
            echo -e "    ${BOLD}1)${NC}  TMDB            ${DIM}<not set>${NC}  ${DIM}https://www.themoviedb.org/settings/api${NC}"
        fi

        # OMDB
        if [ -n "$API_KEY_OMDB" ]; then
            echo -e "    ${BOLD}2)${NC}  OMDB / IMDb     ${GREEN}(key: ${API_KEY_OMDB})${NC}"
        else
            echo -e "    ${BOLD}2)${NC}  OMDB / IMDb     ${DIM}<not set>${NC}  ${DIM}https://www.omdbapi.com/apikey.aspx${NC}"
        fi

        # OpenSubtitles
        if [ -n "$API_KEY_OPENSUBTITLES" ]; then
            echo -e "    ${BOLD}3)${NC}  OpenSubtitles   ${GREEN}(key: ${API_KEY_OPENSUBTITLES})${NC}"
        else
            echo -e "    ${BOLD}3)${NC}  OpenSubtitles   ${DIM}<not set>${NC}  ${DIM}https://www.opensubtitles.com/consumers${NC}"
        fi

        echo ""
        echo -e "    ${BOLD}d)${NC}  Done"
        echo -e "    ${BOLD}s)${NC}  Skip (configure later)"
        echo ""

        echo -en "  ${CYAN}Select option:${NC} "
        read -r key_choice

        case "$key_choice" in
            1)
                echo -en "  ${CYAN}Enter TMDB API key:${NC} "
                read -r val
                val="${val// /}"
                if [ -n "$val" ]; then
                    API_KEY_TMDB="$val"
                    log "TMDB key set"
                fi
                ;;
            2)
                echo -en "  ${CYAN}Enter OMDB API key:${NC} "
                read -r val
                val="${val// /}"
                if [ -n "$val" ]; then
                    API_KEY_OMDB="$val"
                    log "OMDB key set"
                fi
                ;;
            3)
                echo -en "  ${CYAN}Enter OpenSubtitles API key:${NC} "
                read -r val
                val="${val// /}"
                if [ -n "$val" ]; then
                    API_KEY_OPENSUBTITLES="$val"
                    log "OpenSubtitles key set"
                fi
                ;;
            d|D)
                break
                ;;
            s|S)
                info "Skipped — configure API keys later in config.yml"
                API_KEY_TMDB=""
                API_KEY_OMDB=""
                API_KEY_OPENSUBTITLES=""
                break
                ;;
            *)
                warn "Invalid option"
                ;;
        esac
    done

    # Summary
    local count=0
    [ -n "$API_KEY_TMDB" ] && ((count++))
    [ -n "$API_KEY_OMDB" ] && ((count++))
    [ -n "$API_KEY_OPENSUBTITLES" ] && ((count++))
    log "${count} API key(s) configured"
}

# ── Phase 8: Firewall ───────────────────────────────────────────────────────

configure_firewall() {
    if [ "${OPEN_FIREWALL}" != "y" ]; then
        return
    fi

    step "Phase 8: Opening firewall port ${SERVER_PORT}"

    case "$PLATFORM" in
        linux)
            if command -v ufw &>/dev/null; then
                sudo ufw allow "${SERVER_PORT}/tcp" comment "CineHost" && log "ufw rule added"
            elif command -v firewall-cmd &>/dev/null; then
                sudo firewall-cmd --permanent --add-port="${SERVER_PORT}/tcp"
                sudo firewall-cmd --reload
                log "firewalld rule added"
            elif command -v iptables &>/dev/null; then
                sudo iptables -A INPUT -p tcp --dport "$SERVER_PORT" -j ACCEPT
                log "iptables rule added (note: not persistent across reboots)"
            else
                warn "No supported firewall tool found. Open port ${SERVER_PORT} manually."
            fi
            ;;
        macos)
            # macOS pf firewall -- add app-level exception
            if command -v /usr/libexec/ApplicationFirewall/socketfilterfw &>/dev/null; then
                local node_path
                node_path=$(which node)
                sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$node_path" 2>/dev/null
                sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$node_path" 2>/dev/null
                log "macOS firewall exception added for Node.js"
            else
                warn "Cannot configure macOS firewall automatically."
            fi
            ;;
        windows)
            netsh advfirewall firewall add rule name="CineHost" dir=in action=allow protocol=TCP localport="$SERVER_PORT" 2>/dev/null \
                && log "Windows Firewall rule added" \
                || warn "Failed to add firewall rule. Run as administrator or add manually."
            ;;
    esac
}

# ── Phase 8: Systemd Service (Linux) ────────────────────────────────────────

install_systemd_service() {
    if [ "$PLATFORM" != "linux" ] || [ "${INSTALL_SERVICE:-n}" != "y" ]; then
        return
    fi

    step "Phase 9: Installing systemd service"

    local service_file="/etc/systemd/system/cinehost.service"
    local node_path
    node_path=$(which node)
    local current_user
    current_user=$(whoami)

    sudo tee "$service_file" > /dev/null << UNIT
[Unit]
Description=CineHost Movie Streaming Server
After=network.target

[Service]
Type=simple
User=${current_user}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${node_path} packages/server/dist/main.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=MU_DATA_DIR=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT

    sudo systemctl daemon-reload
    sudo systemctl enable cinehost
    sudo systemctl start cinehost
    log "Systemd service installed and started"
}

# ── Finish ───────────────────────────────────────────────────────────────────

show_success() {
    local access_url="http://localhost:${SERVER_PORT}"

    echo ""
    echo -e "${BOLD}${GREEN}"
    echo "  ╔═══════════════════════════════════════════╗"
    echo "  ║   CineHost installed successfully!        ║"
    echo "  ╚═══════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "  ${BOLD}Version:${NC}    ${SELECTED_TAG}"
    echo -e "  ${BOLD}Location:${NC}   ${INSTALL_DIR}"
    echo -e "  ${BOLD}Data:${NC}       ${DATA_DIR}"
    echo -e "  ${BOLD}Config:${NC}     ${DATA_DIR}/config/config.yml"
    echo -e "  ${BOLD}Port:${NC}       ${SERVER_PORT}"
    echo ""

    if [ "${INSTALL_SERVICE:-n}" = "y" ]; then
        echo -e "  ${BOLD}Service:${NC}    sudo systemctl status cinehost"
        echo -e "  ${BOLD}Logs:${NC}       sudo journalctl -u cinehost -f"
    else
        echo -e "  ${BOLD}Start:${NC}      cd ${INSTALL_DIR} && NODE_ENV=production node packages/server/dist/main.js"
    fi

    echo ""
    echo -e "  ${BOLD}Open:${NC}       ${CYAN}${access_url}${NC}"
    echo ""
    echo -e "  ${DIM}First visit: create your admin account at the setup page.${NC}"
    echo -e "  ${DIM}Add media directories in Settings > Library after login.${NC}"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    show_banner
    detect_platform
    info "Platform: ${PLATFORM} (${ARCH})"

    check_prerequisites
    select_release
    configure_install
    configure_api_keys
    download_release
    build_project
    generate_config
    configure_firewall
    install_systemd_service
    show_success
}

main "$@"

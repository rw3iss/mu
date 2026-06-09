#!/usr/bin/env bash
#
# setup-fedora.sh — full Fedora/RHEL workstation setup for Mu / CineHost.
#
# Brings a freshly-cloned repo to a runnable state on Fedora with NVIDIA NVENC,
# carrying over a previous instance's config. Idempotent — safe to re-run.
#
# It will, checking each step and only doing what's missing:
#   - install system build deps, Node 20+, pnpm 9+
#   - enable RPM Fusion and install the NVENC-capable ffmpeg (NOT ffmpeg-free)
#   - install the NVIDIA driver (akmod) if a GPU is present and asked for
#   - add the run user to the video/render groups (GPU device access)
#   - import an existing .env (and leave a copied config.yml / DB untouched)
#   - pnpm install + build
#   - create data dirs, run DB migrations, and SEED ONLY IF the DB is new
#     (so a copied mu.db is preserved)
#   - smoke-test NVENC, open the firewall port, and optionally install the
#     systemd service
#
# Usage:
#   ./setup-fedora.sh [options]
#     --env <path>        Import this .env into src/.env (carry over a previous install)
#     --data-dir <path>   MU_DATA_DIR (default: from .env, else <repo>/data)
#     --port <n>          Server port (default: from .env, else 4000)
#     --user <name>       Run/service user (default: current user)
#     --service           Install + enable the systemd 'mu' service
#     --no-nvidia         Skip NVIDIA driver install (still installs NVENC ffmpeg)
#     --yes               Non-interactive: assume yes / defaults
#     -h, --help          Show this help
#
set -uo pipefail

# ── Colors / logging ─────────────────────────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
log()  { echo -e "  ${GREEN}[+]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()  { echo -e "  ${RED}[x]${NC} $1"; }
info() { echo -e "  ${CYAN}[i]${NC} $1"; }
step() { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()  { err "$1"; exit 1; }

MIN_NODE=20
MIN_PNPM=9

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"        # the pnpm workspace root (…/src)
PROJECT_ROOT="$(cd "$SRC_DIR/.." && pwd)"      # repo root (contains src/) — matches migrate.js

# ── Options ──────────────────────────────────────────────────────────────────
ENV_IMPORT=""
DATA_DIR_OPT=""
PORT_OPT=""
RUN_USER="$(id -un)"
INSTALL_SERVICE="n"
SKIP_NVIDIA="n"
ASSUME_YES="n"

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

while [ $# -gt 0 ]; do
	case "$1" in
		--env)       ENV_IMPORT="${2:-}"; shift 2 ;;
		--data-dir)  DATA_DIR_OPT="${2:-}"; shift 2 ;;
		--port)      PORT_OPT="${2:-}"; shift 2 ;;
		--user)      RUN_USER="${2:-}"; shift 2 ;;
		--service)   INSTALL_SERVICE="y"; shift ;;
		--no-nvidia) SKIP_NVIDIA="y"; shift ;;
		--yes|-y)    ASSUME_YES="y"; shift ;;
		-h|--help)   usage ;;
		*)           die "Unknown option: $1 (try --help)" ;;
	esac
done

confirm() {
	# confirm "Question?" <default y|n>
	local q="$1" def="${2:-y}" ans
	[ "$ASSUME_YES" = "y" ] && return 0
	local hint="[Y/n]"; [ "$def" = "n" ] && hint="[y/N]"
	echo -en "  ${CYAN}${q}${NC} ${hint}: "
	read -r ans
	ans="${ans:-$def}"; ans="${ans,,}"
	[ "$ans" = "y" ]
}

have() { command -v "$1" &>/dev/null; }

# Run a privileged command (sudo if not already root).
SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

major_of() { echo "$1" | grep -oE '[0-9]+' | head -1; }

# ── Preflight ────────────────────────────────────────────────────────────────
preflight() {
	step "Preflight"
	if ! have dnf; then
		die "dnf not found — this script targets Fedora/RHEL. On Debian/Ubuntu use install.sh."
	fi
	local fedora_ver
	fedora_ver="$(rpm -E %fedora 2>/dev/null || echo '?')"
	info "Fedora release: ${fedora_ver}"
	info "Repo:      ${PROJECT_ROOT}"
	info "Workspace: ${SRC_DIR}"
	info "Run user:  ${RUN_USER}"
	if [ "$(id -u)" -eq 0 ] && [ "$RUN_USER" = "root" ]; then
		warn "Running as root with run-user=root. Pass --user <name> for an unprivileged run user."
	fi
	[ -f "$SRC_DIR/package.json" ] || die "No package.json in $SRC_DIR — run this from the repo's src/scripts/."
}

# ── System packages ──────────────────────────────────────────────────────────
install_system_deps() {
	step "System packages (build tools, git, curl, openssl)"
	# gcc-c++/make/python3 cover native rebuilds of better-sqlite3 if no prebuilt
	# binary matches; the rest are baseline tooling.
	# vmtouch lets the memory-cache module actively warm/evict files in the OS
	# page cache (Settings → Encoding → Maximum Cache Memory).
	local pkgs=(gcc-c++ make python3 git curl tar openssl vmtouch)
	local missing=()
	for p in "${pkgs[@]}"; do rpm -q "$p" &>/dev/null || missing+=("$p"); done
	if [ ${#missing[@]} -eq 0 ]; then
		log "Build tooling present"
	else
		info "Installing: ${missing[*]}"
		$SUDO dnf install -y "${missing[@]}" || warn "Some packages failed to install"
		log "Build tooling installed"
	fi
}

# ── Node + pnpm ──────────────────────────────────────────────────────────────
install_node() {
	step "Node.js (>= ${MIN_NODE})"
	if have node && [ "$(major_of "$(node -v)")" -ge "$MIN_NODE" ] 2>/dev/null; then
		log "Node.js $(node -v) present"
		return
	fi
	info "Installing Node.js 22 via NodeSource…"
	curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO bash - || die "NodeSource setup failed"
	$SUDO dnf install -y nodejs || die "Node.js install failed"
	have node && [ "$(major_of "$(node -v)")" -ge "$MIN_NODE" ] || die "Node.js >= ${MIN_NODE} still not available"
	log "Node.js $(node -v) installed"
}

install_pnpm() {
	step "pnpm (>= ${MIN_PNPM})"
	if have pnpm && [ "$(major_of "$(pnpm -v)")" -ge "$MIN_PNPM" ] 2>/dev/null; then
		log "pnpm $(pnpm -v) present"
		return
	fi
	info "Installing pnpm via npm…"
	$SUDO npm install -g pnpm@latest || die "pnpm install failed"
	have pnpm && [ "$(major_of "$(pnpm -v)")" -ge "$MIN_PNPM" ] || die "pnpm >= ${MIN_PNPM} still not available"
	log "pnpm $(pnpm -v) installed"
}

# ── RPM Fusion + NVENC ffmpeg ────────────────────────────────────────────────
HAS_NVIDIA_GPU="n"
detect_gpu() {
	if have lspci && lspci 2>/dev/null | grep -qiE 'vga|3d|display'; then
		lspci 2>/dev/null | grep -qi 'nvidia' && HAS_NVIDIA_GPU="y"
	fi
}

enable_rpmfusion() {
	if rpm -q rpmfusion-free-release &>/dev/null && rpm -q rpmfusion-nonfree-release &>/dev/null; then
		log "RPM Fusion already enabled"
		return
	fi
	info "Enabling RPM Fusion (free + nonfree)…"
	local fv; fv="$(rpm -E %fedora)"
	$SUDO dnf install -y \
		"https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${fv}.noarch.rpm" \
		"https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-${fv}.noarch.rpm" \
		|| warn "RPM Fusion enable failed — NVENC ffmpeg may be unavailable"
}

install_ffmpeg() {
	step "FFmpeg (NVENC-capable — RPM Fusion full build, not ffmpeg-free)"
	enable_rpmfusion
	# Fedora ships ffmpeg-free (no nvenc). Swap to RPM Fusion's full ffmpeg.
	if rpm -q ffmpeg-free &>/dev/null; then
		info "Replacing ffmpeg-free with the full ffmpeg…"
		$SUDO dnf swap -y ffmpeg-free ffmpeg --allowerasing || warn "ffmpeg swap failed"
	elif ! rpm -q ffmpeg &>/dev/null; then
		info "Installing ffmpeg…"
		$SUDO dnf install -y ffmpeg --allowerasing || warn "ffmpeg install failed"
	else
		log "ffmpeg package present"
	fi

	if ! have ffmpeg; then
		warn "ffmpeg not on PATH after install"
		return
	fi
	# The make-or-break check: are the nvenc encoders compiled in?
	if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q nvenc; then
		log "ffmpeg has NVENC encoders: $(ffmpeg -hide_banner -encoders 2>/dev/null | grep -oE '[a-z0-9]+_nvenc' | tr '\n' ' ')"
	else
		warn "ffmpeg is installed but has NO nvenc encoders (likely still ffmpeg-free)."
		warn "Fix: sudo dnf swap ffmpeg-free ffmpeg --allowerasing  (needs RPM Fusion enabled)"
	fi
}

# ── NVIDIA driver ────────────────────────────────────────────────────────────
NVIDIA_NEEDS_REBOOT="n"
install_nvidia() {
	[ "$HAS_NVIDIA_GPU" = "y" ] || { info "No NVIDIA GPU detected — skipping driver"; return; }
	[ "$SKIP_NVIDIA" = "y" ] && { info "Skipping NVIDIA driver (--no-nvidia)"; return; }
	step "NVIDIA driver"
	if have nvidia-smi && nvidia-smi &>/dev/null; then
		log "NVIDIA driver already working: $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null | head -1)"
		return
	fi
	confirm "Install the NVIDIA proprietary driver (akmod-nvidia + CUDA libs for NVENC)?" y || {
		warn "Skipping NVIDIA driver — NVENC will not work until a driver is installed"
		return
	}
	enable_rpmfusion
	info "Installing akmod-nvidia + xorg-x11-drv-nvidia-cuda…"
	$SUDO dnf install -y akmod-nvidia xorg-x11-drv-nvidia-cuda || warn "NVIDIA driver install failed"
	info "Building kernel module (akmods)…"
	$SUDO akmods --force 2>/dev/null || true
	NVIDIA_NEEDS_REBOOT="y"
	warn "NVIDIA driver installed — a REBOOT is required before nvidia-smi / NVENC work."
}

# ── GPU group membership ─────────────────────────────────────────────────────
GROUPS_CHANGED="n"
ensure_gpu_groups() {
	[ "$HAS_NVIDIA_GPU" = "y" ] || return
	step "GPU device groups (video, render) for ${RUN_USER}"
	local added=""
	for g in video render; do
		if getent group "$g" >/dev/null 2>&1; then
			if id -nG "$RUN_USER" 2>/dev/null | tr ' ' '\n' | grep -qx "$g"; then
				:
			else
				$SUDO usermod -aG "$g" "$RUN_USER" && added="$added $g"
			fi
		fi
	done
	if [ -n "$added" ]; then
		GROUPS_CHANGED="y"
		warn "Added ${RUN_USER} to:${added}. Log out/in (or reboot) for group access to take effect."
	else
		log "${RUN_USER} already in video/render (or groups absent until driver loads)"
	fi
}

# ── .env import + config ─────────────────────────────────────────────────────
ENV_FILE="$SRC_DIR/.env"
setup_env() {
	step "Environment (.env)"
	if [ -n "$ENV_IMPORT" ]; then
		[ -f "$ENV_IMPORT" ] || die "--env file not found: $ENV_IMPORT"
		if [ "$(readlink -f "$ENV_IMPORT")" != "$(readlink -f "$ENV_FILE" 2>/dev/null || echo "$ENV_FILE")" ]; then
			cp "$ENV_IMPORT" "$ENV_FILE"
			log "Imported $ENV_IMPORT → $ENV_FILE"
		else
			log "Using existing $ENV_FILE"
		fi
	elif [ -f "$ENV_FILE" ]; then
		log "Existing $ENV_FILE found — leaving it as-is"
	elif [ -f "$SRC_DIR/.env.example" ]; then
		cp "$SRC_DIR/.env.example" "$ENV_FILE"
		# Fedora-friendly defaults.
		sed -i 's#^MU_SERVER_PORT=.*#MU_SERVER_PORT='"${PORT_OPT:-4000}"'#' "$ENV_FILE" 2>/dev/null || true
		log "Created $ENV_FILE from .env.example"
	else
		warn "No .env and no .env.example — relying on config.yml + env"
	fi

	# Load it so DB-path resolution + config gen see the same values the app will.
	if [ -f "$ENV_FILE" ]; then
		set -a
		# shellcheck disable=SC1090
		while IFS= read -r line; do
			line="${line%%$'\r'}"
			[ -z "$line" ] && continue
			case "$line" in \#*) continue ;; esac
			[ "${line%%=*}" = "$line" ] && continue
			eval "export $line" 2>/dev/null || true
		done < "$ENV_FILE"
		set +a
	fi

	# Resolve data dir (option > env > default), matching migrate.js semantics.
	if [ -n "$DATA_DIR_OPT" ]; then
		export MU_DATA_DIR="$DATA_DIR_OPT"
	fi
	local dd="${MU_DATA_DIR:-${MU_DATADIR:-}}"
	if [ -z "$dd" ]; then
		DATA_DIR="$PROJECT_ROOT/data"
	elif [[ "$dd" = /* ]]; then
		DATA_DIR="$dd"
	else
		DATA_DIR="$(cd "$PROJECT_ROOT" && mkdir -p "$dd" && cd "$dd" && pwd)"
	fi
	info "Data dir: ${DATA_DIR}"
}

ensure_config() {
	step "Config (config.yml)"
	local cfg_dir="${DATA_DIR}/config"
	local cfg="${cfg_dir}/config.yml"
	mkdir -p "$cfg_dir" "${DATA_DIR}/db" "${DATA_DIR}/cache/images" \
		"${DATA_DIR}/cache/streams" "${DATA_DIR}/thumbnails" "${DATA_DIR}/logs"

	if [ -f "$cfg" ]; then
		log "Existing config.yml found — leaving it untouched (secrets/media paths preserved)"
		return
	fi
	info "Generating a fresh config.yml…"
	local jwt cookie
	if have openssl; then
		jwt="$(openssl rand -hex 32)"; cookie="$(openssl rand -hex 32)"
	else
		jwt="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
		cookie="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
	fi
	cat > "$cfg" <<YAML
# Mu / CineHost configuration — generated by setup-fedora.sh on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# Secrets live here (not in the repo). Override any value with MU_ env vars.
server:
  host: "0.0.0.0"
  port: ${PORT_OPT:-${MU_SERVER_PORT:-4000}}

auth:
  jwtSecret: "${jwt}"
  cookieSecret: "${cookie}"

dataDir: "${DATA_DIR}"

transcoding:
  ffmpegPath: "/usr/bin/ffmpeg"
  ffprobePath: "/usr/bin/ffprobe"

media:
  libraryPaths: []
YAML
	log "Wrote ${cfg} (add your media paths under media.libraryPaths)"
}

# ── Build ────────────────────────────────────────────────────────────────────
build_app() {
	step "Install dependencies + build"
	cd "$SRC_DIR"
	info "pnpm install…"
	pnpm install 2>&1 | tail -4 || die "pnpm install failed"
	info "pnpm build…"
	# Nuke client dist first so Turbo's partial-restore can't ship a stale bundle.
	rm -rf packages/client/dist
	pnpm build 2>&1 | tail -6 || die "pnpm build failed"
	# Turbo can FULL-TURBO-restore a stale/empty client dist; force a clean vite
	# build if index.html/assets are missing.
	if [ ! -f packages/client/dist/index.html ] || [ -z "$(ls -A packages/client/dist/assets 2>/dev/null)" ]; then
		warn "client dist incomplete after build — forcing a clean vite build"
		( cd packages/client && rm -rf dist && pnpm exec vite build 2>&1 | tail -4 )
	fi
	log "Build complete"
}

# ── Database ─────────────────────────────────────────────────────────────────
resolve_db_path() {
	node -e '
		const path=require("path");
		const ROOT=process.argv[1];
		const ex=process.env.MU_DATABASE_SQLITE_PATH;
		const dataRaw=process.env.MU_DATA_DIR||process.env.MU_DATADIR;
		const dataDir=dataRaw?(path.isAbsolute(dataRaw)?dataRaw:path.resolve(ROOT,dataRaw)):path.resolve(ROOT,"data");
		const db=ex?(path.isAbsolute(ex)?ex:path.resolve(ROOT,ex)):path.resolve(dataDir,"db","mu.db");
		process.stdout.write(db);
	' "$PROJECT_ROOT"
}

DB_WAS_FRESH="n"
init_database() {
	step "Database"
	local db_path; db_path="$(resolve_db_path)"
	if [ -f "$db_path" ] && [ "$(wc -c < "$db_path" 2>/dev/null || echo 0)" -gt 65536 ]; then
		info "Existing database found: ${db_path} ($(du -h "$db_path" 2>/dev/null | cut -f1)) — migrating only"
	else
		DB_WAS_FRESH="y"
		info "No database at ${db_path} — creating the schema"
	fi

	cd "$SRC_DIR"
	# Pin migrate to the exact resolved path so it can't drift to a stray location.
	info "Applying schema (pnpm db:migrate)…"
	if MU_DATABASE_SQLITE_PATH="$db_path" pnpm db:migrate >/tmp/mu-migrate.log 2>&1; then
		grep -iE "migrat|tables:|created|stray" /tmp/mu-migrate.log | tail -8 | sed 's/^/      /'
	else
		warn "migrate failed:"; tail -8 /tmp/mu-migrate.log | sed 's/^/      /'
		die "Database migration failed — fix the above and re-run."
	fi

	if [ "$DB_WAS_FRESH" = "y" ]; then
		log "Schema created — create your admin on first visit via the Setup page"
	else
		log "Existing database migrated (your data + admin preserved)"
	fi
}

# ── NVENC smoke test ─────────────────────────────────────────────────────────
nvenc_smoke_test() {
	[ "$HAS_NVIDIA_GPU" = "y" ] || return
	step "NVENC smoke test"
	if [ "$NVIDIA_NEEDS_REBOOT" = "y" ]; then
		warn "Driver just installed — reboot first, then test: ffmpeg -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 -c:v h264_nvenc -f null -"
		return
	fi
	if ! have nvidia-smi || ! nvidia-smi &>/dev/null; then
		warn "nvidia-smi not working yet — NVENC unavailable until the driver loads (reboot?)"
		return
	fi
	if [ "$GROUPS_CHANGED" = "y" ]; then
		warn "Group membership (video/render) not active in this shell yet — re-login then test NVENC."
		return
	fi
	info "Encoding a test pattern with h264_nvenc…"
	if ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=duration=1:size=640x360:rate=30 \
		-c:v h264_nvenc -f null - 2>/tmp/mu-nvenc-test.log; then
		log "NVENC works ✔"
	else
		warn "NVENC test failed. Output:"; sed 's/^/      /' /tmp/mu-nvenc-test.log | tail -6
		warn "If nvidia-smi works but this fails with 'No capable devices', the user lacks video/render groups."
	fi
}

# ── Firewall ─────────────────────────────────────────────────────────────────
configure_firewall() {
	local port="${PORT_OPT:-${MU_SERVER_PORT:-4000}}"
	have firewall-cmd || { info "firewalld not present — skipping firewall"; return; }
	$SUDO firewall-cmd --state &>/dev/null || { info "firewalld not running — skipping"; return; }
	if $SUDO firewall-cmd --query-port="${port}/tcp" &>/dev/null; then
		log "Firewall already allows ${port}/tcp"
		return
	fi
	confirm "Open port ${port}/tcp in the firewall for external access?" n || return
	step "Firewall"
	$SUDO firewall-cmd --permanent --add-port="${port}/tcp" && $SUDO firewall-cmd --reload \
		&& log "Opened ${port}/tcp" || warn "Failed to open firewall port"
}

# ── systemd service ──────────────────────────────────────────────────────────
install_service() {
	[ "$INSTALL_SERVICE" = "y" ] || return
	step "systemd service (mu.service)"
	have systemctl || { warn "systemctl not found — skipping service"; return; }
	local node_bin; node_bin="$(command -v node)"
	local port="${PORT_OPT:-${MU_SERVER_PORT:-4000}}"
	local run_group; run_group="$(id -gn "$RUN_USER" 2>/dev/null || echo "$RUN_USER")"

	$SUDO mkdir -p /etc/mu
	$SUDO tee /etc/mu/mu.env >/dev/null <<ENVF
NODE_ENV=production
MU_DATA_DIR=${DATA_DIR}
MU_SERVER_PORT=${port}
ENVF

	$SUDO tee /etc/systemd/system/mu.service >/dev/null <<UNIT
[Unit]
Description=Mu / CineHost movie streaming server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${run_group}
# GPU access for headless NVENC/NVDEC (/dev/nvidia*, /dev/dri/renderD*).
SupplementaryGroups=video render
WorkingDirectory=${SRC_DIR}/packages/server
EnvironmentFile=/etc/mu/mu.env
ExecStart=${node_bin} ${SRC_DIR}/packages/server/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mu

[Install]
WantedBy=multi-user.target
UNIT

	$SUDO systemctl daemon-reload
	$SUDO systemctl enable mu
	if [ "$NVIDIA_NEEDS_REBOOT" = "y" ] || [ "$GROUPS_CHANGED" = "y" ]; then
		warn "Service enabled but NOT started — reboot first (driver/groups pending), then: sudo systemctl start mu"
	else
		$SUDO systemctl restart mu && log "mu.service installed + started" || warn "Service failed to start — check: journalctl -u mu -e"
	fi
}

# ── Summary ──────────────────────────────────────────────────────────────────
finish() {
	local port="${PORT_OPT:-${MU_SERVER_PORT:-4000}}"
	step "Done"
	if [ "$INSTALL_SERVICE" != "y" ]; then
		echo -e "  Start it:   ${CYAN}cd ${SRC_DIR} && NODE_ENV=production MU_DATA_DIR=${DATA_DIR} node packages/server/dist/main.js${NC}"
		echo -e "  Or service: ${CYAN}re-run with --service${NC}"
	else
		echo -e "  Status:     ${CYAN}systemctl status mu${NC}    Logs: ${CYAN}journalctl -u mu -f${NC}"
	fi
	echo -e "  Open:       ${CYAN}http://localhost:${port}${NC}"
	echo ""
	[ "$DB_WAS_FRESH" = "y" ] && info "Fresh database — the first visit shows the Setup page to create your admin account."
	[ "$NVIDIA_NEEDS_REBOOT" = "y" ] && warn "REBOOT required: NVIDIA driver was installed."
	[ "$GROUPS_CHANGED" = "y" ]      && warn "Re-login or reboot: ${RUN_USER} was added to video/render."
	info "If you copied a DB from the old (Windows) box, clear the stale hardware-accel flag once it's"
	info "running: Settings → Encoding → Reset HW accel / clear cache (so NVENC isn't left disabled)."
	info "Set your media folders under media.libraryPaths in ${DATA_DIR}/config/config.yml (or Settings → Library)."
}

main() {
	echo -e "${BOLD}${MAGENTA}Mu / CineHost — Fedora setup${NC}"
	preflight
	detect_gpu
	[ "$HAS_NVIDIA_GPU" = "y" ] && info "NVIDIA GPU detected" || info "No NVIDIA GPU detected (software encoding only)"
	install_system_deps
	install_node
	install_pnpm
	install_ffmpeg
	install_nvidia
	ensure_gpu_groups
	setup_env
	ensure_config
	build_app
	init_database
	nvenc_smoke_test
	configure_firewall
	install_service
	finish
}

main "$@"

#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Mu — nginx reverse-proxy setup
#
# Creates an nginx site that fronts the Mu server (or any single-port app) on a
# domain, optionally obtaining a Let's Encrypt certificate. Serves the built
# client's immutable /assets/ straight from disk for speed and proxies
# everything else (SPA shell + SSR, REST API, WebSockets, HLS/streaming) to the
# app port.
#
# Usage:
#   bash scripts/nginx-setup.sh [options]      (or: pnpm nginx:setup -- [options])
#
# Options (any omitted value is prompted for, unless --yes):
#   --domain <fqdn>        Full domain, e.g. mu.example.com
#   --port <n>             App port to proxy to            (default: 4000)
#   --client-dir <path>    Built web client dir            (default: auto-detect)
#   --letsencrypt          Obtain + install a Let's Encrypt cert (HTTPS + redirect)
#   --email <addr>         Email for Let's Encrypt registration/expiry notices
#   --no-static            Pure reverse proxy (don't serve /assets/ from disk)
#   --yes, -y              Non-interactive; use defaults for anything not passed
#   --help, -h             Show this help
#
# Platform support: Fedora/RHEL (primary), Debian/Ubuntu, macOS (Homebrew),
# Windows (best-effort: prints the config + manual steps).
# ──────────────────────────────────────────────────────────────────────────────

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
log()  { echo -e "  ${GREEN}[+]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()  { echo -e "  ${RED}[x]${NC} $1"; }
info() { echo -e "  ${CYAN}[i]${NC} $1"; }
step() { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()  { err "$1"; exit 1; }

# Run a command as root when we aren't already.
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
run() { $SUDO "$@"; }

# ── Defaults / paths ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_CLIENT_DIR="$SRC_DIR/packages/client/dist"
ACME_WEBROOT="/var/www/certbot"   # ACME HTTP-01 challenge files (served by nginx, not proxied)

DOMAIN=""; PORT="4000"; CLIENT_DIR=""; LETSENCRYPT=false; EMAIL=""; SERVE_STATIC=true; ASSUME_YES=false

usage() { awk 'NR>=4 && /^#/{sub(/^# ?/,"");print;next} NR>=4{exit}' "${BASH_SOURCE[0]}"; exit 0; }

# ── Parse args ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN="$2"; shift 2 ;;
        --domain=*) DOMAIN="${1#*=}"; shift ;;
        --port) PORT="$2"; shift 2 ;;
        --port=*) PORT="${1#*=}"; shift ;;
        --client-dir) CLIENT_DIR="$2"; shift 2 ;;
        --client-dir=*) CLIENT_DIR="${1#*=}"; shift ;;
        --email) EMAIL="$2"; shift 2 ;;
        --email=*) EMAIL="${1#*=}"; shift ;;
        --letsencrypt|--le) LETSENCRYPT=true; shift ;;
        --no-static) SERVE_STATIC=false; shift ;;
        --yes|-y) ASSUME_YES=true; shift ;;
        --help|-h) usage ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

ask() { # ask <var> <prompt> <default>
    local _v="$1" _p="$2" _d="${3:-}" _ans
    if $ASSUME_YES; then printf -v "$_v" '%s' "$_d"; return; fi
    if [ -n "$_d" ]; then read -r -p "  $_p [$_d]: " _ans; else read -r -p "  $_p: " _ans; fi
    printf -v "$_v" '%s' "${_ans:-$_d}"
}
ask_yn() { # ask_yn <prompt> <default y|n>  -> returns 0 for yes
    local _p="$1" _d="${2:-n}" _ans
    if $ASSUME_YES; then [ "$_d" = "y" ]; return; fi
    read -r -p "  $_p [$([ "$_d" = y ] && echo 'Y/n' || echo 'y/N')]: " _ans
    _ans="${_ans:-$_d}"; [ "${_ans,,}" = "y" ]
}

# ── Platform detection ────────────────────────────────────────────────────────
detect_platform() {
    case "$(uname -s)" in
        Linux*)
            PLATFORM="linux"; DISTRO="unknown"
            if [ -r /etc/os-release ]; then . /etc/os-release; DISTRO="${ID:-unknown}"; DISTRO_LIKE="${ID_LIKE:-}"; fi
            ;;
        Darwin*) PLATFORM="macos" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *) die "Unsupported OS: $(uname -s)" ;;
    esac
}

pkg_install() { # pkg_install <pkg...>
    case "$PLATFORM:$DISTRO" in
        linux:fedora|linux:rhel|linux:centos|linux:rocky|linux:almalinux)
            run dnf install -y "$@" ;;
        linux:*)
            if [[ "${DISTRO_LIKE:-}" == *debian* ]] || [ "$DISTRO" = debian ] || [ "$DISTRO" = ubuntu ]; then
                run apt-get update -y && run apt-get install -y "$@"
            elif [[ "${DISTRO_LIKE:-}" == *fedora* || "${DISTRO_LIKE:-}" == *rhel* ]]; then
                run dnf install -y "$@"
            elif command -v pacman >/dev/null 2>&1; then run pacman -Sy --noconfirm "$@"
            elif command -v zypper >/dev/null 2>&1; then run zypper install -y "$@"
            else die "Unknown Linux package manager — install manually: $*"; fi ;;
        macos:*) brew install "$@" ;;
        *) die "Cannot auto-install on this platform: $*" ;;
    esac
}

# ── Resolve inputs ────────────────────────────────────────────────────────────
detect_platform
echo -e "\n${BOLD}  Mu — nginx setup${NC}"
info "Platform: $PLATFORM${DISTRO:+ ($DISTRO)}"

[ -n "$DOMAIN" ] || ask DOMAIN "Full domain (e.g. mu.example.com)"
[ -n "$DOMAIN" ] || die "A domain is required."
[ -n "$PORT" ] || ask PORT "App port to proxy to" "4000"

if $SERVE_STATIC && [ -z "$CLIENT_DIR" ]; then
    local_default=""; [ -d "$DEFAULT_CLIENT_DIR" ] && local_default="$DEFAULT_CLIENT_DIR"
    ask CLIENT_DIR "Built web client dir (blank = pure proxy)" "$local_default"
fi
if [ -n "$CLIENT_DIR" ]; then
    [ -d "$CLIENT_DIR" ] || { warn "Client dir '$CLIENT_DIR' not found — falling back to pure proxy."; CLIENT_DIR=""; }
fi
[ -n "$CLIENT_DIR" ] || SERVE_STATIC=false

if ! $LETSENCRYPT && ask_yn "Obtain a Let's Encrypt HTTPS certificate now?" "n"; then LETSENCRYPT=true; fi
if $LETSENCRYPT && [ -z "$EMAIL" ]; then ask EMAIL "Email for Let's Encrypt (expiry notices)"; fi

info "Domain:     $DOMAIN"
info "Proxy to:   http://127.0.0.1:$PORT"
info "Client dir: ${CLIENT_DIR:-<none — pure proxy>}"
info "HTTPS (LE): $($LETSENCRYPT && echo "yes ($EMAIL)" || echo "no")"

if $ASSUME_YES; then :; elif ! ask_yn "Proceed?" "y"; then info "Cancelled."; exit 0; fi

# ── nginx config location per platform ────────────────────────────────────────
nginx_paths() {
    if [ "$PLATFORM" = "macos" ]; then
        NGINX_PREFIX="$(brew --prefix 2>/dev/null)/etc/nginx"
        SITE_DIR="$NGINX_PREFIX/servers"; WS_MAP="$NGINX_PREFIX/servers/00-mu-websocket.conf"
    else
        SITE_DIR="/etc/nginx/conf.d"; WS_MAP="/etc/nginx/conf.d/00-mu-websocket.conf"
    fi
    SITE_CONF="$SITE_DIR/$DOMAIN.conf"
}

# Emit the proxy directives shared by the location blocks.
emit_proxy() {
    cat <<PROXY
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_buffering off;
        # Stream large uploads (direct movie uploads) straight to the app
        # instead of buffering the whole body to disk first.
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
PROXY
}

write_config_to() { # write_config_to <path>  (to stdout-ish file; uses run tee for root paths)
    local target="$1" body
    body="$(cat <<HEADER
# Managed by Mu nginx-setup.sh — $DOMAIN
# WebSocket upgrade mapping (http context). Safe if this is the only definition.
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 0;    # unlimited — direct movie uploads (app caps at 50GB)

    # ACME (Let's Encrypt) HTTP-01 challenge — served from disk so it is NOT
    # proxied to the app. Kept permanently so 'certbot renew' keeps working.
    location ^~ /.well-known/acme-challenge/ {
        root $ACME_WEBROOT;
        default_type "text/plain";
        try_files \$uri =404;
    }

HEADER
)"
    if $SERVE_STATIC; then
        body+="$(cat <<STATIC

    # Immutable, content-hashed client assets — serve straight from disk.
    location /assets/ {
        alias $CLIENT_DIR/assets/;
        access_log off;
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri @app;
    }

    # Everything else → the app (SPA shell + SSR, REST API, WebSockets, streaming).
    location / {
$(emit_proxy)
    }
    location @app {
$(emit_proxy)
    }
}
STATIC
)"
    else
        body+="$(cat <<PROXYONLY

    location / {
$(emit_proxy)
    }
}
PROXYONLY
)"
    fi
    printf '%s\n' "$body" | run tee "$target" >/dev/null
}

# ── Install nginx ─────────────────────────────────────────────────────────────
ensure_nginx() {
    if command -v nginx >/dev/null 2>&1; then log "nginx present: $(nginx -v 2>&1 | sed 's#.*/##')"; return; fi
    step "Installing nginx"
    pkg_install nginx
    command -v nginx >/dev/null 2>&1 || die "nginx install failed."
    log "nginx installed."
}

nginx_reload() {
    run nginx -t || die "nginx config test failed — see output above. Not reloading."
    if [ "$PLATFORM" = "macos" ]; then run brew services restart nginx 2>/dev/null || run nginx -s reload;
    else run systemctl reload nginx 2>/dev/null || run systemctl restart nginx; fi
    log "nginx reloaded."
}

nginx_enable_start() {
    if [ "$PLATFORM" = "macos" ]; then run brew services start nginx >/dev/null 2>&1 || true
    else run systemctl enable --now nginx >/dev/null 2>&1 || true; fi
}

# ── Firewall ──────────────────────────────────────────────────────────────────
open_firewall() {
    if command -v firewall-cmd >/dev/null 2>&1 && run firewall-cmd --state >/dev/null 2>&1; then
        run firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
        run firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
        run firewall-cmd --reload >/dev/null 2>&1 || true
        log "firewalld: opened http + https."
    elif command -v ufw >/dev/null 2>&1; then
        run ufw allow 'Nginx Full' >/dev/null 2>&1 || true
        log "ufw: allowed Nginx Full (80/443)."
    else
        info "No firewalld/ufw detected — ensure ports 80 & 443 are open."
    fi
}

# ── Let's Encrypt ─────────────────────────────────────────────────────────────
ensure_certbot() {
    command -v certbot >/dev/null 2>&1 && { log "certbot present."; return; }
    step "Installing certbot (+ nginx plugin)"
    case "$PLATFORM:$DISTRO" in
        macos:*) pkg_install certbot ;;
        linux:fedora|linux:rhel|linux:centos|linux:rocky|linux:almalinux) pkg_install certbot python3-certbot-nginx ;;
        linux:*)
            if [[ "${DISTRO_LIKE:-}" == *debian* ]] || [ "$DISTRO" = debian ] || [ "$DISTRO" = ubuntu ]; then
                pkg_install certbot python3-certbot-nginx
            else pkg_install certbot python3-certbot-nginx; fi ;;
    esac
    command -v certbot >/dev/null 2>&1 || die "certbot install failed."
}

obtain_cert() {
    ensure_certbot
    step "Obtaining Let's Encrypt certificate for $DOMAIN"
    # Serve the challenge from a real webroot (the nginx ^~ acme location above),
    # NOT certbot's --nginx authenticator — our catch-all proxy would otherwise
    # forward the challenge to the app and the validation returns app HTML.
    run mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
    if command -v restorecon >/dev/null 2>&1; then run restorecon -R "$ACME_WEBROOT" 2>/dev/null || true; fi
    local email_args=(--register-unsafely-without-email)
    [ -n "$EMAIL" ] && email_args=(-m "$EMAIL")
    # webroot authenticator (reliable) + nginx installer (adds 443 block + redirect).
    if run certbot run --authenticator webroot --webroot-path "$ACME_WEBROOT" --installer nginx \
            -d "$DOMAIN" --redirect --agree-tos --non-interactive --keep-until-expiring "${email_args[@]}"; then
        log "Certificate installed; certbot added HTTPS + HTTP→HTTPS redirect to the site."
        info "Auto-renewal: certbot's systemd timer (renews via the webroot above)."
    else
        warn "certbot failed — the HTTP (port 80) site is still serving."
        warn "Check: DNS for $DOMAIN → this host's public IP, and ports 80/443 forwarded here."
        warn "Then re-run:  sudo certbot run --authenticator webroot --webroot-path $ACME_WEBROOT \\"
        warn "                --installer nginx -d $DOMAIN --redirect -m ${EMAIL:-you@example.com}"
        return 1
    fi
}

# ── SELinux + static-serving capability ──────────────────────────────────────
as_nginx() { # run a command as the nginx worker user
    if [ "$(id -u)" -eq 0 ]; then runuser -u "$NGINX_USER" -- "$@"; else sudo -u "$NGINX_USER" "$@"; fi
}

detect_nginx_user() {
    NGINX_USER="$(awk '$1=="user"{gsub(/;/,"",$2);print $2;exit}' /etc/nginx/nginx.conf 2>/dev/null || true)"
    [ -n "$NGINX_USER" ] || NGINX_USER="nginx"
}

# On SELinux (Fedora/RHEL), nginx (httpd_t) cannot make outbound network
# connections — including to a localhost backend — unless this boolean is on.
# Without it every proxied request 502s.
selinux_setup() {
    command -v getenforce >/dev/null 2>&1 || return 0
    [ "$(getenforce 2>/dev/null)" = "Enforcing" ] || return 0
    command -v setsebool >/dev/null 2>&1 || return 0
    if [ "$(getsebool httpd_can_network_connect 2>/dev/null | awk '{print $3}')" != "on" ]; then
        info "SELinux: enabling httpd_can_network_connect (required for reverse proxy)..."
        run setsebool -P httpd_can_network_connect 1 || warn "Could not set SELinux boolean — proxy may 502."
    fi
}

# True only if the nginx worker user can actually traverse + read the client dir.
# (A dir under a 0700 home, or labeled user_home_t under SELinux, fails here —
# in which case we serve nothing statically and let the app serve its own files.)
nginx_can_serve_static() {
    as_nginx test -x "$CLIENT_DIR" 2>/dev/null && as_nginx test -r "$CLIENT_DIR/index.html" 2>/dev/null
}

# ── Windows: best-effort (emit config + instructions) ─────────────────────────
if [ "$PLATFORM" = "windows" ]; then
    step "Windows detected — emitting config + manual steps"
    OUT="$SRC_DIR/nginx-$DOMAIN.conf"
    SUDO="" write_config_to "$OUT"
    warn "Automated install isn't supported on Windows. Steps:"
    echo "    1. Install nginx (https://nginx.org/en/download.html) and certbot/win-acme."
    echo "    2. Copy $OUT into your nginx 'conf/' and 'include' it from the http{} block of nginx.conf."
    echo "    3. Ensure the websocket map (top of that file) is present once in http{}."
    echo "    4. Reload nginx (nginx -s reload). For TLS, use win-acme to issue a cert for $DOMAIN."
    exit 0
fi

# ── Run ───────────────────────────────────────────────────────────────────────
nginx_paths
ensure_nginx
nginx_enable_start
detect_nginx_user
selinux_setup

# If we mean to serve static assets but nginx can't read the dir (home perms /
# SELinux), fall back to a pure proxy — the app serves its own static files.
if $SERVE_STATIC; then
    if nginx_can_serve_static; then
        log "nginx ('$NGINX_USER') can read $CLIENT_DIR — serving /assets/ from disk."
    else
        warn "nginx user '$NGINX_USER' can't read $CLIENT_DIR (home-dir perms / SELinux)."
        warn "Falling back to pure reverse proxy; the app serves its own static files."
        SERVE_STATIC=false
    fi
fi

step "Writing site config: $SITE_CONF"
# Keep the websocket map in the site file itself, but only one map may define
# $connection_upgrade across the whole http{} block — drop a separate stub if
# another config already defines it, and strip the map from our file in that case.
if grep -rqs 'connection_upgrade' "$(dirname "$SITE_DIR")" 2>/dev/null && ! grep -qs 'Managed by Mu' "$SITE_CONF" 2>/dev/null; then
    info "An existing \$connection_upgrade map was found — reusing it (won't redefine)."
    EXISTING_WS_MAP=true
else
    EXISTING_WS_MAP=false
fi
write_config_to "$SITE_CONF"
if $EXISTING_WS_MAP; then
    # Remove our duplicate map block to avoid 'duplicate map' nginx error.
    run sed -i '/^map \$http_upgrade \$connection_upgrade {/,/^}/d' "$SITE_CONF"
fi
log "Wrote $SITE_CONF"

nginx_reload
open_firewall

if $LETSENCRYPT; then obtain_cert || true; fi

# ── Summary ───────────────────────────────────────────────────────────────────
step "Done"
SCHEME="http"; $LETSENCRYPT && command -v certbot >/dev/null 2>&1 && [ -d "/etc/letsencrypt/live/$DOMAIN" ] && SCHEME="https"
log "Site:    $SCHEME://$DOMAIN  →  http://127.0.0.1:$PORT"
if $SERVE_STATIC; then info "Static:  $CLIENT_DIR/assets/ served from disk";
else info "Static:  served by the app (pure reverse proxy)"; fi
info "Config:  $SITE_CONF"
info "Test:    curl -I $SCHEME://$DOMAIN/"
echo ""

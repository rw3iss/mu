#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Mu — coTURN (WebRTC voice for Shared Sessions) setup
#
# Installs + configures coTURN as the STUN/TURN server for watch-party voice.
# Idempotent. Fedora-first (dnf); falls back to apt on Debian/Ubuntu.
#
# The prod box routes ALL outbound through a Mullvad WireGuard full-tunnel
# (kill-switch). TURN must BYPASS the tunnel so (a) peers reach it on the box's
# real public IP and (b) its relayed replies don't get shoved out the VPN exit
# (wrong source IP → dropped). This mirrors the app's inbound path: we mark the
# TURN listener + relay flows with iptables CONNMARK so their replies skip the
# tunnel and return via the LAN gateway (the same mechanism already used for
# the app's 80/443/4000). See the "VPN bypass" step below.
#
# Usage:
#   bash scripts/coturn-setup.sh --secret <shared-secret> [options]
#     (or: pnpm coturn:setup -- --secret <secret> [options])
#
# Options:
#   --secret <s>        coTURN static-auth-secret (REQUIRED; also MU_TURN_SECRET).
#                       Must match `turn.secret` in data/config/config.yml.
#   --public-host <h>   Public host/IP peers reach TURN at (also `external-ip`).
#                       Default: auto-detected public IP (via api).
#   --listening-ip <ip> LAN IP coTURN binds to. Default: primary LAN IP.
#   --realm <r>         TURN realm. Default: --public-host.
#   --relay-range <a-b> UDP relay port range. Default: 49160-49200.
#   --cert <path>       TLS cert (fullchain) for turns:5349. Default: auto
#                       (Let's Encrypt live cert for --public-host if present).
#   --key <path>        TLS private key. Default: auto (LE live key).
#   --no-vpn-bypass     Skip the iptables CONNMARK bypass rules.
#   --yes, -y           Non-interactive.
#   --help, -h          Show this help.
#
# After running: forward on your router to this box —
#   3478/udp, 3478/tcp, 5349/tcp, and the relay UDP range (49160-49200/udp).
# Then enable TURN in config.yml:
#   turn: { enabled: true, publicHost: <host>, secret: <secret>, realm: <host> }
# ──────────────────────────────────────────────────────────────────────────────

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; NC='\033[0m'
log()  { echo -e "  ${GREEN}[+]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $1"; }
err()  { echo -e "  ${RED}[x]${NC} $1"; }
info() { echo -e "  ${CYAN}[i]${NC} $1"; }
step() { echo -e "\n${BOLD}${MAGENTA}$1${NC}"; }
die()  { err "$1"; exit 1; }

SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
run() { $SUDO "$@"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── Defaults ──────────────────────────────────────────────────────────────────
SECRET="${MU_TURN_SECRET:-}"
PUBLIC_HOST=""
LISTENING_IP=""
REALM=""
RELAY_RANGE="49160-49200"
CERT_PATH=""
KEY_PATH=""
VPN_BYPASS=true
ASSUME_YES=false

CONF="/etc/coturn/turnserver.conf"

usage() { awk 'NR>=4 && /^#/{sub(/^# ?/,"");print;next} NR>=4{exit}' "${BASH_SOURCE[0]}"; exit 0; }

# ── Parse args ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --secret) SECRET="$2"; shift 2 ;;
        --secret=*) SECRET="${1#*=}"; shift ;;
        --public-host) PUBLIC_HOST="$2"; shift 2 ;;
        --public-host=*) PUBLIC_HOST="${1#*=}"; shift ;;
        --listening-ip) LISTENING_IP="$2"; shift 2 ;;
        --listening-ip=*) LISTENING_IP="${1#*=}"; shift ;;
        --realm) REALM="$2"; shift 2 ;;
        --realm=*) REALM="${1#*=}"; shift ;;
        --relay-range) RELAY_RANGE="$2"; shift 2 ;;
        --relay-range=*) RELAY_RANGE="${1#*=}"; shift ;;
        --cert) CERT_PATH="$2"; shift 2 ;;
        --cert=*) CERT_PATH="${1#*=}"; shift ;;
        --key) KEY_PATH="$2"; shift 2 ;;
        --key=*) KEY_PATH="${1#*=}"; shift ;;
        --no-vpn-bypass) VPN_BYPASS=false; shift ;;
        --yes|-y) ASSUME_YES=true; shift ;;
        --help|-h) usage ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

RELAY_MIN="${RELAY_RANGE%%-*}"
RELAY_MAX="${RELAY_RANGE##*-}"
[ -n "$SECRET" ] || die "A --secret is required (must match turn.secret in config.yml)."
[[ "$RELAY_MIN" =~ ^[0-9]+$ && "$RELAY_MAX" =~ ^[0-9]+$ ]] || die "Bad --relay-range (want a-b)."

# ── Detect IPs ────────────────────────────────────────────────────────────────
step "Detecting network"
if [ -z "$LISTENING_IP" ]; then
    LISTENING_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
fi
[ -n "$LISTENING_IP" ] || warn "Could not auto-detect LAN IP — set --listening-ip."
if [ -z "$PUBLIC_HOST" ]; then
    PUBLIC_HOST="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
fi
[ -n "$PUBLIC_HOST" ] || die "Could not auto-detect public IP — pass --public-host."
[ -n "$REALM" ] || REALM="$PUBLIC_HOST"
info "Listening IP : ${LISTENING_IP:-<unset>}"
info "Public host  : $PUBLIC_HOST"
info "Realm        : $REALM"
info "Relay range  : ${RELAY_MIN}-${RELAY_MAX}/udp"

# ── TLS cert (optional — reuse Let's Encrypt if present) ──────────────────────
if [ -z "$CERT_PATH" ] && [ -d "/etc/letsencrypt/live/$PUBLIC_HOST" ]; then
    CERT_PATH="/etc/letsencrypt/live/$PUBLIC_HOST/fullchain.pem"
    KEY_PATH="/etc/letsencrypt/live/$PUBLIC_HOST/privkey.pem"
fi
if [ -n "$CERT_PATH" ] && [ ! -f "$CERT_PATH" ]; then
    warn "Cert $CERT_PATH not found — disabling TURNS/TLS (5349)."
    CERT_PATH=""; KEY_PATH=""
fi

# ── Install coturn ────────────────────────────────────────────────────────────
step "Installing coturn"
if have coturn || have turnserver; then
    log "coturn already installed"
elif have dnf; then
    run dnf install -y coturn || die "coturn install failed (dnf)"
elif have apt-get; then
    run apt-get update -y && run apt-get install -y coturn || die "coturn install failed (apt)"
else
    die "No supported package manager (dnf/apt). Install coturn manually."
fi

# ── Write config ──────────────────────────────────────────────────────────────
step "Writing $CONF"
run mkdir -p /etc/coturn
TLS_BLOCK=""
if [ -n "$CERT_PATH" ]; then
    TLS_BLOCK="tls-listening-port=5349
cert=$CERT_PATH
pkey=$KEY_PATH"
fi
TMP_CONF="$(mktemp)"
cat > "$TMP_CONF" <<EOF
# Managed by scripts/coturn-setup.sh — Mu Shared Sessions voice (WebRTC).
listening-port=3478
${LISTENING_IP:+listening-ip=$LISTENING_IP}
# Advertise the REAL public IP as the relay candidate (not the VPN exit).
external-ip=$PUBLIC_HOST
realm=$REALM

# Ephemeral HMAC credentials (coTURN use-auth-secret). The app mints
# username="<unixExpiry>:<userId>", credential=base64(HMAC-SHA1(secret,username)).
use-auth-secret
static-auth-secret=$SECRET

# Bounded UDP relay range — caps concurrent relays; must be router-forwarded.
min-port=$RELAY_MIN
max-port=$RELAY_MAX

$TLS_BLOCK

no-cli
no-tlsv1
no-tlsv1_1
# Don't relay to loopback/private/multicast from public peers.
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
fingerprint
EOF
run cp "$TMP_CONF" "$CONF"
rm -f "$TMP_CONF"
run chmod 600 "$CONF"
log "Wrote $CONF"

# Debian ships /etc/default/coturn with a TURNSERVER_ENABLED gate.
if [ -f /etc/default/coturn ]; then
    run sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn || true
fi

# ── Firewall ──────────────────────────────────────────────────────────────────
step "Firewall"
if have firewall-cmd && run firewall-cmd --state >/dev/null 2>&1; then
    run firewall-cmd --permanent --add-port=3478/udp >/dev/null 2>&1 || true
    run firewall-cmd --permanent --add-port=3478/tcp >/dev/null 2>&1 || true
    run firewall-cmd --permanent --add-port=5349/tcp >/dev/null 2>&1 || true
    run firewall-cmd --permanent --add-port=${RELAY_MIN}-${RELAY_MAX}/udp >/dev/null 2>&1 || true
    run firewall-cmd --reload >/dev/null 2>&1 || true
    log "Opened 3478 udp/tcp, 5349 tcp, ${RELAY_MIN}-${RELAY_MAX}/udp"
else
    warn "firewalld not active — open 3478/udp,3478/tcp,5349/tcp,${RELAY_MIN}-${RELAY_MAX}/udp yourself."
fi

# ── VPN bypass (Mullvad WireGuard full-tunnel) ────────────────────────────────
# Mark TURN listener + relay flows so conntrack replies skip the tunnel and go
# back out the LAN gateway — same connmark scheme the app's inbound path uses.
# CONNMARK 0x1 is the convention already applied to the app ports; reuse it so
# the existing dispatcher policy-routing rule (fwmark 0x1 → LAN table) applies.
if $VPN_BYPASS && have iptables; then
    step "VPN bypass (iptables CONNMARK)"
    add_rule() {
        # $1 = full iptables rule args (after -t mangle). Insert if absent.
        # shellcheck disable=SC2086
        run iptables -t mangle -C $1 2>/dev/null || run iptables -t mangle -A $1
    }
    for proto in udp tcp; do
        add_rule "PREROUTING -p $proto --dport 3478 -j CONNMARK --set-mark 0x1"
    done
    add_rule "PREROUTING -p tcp --dport 5349 -j CONNMARK --set-mark 0x1"
    add_rule "PREROUTING -p udp --dport ${RELAY_MIN}:${RELAY_MAX} -j CONNMARK --set-mark 0x1"
    # Restore the mark onto reply packets so policy routing sends them out the LAN.
    add_rule "OUTPUT -m connmark --mark 0x1 -j CONNMARK --restore-mark"
    log "Marked 3478/5349/${RELAY_MIN}-${RELAY_MAX} flows with connmark 0x1"
    warn "Persist these across reboot (iptables-save / your wg PostUp), like the app ports."
    info "If TURN still can't be reached from outside, verify the box's dispatcher"
    info "policy-routing table (fwmark 0x1 → LAN gateway) is present, as for 80/443/4000."
else
    $VPN_BYPASS && warn "iptables not found — skipping VPN bypass rules."
fi

# ── Enable + start ────────────────────────────────────────────────────────────
step "Service"
if have systemctl; then
    run systemctl enable coturn >/dev/null 2>&1 || true
    run systemctl restart coturn || die "coturn failed to start — check: journalctl -u coturn -e"
    log "coturn enabled + started"
else
    warn "systemctl not found — start coturn (turnserver -c $CONF) yourself."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
step "Done"
echo -e "  ${BOLD}Router port-forwarding to this box (${LISTENING_IP:-LAN IP}):${NC}"
echo -e "    ${CYAN}3478/udp, 3478/tcp, 5349/tcp, ${RELAY_MIN}-${RELAY_MAX}/udp${NC}"
echo
echo -e "  ${BOLD}Enable in data/config/config.yml:${NC}"
echo -e "    ${CYAN}turn:${NC}"
echo -e "    ${CYAN}  enabled: true${NC}"
echo -e "    ${CYAN}  publicHost: $PUBLIC_HOST${NC}"
echo -e "    ${CYAN}  secret: <same as --secret>${NC}"
echo -e "    ${CYAN}  realm: $REALM${NC}"
echo -e "    ${CYAN}  relayPortRange: ${RELAY_MIN}-${RELAY_MAX}${NC}"
echo
echo -e "  ${BOLD}Verify:${NC} ${CYAN}turnutils_uclient -v -u test -w test $PUBLIC_HOST${NC} (after config)"

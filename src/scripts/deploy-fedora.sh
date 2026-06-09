#!/usr/bin/env bash
# deploy-fedora.sh — low-downtime manual deploy to the Fedora prod box.
#
# The downtime in a Mu deploy is NOT the build — it's the restart. So this
# script BUILDS FIRST while the old server keeps serving, runs migrations, and
# only then does a single fast `systemctl --user restart mu-server`. Combined
# with the bounded force-exit shutdown in main.ts (old process dies within ~5s
# of SIGTERM instead of being SIGKILLed after ~90s), the visible gap is a few
# seconds instead of a minute and a half.
#
# This is the synchronous, on-demand counterpart to the auto-deploy watcher
# (scripts/auto-deploy-watch.sh): same build-first flow, but it runs NOW with
# live verification instead of waiting for the next poll. It pauses the watcher
# for the duration so the two can never deploy on top of each other.
#
# Usage (from anywhere in the repo):
#   bash src/scripts/deploy-fedora.sh            # push current branch → prod
#   bash src/scripts/deploy-fedora.sh --no-push  # assume HEAD already pushed
#
# Config (env vars or defaults):
#   MU_REMOTE_HOST=rw3iss@192.168.50.211
#   MU_REMOTE_PATH=/home/rw3iss/Sites/mu      (repo root on prod)
#   MU_DEPLOY_BRANCH=main
#   MU_PUBLIC_URL=https://mu.ryanweiss.net/   (external check; empty to skip)
set -euo pipefail

REMOTE_HOST="${MU_REMOTE_HOST:-rw3iss@192.168.50.211}"
REMOTE_PATH="${MU_REMOTE_PATH:-/home/rw3iss/Sites/mu}"
BRANCH="${MU_DEPLOY_BRANCH:-main}"
PUBLIC_URL="${MU_PUBLIC_URL:-https://mu.ryanweiss.net/}"

SKIP_PUSH=false
for arg in "$@"; do
	case "$arg" in
		--no-push) SKIP_PUSH=true ;;
		-h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown arg: $arg" >&2; exit 2 ;;
	esac
done

echo "=== Mu deploy (Fedora, low-downtime) ==="
echo "Remote:  $REMOTE_HOST"
echo "Path:    $REMOTE_PATH"
echo "Branch:  $BRANCH"
echo "Public:  ${PUBLIC_URL:-<skip>}"
echo ""

# ── 1. Push current branch ────────────────────────────────────────────────
if [ "$SKIP_PUSH" = false ]; then
	echo "--- pushing local HEAD → origin/$BRANCH ---"
	git push origin "HEAD:$BRANCH"
else
	echo "--- skipping push (--no-push) ---"
fi

# ── 2. Remote build-first deploy + fast restart ───────────────────────────
# The whole remote sequence is fed over stdin so it always runs the latest
# steps (no chicken-and-egg with a pulled script). BRANCH is exported in.
echo "--- remote deploy (build while old server serves) ---"
ssh "$REMOTE_HOST" "MU_REMOTE_PATH='$REMOTE_PATH' MU_DEPLOY_BRANCH='$BRANCH' bash -s" <<'REMOTE'
set -uo pipefail
export XDG_RUNTIME_DIR="/run/user/$(id -u 2>/dev/null || echo 1000)"
# The systemd user env has a minimal PATH; add the nvm toolchain so pnpm resolves.
for _b in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$_b" ] && PATH="$_b:$PATH"; done
for _e in "$HOME/.local/share/pnpm" /usr/local/bin; do [ -d "$_e" ] && PATH="$_e:$PATH"; done
export PATH

DIR="$MU_REMOTE_PATH"; BR="$MU_DEPLOY_BRANCH"
cd "$DIR" || { echo "FATAL: cd $DIR"; exit 1; }

# Pause the auto-deploy watcher so it can't fire mid-build (restored on exit).
WATCHER_WAS_ACTIVE=false
if systemctl --user is-active --quiet mu-autodeploy 2>/dev/null; then
	WATCHER_WAS_ACTIVE=true
	systemctl --user stop mu-autodeploy 2>/dev/null || true
fi
restore_watcher() { [ "$WATCHER_WAS_ACTIVE" = true ] && systemctl --user start mu-autodeploy 2>/dev/null || true; }
trap restore_watcher EXIT

git fetch origin "$BR" --quiet || { echo "FATAL: git fetch"; exit 1; }
git reset --hard "origin/$BR" --quiet || { echo "FATAL: git reset"; exit 1; }
SHA="$(git rev-parse --short HEAD)"
echo ">> building $SHA (old server still serving)…"

cd "$DIR/src" || { echo "FATAL: cd src"; exit 1; }
rm -rf packages/client/dist
pnpm install >/tmp/mu-deploy-install.log 2>&1 || { echo "FATAL: pnpm install (see /tmp/mu-deploy-install.log)"; exit 1; }
pnpm build >/tmp/mu-deploy-build.log 2>&1 || { echo "FATAL: pnpm build (see /tmp/mu-deploy-build.log)"; exit 1; }
# Turbo can FULL-TURBO a stale client dist; force a clean vite build.
( cd packages/client && rm -rf dist && pnpm exec vite build ) >>/tmp/mu-deploy-build.log 2>&1 \
	|| { echo "FATAL: vite build (see /tmp/mu-deploy-build.log)"; exit 1; }
[ -f packages/client/dist/index.html ] && [ -n "$(ls -A packages/client/dist/assets 2>/dev/null)" ] \
	|| { echo "FATAL: client dist incomplete"; exit 1; }
# Public assets (logo, favicon, …) must be copied from public/ into dist/. A
# partial Turbo cache restore can leave them out even when index.html/assets are
# present, which 404s the site logo. Guard on a known committed public file.
[ -f packages/client/dist/mu_logo_small.png ] \
	|| { echo "FATAL: client dist missing public assets (e.g. mu_logo_small.png)"; exit 1; }

pnpm db:migrate >/tmp/mu-deploy-migrate.log 2>&1 || echo "WARN: db:migrate non-zero (continuing)"

echo ">> restarting mu-server (fast)…"
RESTART_START=$(date +%s)
# The restart can be "canceled" if the auto-deploy watcher (paused above, but it
# may have already begun its own deploy from the same push) issues a competing
# restart. reset-failed + one retry makes the manual deploy self-heal instead of
# leaving the service down.
systemctl --user reset-failed mu-server 2>/dev/null || true
if ! systemctl --user restart mu-server 2>/dev/null; then
	echo ">> restart interrupted (autodeploy race?) — retrying once…"
	sleep 2
	systemctl --user reset-failed mu-server 2>/dev/null || true
	systemctl --user restart mu-server || { echo "FATAL: systemctl restart"; exit 1; }
fi

# Wait for the new process to bind + serve (200 SPA or 401 auth-gated both = up).
UP=false
for i in $(seq 1 40); do
	code="$(curl -sk -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/ 2>/dev/null || echo 000)"
	if [ "$code" = "200" ] || [ "$code" = "401" ]; then
		echo ">> UP: $SHA serving HTTP $code; restart gap ≈ $(( $(date +%s) - RESTART_START ))s"
		UP=true; break
	fi
	sleep 1
done
[ "$UP" = true ] || { echo "FATAL: server did not come up after restart"; journalctl --user -u mu-server -n 25 --no-pager 2>/dev/null; exit 1; }
REMOTE

REMOTE_RC=$?
if [ "$REMOTE_RC" -ne 0 ]; then
	echo "ERROR: remote deploy failed (rc=$REMOTE_RC) — prod left on the previous build." >&2
	exit "$REMOTE_RC"
fi

# ── 3. External verification ──────────────────────────────────────────────
if [ -n "$PUBLIC_URL" ]; then
	echo "--- external check: $PUBLIC_URL ---"
	code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL" 2>/dev/null || echo 000)"
	if [ "$code" = "200" ] || [ "$code" = "401" ]; then
		echo "OK: external $PUBLIC_URL → $code"
	else
		echo "WARN: external $PUBLIC_URL → $code (local prod was healthy; check nginx/DNS)." >&2
	fi
fi

echo "=== Deploy complete ==="

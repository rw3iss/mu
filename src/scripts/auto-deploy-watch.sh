#!/usr/bin/env bash
#
# auto-deploy-watch.sh — poll origin/main and auto-deploy on push.
#
# Linux (primary, this box): builds headlessly, then restarts the systemd USER
#   service `mu-server` (see scripts/service.sh). Runs as the `mu-autodeploy`
#   user service — install with `pnpm autodeploy install` (scripts/autodeploy.sh).
# Windows (legacy prod): restarts via the interactive "Mu Server" scheduled task
#   (Session 1, so NVENC reaches the GPU). Installed via register-auto-deploy-task.ps1.
#
# Loop: fetch origin/main; if HEAD differs AND the working tree is clean, deploy
# (reset → install → build → migrate) and restart. A DIRTY tree is skipped so an
# in-progress local checkout is never clobbered by `git reset --hard`. One
# sequential loop, so deploys never overlap.
#
# Env overrides: MU_DEPLOY_POLL_SECONDS (60), MU_DEPLOY_DIR, MU_SERVICE_NAME
#   (mu-server), MU_TASK_NAME (Windows: "Mu Server"), MU_HEALTH_URL.
set -u

# Survive console/hangup signals. On Windows, restarting the server propagates a
# CTRL_C/CTRL_BREAK to everything sharing the task console; on Linux a stray HUP
# (e.g. session teardown) would otherwise kill the watcher. A hard stop
# (systemctl stop / schtasks /end) is still uncatchable and works.
trap '' INT HUP

case "$(uname -s)" in
	Linux*)               PLATFORM=linux ;;
	Darwin*)              PLATFORM=macos ;;
	MINGW*|MSYS*|CYGWIN*) PLATFORM=windows ;;
	*)                    PLATFORM=linux ;;
esac

# Default DEPLOY_DIR = repo root derived from this script's path
# (<repo>/src/scripts/auto-deploy-watch.sh → <repo>); override with MU_DEPLOY_DIR.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
DEFAULT_DEPLOY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ "$PLATFORM" = windows ] && DEFAULT_DEPLOY_DIR="/c/Users/rw3is/Documents/Sites/other/mu"

DEPLOY_DIR="${MU_DEPLOY_DIR:-$DEFAULT_DEPLOY_DIR}"
SRC_DIR="$DEPLOY_DIR/src"
TASK="${MU_TASK_NAME:-Mu Server}"
SERVICE_NAME="${MU_SERVICE_NAME:-mu-server}"
INTERVAL="${MU_DEPLOY_POLL_SECONDS:-60}"
LOG="$DEPLOY_DIR/data/logs/auto-deploy.log"
if [ "$PLATFORM" = windows ]; then
	HEALTH_URL="${MU_HEALTH_URL:-https://localhost:4000/}"
else
	HEALTH_URL="${MU_HEALTH_URL:-http://127.0.0.1:4000/}"
fi

# `systemctl --user` needs XDG_RUNTIME_DIR in a non-login context.
[ -n "${XDG_RUNTIME_DIR:-}" ] || export XDG_RUNTIME_DIR="/run/user/$(id -u 2>/dev/null || echo 1000)"

# The systemd user service runs with a minimal PATH that lacks the nvm-managed
# toolchain, so `pnpm`/`corepack` aren't found and the build silently fails.
# Prepend every installed node bin dir (version-agnostic) so the build resolves.
for _nodebin in "$HOME"/.nvm/versions/node/*/bin; do
	[ -d "$_nodebin" ] && PATH="$_nodebin:$PATH"
done
# Common non-nvm install locations too (corepack/pnpm standalone).
for _extra in "$HOME/.local/share/pnpm" "/usr/local/bin"; do
	[ -d "$_extra" ] && PATH="$_extra:$PATH"
done
export PATH

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

restart_server() {
	if [ "$PLATFORM" = windows ]; then
		# Restart the interactive "Mu Server" task DETACHED (own hidden console) so
		# its console control events can't propagate back and kill this watcher.
		powershell -NoProfile -Command "Start-Process cmd -WindowStyle Hidden -ArgumentList '/c','schtasks /end /tn \"$TASK\" & timeout /t 2 /nobreak >NUL & schtasks /run /tn \"$TASK\"'" </dev/null >/dev/null 2>&1 || true
	else
		systemctl --user restart "$SERVICE_NAME" >>"$LOG" 2>&1 \
			|| log "WARN: 'systemctl --user restart $SERVICE_NAME' failed"
	fi
}

deploy() {
	local sha
	cd "$DEPLOY_DIR" || { log "ERROR: cd $DEPLOY_DIR failed"; return 1; }
	git reset --hard origin/main >>"$LOG" 2>&1 || { log "ERROR: git reset failed"; return 1; }
	sha="$(git rev-parse --short HEAD)"
	log "Deploying $sha…"

	cd "$SRC_DIR" || { log "ERROR: cd $SRC_DIR failed"; return 1; }
	rm -rf packages/client/dist
	if ! pnpm install >>"$LOG" 2>&1; then log "ERROR: pnpm install failed ($sha)"; return 1; fi
	if ! pnpm build >>"$LOG" 2>&1; then log "ERROR: pnpm build failed ($sha)"; return 1; fi

	# Turbo can report FULL TURBO and restore a stale client dist even after the
	# nuke above — force a cache-free vite build so the new client code ships.
	if ! ( cd packages/client && rm -rf dist && pnpm exec vite build >>"$LOG" 2>&1 ); then
		log "ERROR: vite build failed ($sha)"; return 1
	fi
	if [ ! -f packages/client/dist/index.html ] || [ -z "$(ls -A packages/client/dist/assets 2>/dev/null)" ]; then
		log "ERROR: client dist incomplete after build ($sha)"; return 1
	fi

	pnpm db:migrate >>"$LOG" 2>&1 || log "WARN: db:migrate non-zero ($sha) — continuing"

	# Old server keeps serving until here; only restart once the build is good so
	# a broken build never takes the running server down.
	restart_server
	sleep 10
	local code
	code="$(curl -sk -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
	# 200 (root SPA) or 401 (auth-gated) both mean the server is up and serving.
	if [ "$code" = "200" ] || [ "$code" = "401" ]; then
		log "OK: deployed $sha — local HTTP $code"
	else
		log "WARN: deployed $sha but local HTTP $code (check the server log)"
	fi
}

if [ "$PLATFORM" = windows ]; then
	PID_VAL="$(cat /proc/$$/winpid 2>/dev/null || echo "$$")"
else
	PID_VAL="$$"
fi
echo "$PID_VAL" >"$DEPLOY_DIR/data/auto-deploy.pid" 2>/dev/null || true

log "auto-deploy watcher started (platform=$PLATFORM dir=$DEPLOY_DIR svc='$SERVICE_NAME' poll=${INTERVAL}s)"
while true; do
	if git -C "$DEPLOY_DIR" fetch origin main >/dev/null 2>&1; then
		local_head="$(git -C "$DEPLOY_DIR" rev-parse HEAD 2>/dev/null)"
		remote_head="$(git -C "$DEPLOY_DIR" rev-parse origin/main 2>/dev/null)"
		if [ -n "$remote_head" ] && [ "$local_head" != "$remote_head" ]; then
			if [ -n "$(git -C "$DEPLOY_DIR" status --porcelain 2>/dev/null)" ]; then
				log "New commit ($local_head → $remote_head) but working tree is DIRTY — skipping deploy (won't clobber local changes)."
			else
				log "New commit on origin/main ($local_head → $remote_head)"
				deploy || log "Deploy failed; previous build left running, won't retry this commit until a new push"
			fi
		fi
	else
		log "WARN: git fetch failed (network/auth?) — retrying next poll"
	fi
	sleep "$INTERVAL"
done

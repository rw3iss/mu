#!/usr/bin/env bash
#
# auto-deploy-watch.sh — poll origin/main and auto-deploy on the WINDOWS prod box.
#
# Why this exists: prod runs in the interactive desktop session (Session 1) so
# NVENC can reach the GPU. A GitHub-hosted runner can't reach this LAN box, and a
# self-hosted runner installed as a service runs in Session 0 (no GPU). This
# watcher closes the gap: it builds headlessly, then restarts the server via the
# interactive "Mu Server" scheduled task — which executes in Session 1 even when
# triggered from a Session-0 / SSH context.
#
# Run it as a logon scheduled task (see register-auto-deploy-task.ps1). It loops:
# fetch origin/main; if HEAD differs, deploy (reset → install → build → migrate)
# and restart. One sequential loop, so deploys never overlap.
#
# Env overrides: MU_DEPLOY_POLL_SECONDS (default 60), MU_DEPLOY_DIR, MU_TASK_NAME.
set -u

DEPLOY_DIR="${MU_DEPLOY_DIR:-/c/Users/rw3is/Documents/Sites/other/mu}"
SRC_DIR="$DEPLOY_DIR/src"
TASK="${MU_TASK_NAME:-Mu Server}"
INTERVAL="${MU_DEPLOY_POLL_SECONDS:-60}"
LOG="$DEPLOY_DIR/data/logs/auto-deploy.log"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

restart_server() {
	# End the running task instance, kill any stray node holding the port, then
	# re-run the interactive task so the new process lands in Session 1 (GPU).
	# MSYS_NO_PATHCONV stops Git Bash mangling the /flags (e.g. /run -> R:/un).
	MSYS_NO_PATHCONV=1 schtasks /end /tn "$TASK" >/dev/null 2>&1 || true
	sleep 1
	powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1 || true
	sleep 2
	MSYS_NO_PATHCONV=1 schtasks /run /tn "$TASK" >/dev/null 2>&1
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

	# Old server keeps serving old code until here; only restart once the build
	# is known good, so a broken build never takes prod down.
	restart_server
	sleep 10
	local code
	code="$(curl -sk -o /dev/null -w '%{http_code}' https://localhost:4000/ 2>/dev/null || echo 000)"
	if [ "$code" = "200" ]; then
		log "OK: deployed $sha — local HTTP 200"
	else
		log "WARN: deployed $sha but local HTTP $code (check server.log)"
	fi
}

log "auto-deploy watcher started (dir=$DEPLOY_DIR task='$TASK' poll=${INTERVAL}s)"
while true; do
	if git -C "$DEPLOY_DIR" fetch origin main >/dev/null 2>&1; then
		local_head="$(git -C "$DEPLOY_DIR" rev-parse HEAD 2>/dev/null)"
		remote_head="$(git -C "$DEPLOY_DIR" rev-parse origin/main 2>/dev/null)"
		if [ -n "$remote_head" ] && [ "$local_head" != "$remote_head" ]; then
			log "New commit on origin/main ($local_head -> $remote_head)"
			deploy || log "Deploy failed; old server left running, will not retry this commit until a new push"
		fi
	else
		log "WARN: git fetch failed (network/auth?) — retrying next poll"
	fi
	sleep "$INTERVAL"
done

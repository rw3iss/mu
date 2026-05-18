#!/usr/bin/env bash
# deploy-remote.sh — push current branch + remote deploy + external verify.
#
# This is the ONE canonical command for deploying Mu from local to prod.
# Replaces the ad-hoc `echo 'bash deploy.sh' | ssh …` pattern that has
# bitten us when prod's git was on a detached HEAD (the shortcut would
# rebuild stale code without pulling).
#
# Usage (from anywhere in the repo):
#   bash src/scripts/deploy-remote.sh           # main → prod
#   bash src/scripts/deploy-remote.sh --no-push # skip git push (assume HEAD already pushed)
#
# What it does:
#  1. Pushes current branch to origin (unless --no-push).
#  2. SSHes to prod and runs src/deploy.sh (which now force-syncs git to
#     origin/main, rebuilds, restarts NSSM service, verifies HTTP 200
#     locally on prod with one retry).
#  3. After the remote deploy returns successfully, hits the public URL
#     and confirms it returns 200.
#  4. Exits non-zero if any step fails — never silently "succeed" with a
#     broken prod.
#
# Configuration (env vars or defaults):
#   MU_REMOTE_HOST=rw3iss@192.168.50.211
#   MU_REMOTE_PATH=/c/Users/rw3is/Documents/Sites/other/mu/src
#   MU_PUBLIC_URL=https://mu.ryanweiss.net:4000/

set -euo pipefail

REMOTE_HOST="${MU_REMOTE_HOST:-rw3iss@192.168.50.211}"
REMOTE_PATH="${MU_REMOTE_PATH:-/c/Users/rw3is/Documents/Sites/other/mu/src}"
PUBLIC_URL="${MU_PUBLIC_URL:-https://mu.ryanweiss.net:4000/}"

SKIP_PUSH=false
for arg in "$@"; do
    case "$arg" in
        --no-push) SKIP_PUSH=true ;;
        -h|--help)
            grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
    esac
done

# Locate repo root (this script lives at <root>/src/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse --short HEAD)"

echo "=== Mu remote deploy ==="
echo "Local:    branch=$CURRENT_BRANCH  HEAD=$HEAD_SHA"
echo "Remote:   $REMOTE_HOST"
echo "Path:     $REMOTE_PATH"
echo "Public:   $PUBLIC_URL"

# ── 1. Push ──
if $SKIP_PUSH; then
    echo "--- skipping git push (--no-push) ---"
else
    # Check for uncommitted changes — bail loudly rather than ship stale code.
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "ERROR: uncommitted changes in working tree. Commit or stash before deploying." >&2
        git status --short
        exit 1
    fi
    echo "--- git push origin $CURRENT_BRANCH ---"
    git push origin "$CURRENT_BRANCH"
fi

# ── 2. Remote deploy ──
# Pipe the command through stdin (no pty) — the prod machine is Windows
# Git Bash over SSH and that's the path that works reliably.
echo "--- remote deploy.sh ---"
REMOTE_CMD="cd '$REMOTE_PATH' && bash deploy.sh"
if ! echo "$REMOTE_CMD" | ssh "$REMOTE_HOST"; then
    echo "FATAL: remote deploy.sh exited non-zero." >&2
    exit 1
fi

# ── 3. External verify ──
echo "--- external verify: $PUBLIC_URL ---"
EXT_CODE=""
for i in 1 2 3 4 5 6 7 8 9 10; do
    EXT_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 8 "$PUBLIC_URL" 2>/dev/null || true)
    if [ "$EXT_CODE" = "200" ]; then
        echo "External: $PUBLIC_URL → 200 ✓"
        echo "=== Deploy complete ==="
        exit 0
    fi
    sleep 1
done

echo "FATAL: external probe returned '$EXT_CODE' (expected 200) after 10s of retries." >&2
exit 1

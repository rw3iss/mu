#!/usr/bin/env bash
# kill-orphans.sh — Kill any leftover mu-server / FFmpeg processes
# before nssm starts a fresh instance.
#
# Why this lives in its own file instead of inline in deploy.sh:
#   bash caches a running script's contents and continues reading from
#   the original inode even after `git pull` replaces the file on disk.
#   That means a fix to deploy.sh's kill logic can never apply to the
#   same deploy that introduced it — it only kicks in on the *next*
#   deploy. By invoking this helper as a fresh `bash scripts/kill-orphans.sh`
#   after pull, we bypass that cache and the just-pulled version runs.
#
# Safe to run unconditionally; it is a no-op on non-Windows hosts and
# when no matching processes exist.

set +e  # never let a failed kill abort the deploy

IS_WINDOWS=false
if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == mingw* ]] || [[ "$OSTYPE" == cygwin* ]] || [ -d "/c/Windows" ]; then
    IS_WINDOWS=true
fi

if ! $IS_WINDOWS; then
    # Unix: nothing to do here — systemd / launchd / pm2 own process
    # supervision and don't accumulate orphans the same way nssm does.
    exit 0
fi

# ── 1. FFmpeg orphans ──
# tasklist with no flags + grep avoids POSIX path conversion in Git Bash.
ffmpeg_pids=$(tasklist 2>/dev/null \
              | awk 'tolower($1) ~ /^ffmpeg(\.exe)?$/ { print $2 }' \
              | grep -E '^[0-9]+$' || true)
if [ -n "$ffmpeg_pids" ]; then
    for pid in $ffmpeg_pids; do
        taskkill //F //PID "$pid" 2>/dev/null || true
    done
    echo "Killed orphaned FFmpeg processes: $(echo $ffmpeg_pids | tr '\n' ' ')"
fi

# ── 2. Session-0 node.exe orphans ──
# nssm only tracks one PID; older node.exe instances from past restarts
# can survive in Session 0 and re-spawn the watcher, racing the new
# server on movie inserts. Kill them all so only the fresh `nssm start`
# survives. The user's interactive session is a different SessionId, so
# their dev / desktop node processes are untouched.
#
# IMPORTANT: do NOT pass `/FI` flags to tasklist from Git Bash — MSYS
# rewrites any argv starting with `/` into a Windows path
# (`/FI` → `C:/Program Files/Git/FI`) and tasklist errors out silently.
# Filter in awk instead.
node_pids=$(tasklist 2>/dev/null \
            | awk '/^node\.exe/ && $3 == "Services" && $4 == "0" { print $2 }' \
            | grep -E '^[0-9]+$' || true)
if [ -n "$node_pids" ]; then
    for pid in $node_pids; do
        taskkill //F //PID "$pid" 2>/dev/null || true
    done
    echo "Killed orphaned Session-0 node.exe processes: $(echo $node_pids | tr '\n' ' ')"
fi

exit 0

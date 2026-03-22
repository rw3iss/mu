#!/usr/bin/env bash
# fix-ffmpeg.sh — Kill orphaned FFmpeg processes, clear broken flags, and restart the server.
# Fixes Windows handle exhaustion (0xC0000142) by ensuring all FFmpeg handles are released
# before the server restarts.
#
# Usage: bash scripts/fix-ffmpeg.sh
#        pnpm fix:ffmpeg

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$SRC_DIR/.." && pwd)"

# Detect Windows
IS_WINDOWS=false
if [[ "$(uname -s)" == CYGWIN* ]] || [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]]; then
    IS_WINDOWS=true
fi

echo "=== FFmpeg Handle Cleanup ==="

# ── Step 1: Stop the server (releases all handles held by the Node process) ──
echo "--- Stopping server ---"
source "$SRC_DIR/stop.sh" || true

# ── Step 2: Kill ALL orphaned FFmpeg/FFprobe processes ──
echo "--- Killing orphaned FFmpeg processes ---"
killed_ffmpeg=0
if $IS_WINDOWS; then
    for name in ffmpeg ffprobe; do
        pids=$(tasklist 2>/dev/null | grep -i "$name" | awk '{print $2}' || true)
        if [ -n "$pids" ]; then
            for pid in $pids; do
                taskkill //F //PID "$pid" 2>/dev/null && killed_ffmpeg=$((killed_ffmpeg + 1)) || true
            done
        fi
    done
else
    for name in ffmpeg ffprobe; do
        pids=$(pgrep -f "$name" 2>/dev/null || true)
        if [ -n "$pids" ]; then
            for pid in $pids; do
                kill -9 "$pid" 2>/dev/null && killed_ffmpeg=$((killed_ffmpeg + 1)) || true
            done
        fi
    done
fi

if [ "$killed_ffmpeg" -gt 0 ]; then
    echo "Killed $killed_ffmpeg orphaned FFmpeg process(es)"
else
    echo "No orphaned FFmpeg processes found"
fi

# ── Step 3: Clear broken flags from the database ──
echo "--- Clearing broken flags ---"
cd "$SRC_DIR"
node scripts/settings.js delete hwAccelBroken 2>/dev/null || true
echo "hwAccelBroken flag cleared"

# ── Step 4: Wait for Windows to release handles ──
echo "--- Waiting for handle cleanup ---"
if $IS_WINDOWS; then
    # Windows needs time to fully release process handles after termination
    sleep 5
    echo "Handle cleanup wait complete (5s)"
else
    sleep 1
    echo "Handle cleanup wait complete (1s)"
fi

# ── Step 5: Verify FFmpeg works ──
echo "--- Verifying FFmpeg ---"
if ffmpeg -version >/dev/null 2>&1; then
    echo "FFmpeg OK: $(ffmpeg -version 2>&1 | head -1)"
else
    echo "WARNING: FFmpeg not found or broken!"
fi

# ── Step 6: Restart the server ──
echo "--- Restarting server ---"
bash "$SRC_DIR/restart.sh"

echo "=== FFmpeg fix complete ==="

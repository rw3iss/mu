#!/usr/bin/env bash
# logs-prod.sh — Tail the production server log via SSH.
# Usage: pnpm logs:prod [lines]
#   lines: number of lines to show initially (default 50)

REMOTE_HOST="rw3iss@192.168.50.211"
REMOTE_LOG="/c/Users/rw3is/Documents/Sites/other/mu/data/logs/server.log"
LINES="${1:-50}"

echo "=== Tailing production logs ($REMOTE_HOST) ==="
echo "    $REMOTE_LOG (last $LINES lines)"
echo "    Press Ctrl+C to stop"
echo ""

# Pipe the tail command via stdin (required for this SSH setup)
echo "tail -n $LINES -f $REMOTE_LOG" | ssh "$REMOTE_HOST"

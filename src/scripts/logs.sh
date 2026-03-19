#!/usr/bin/env bash
# logs.sh — Tail the local server log file.
# Usage: pnpm logs [lines]
#   lines: number of lines to show initially (default 50)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"

LINES="${1:-50}"

# Check common log locations
for log_path in \
    "$DATA_ROOT/data/logs/server.log" \
    "$PROJECT_ROOT/data/logs/server.log" \
    "$PROJECT_ROOT/packages/server/data/logs/server.log"; do
    if [ -f "$log_path" ]; then
        echo "=== Tailing $log_path (last $LINES lines) ==="
        tail -n "$LINES" -f "$log_path"
        exit 0
    fi
done

echo "No server.log found. Checked:"
echo "  $DATA_ROOT/data/logs/server.log"
echo "  $PROJECT_ROOT/data/logs/server.log"
echo "  $PROJECT_ROOT/packages/server/data/logs/server.log"
echo ""
echo "The server may not have been started yet, or logs are written to stdout in dev mode."
exit 1

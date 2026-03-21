#!/usr/bin/env bash
# deploy.sh — Universal deploy & restart script.
# Works on Linux, macOS, Windows (Git Bash / MSYS2), and WSL.
# Usage: ./deploy.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR"
SERVER_DIST="$SRC_DIR/packages/server/dist/main.js"
PID_FILE="$PROJECT_ROOT/data/mu-server.pid"

# Detect Windows (Git Bash / MSYS2)
IS_WINDOWS=false
if [[ "$OSTYPE" == msys* ]] || [[ "$OSTYPE" == mingw* ]] || [[ "$OSTYPE" == cygwin* ]] || [ -d "/c/Windows" ]; then
    IS_WINDOWS=true
fi

echo "=== Mu Deploy ==="
echo "Platform: $($IS_WINDOWS && echo 'Windows' || echo 'Unix')"

# ── 1. Pull latest code ──
cd "$PROJECT_ROOT"
echo "--- git pull ---"
git pull --ff-only || git pull

# ── 2. Install & build ──
cd "$SRC_DIR"
echo "--- pnpm install ---"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo "--- pnpm build ---"
pnpm build

# ── 2.5. Run database migrations ──
echo "--- database migrations ---"
cd "$SRC_DIR/packages/server"
node -e "
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.resolve('../../data/db/mu.db');
if (!fs.existsSync(dbPath)) { console.log('No database yet, skipping migrations'); process.exit(0); }
const db = new Database(dbPath);
const tables = [
  'CREATE TABLE IF NOT EXISTS transcode_cache (id TEXT PRIMARY KEY, movie_file_id TEXT NOT NULL REFERENCES movie_files(id) ON DELETE CASCADE, quality TEXT NOT NULL, encoding_settings TEXT NOT NULL, completed_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS audio_profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT \\'{}\\', is_default INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS job_history (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, payload TEXT, priority INTEGER DEFAULT 10, progress REAL DEFAULT 0, result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, duration_ms INTEGER, movie_id TEXT, movie_title TEXT, file_path TEXT, quality TEXT)',
];
for (const sql of tables) { db.exec(sql); }
// Add columns that may not exist
const alters = [
  'ALTER TABLE movies ADD COLUMN thumbnail_url TEXT',
  'ALTER TABLE movies ADD COLUMN thumbnail_aspect_ratio REAL',
  'ALTER TABLE movies ADD COLUMN hidden INTEGER DEFAULT 0',
  'ALTER TABLE movies ADD COLUMN play_settings TEXT',
  'ALTER TABLE movie_files ADD COLUMN file_metadata TEXT',
  'ALTER TABLE movie_files ADD COLUMN video_width INTEGER',
  'ALTER TABLE movie_files ADD COLUMN video_height INTEGER',
  'ALTER TABLE movie_files ADD COLUMN video_bit_depth INTEGER',
  'ALTER TABLE movie_files ADD COLUMN video_frame_rate TEXT',
  'ALTER TABLE movie_files ADD COLUMN video_profile TEXT',
  'ALTER TABLE movie_files ADD COLUMN video_color_space TEXT',
  'ALTER TABLE movie_files ADD COLUMN hdr INTEGER DEFAULT 0',
  'ALTER TABLE movie_files ADD COLUMN container_format TEXT',
  'ALTER TABLE plugins ADD COLUMN status TEXT DEFAULT \\'not_installed\\'',
];
for (const sql of alters) { try { db.exec(sql); } catch {} }
console.log('Database migrations applied');
db.close();
" 2>/dev/null || echo "Migration script skipped (dependencies not ready)"
cd "$SRC_DIR"

# ── 3. Stop existing server ──
echo "--- stopping server ---"
source "$SRC_DIR/stop.sh"

# ── 4. Start server (detached) ──
echo "--- starting server ---"
cd "$SRC_DIR/packages/server"

if [ ! -f "$SERVER_DIST" ]; then
    echo "ERROR: $SERVER_DIST not found. Build may have failed."
    exit 1
fi

LOG_DIR="$PROJECT_ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"
mkdir -p "$(dirname "$PID_FILE")"

NODE_ENV=production nohup node "$SERVER_DIST" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
echo "$SERVER_PID" > "$PID_FILE"

echo "Server started (PID: $SERVER_PID)"
echo "Log file: $LOG_FILE"

# ── 5. Verify startup ──
sleep 3
if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== Deploy complete ==="
else
    echo "WARNING: Server may have failed to start. Check $LOG_FILE"
    tail -20 "$LOG_FILE" 2>/dev/null
    exit 1
fi

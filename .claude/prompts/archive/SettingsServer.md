# Settings > Server — Implementation Plan

## Overview

Add a new "Server" tab to the Settings page, visible only to admin users. Contains collapsible sections for server management, monitoring, and diagnostics.

---

## Phase 1: Backend API Endpoints

### 1.1 Server Info Endpoint

**File:** `packages/server/src/admin/admin.controller.ts` (or new `server-info.controller.ts`)

**`GET /api/v1/admin/server-info`** — Returns:
```typescript
{
  uptime: number;              // process.uptime() in seconds
  nodeVersion: string;         // process.version
  platform: string;            // process.platform
  arch: string;                // process.arch
  hostname: string;            // os.hostname()
  cpuModel: string;            // os.cpus()[0].model
  cpuCores: number;            // os.cpus().length
  totalMemory: number;         // os.totalmem() bytes
  freeMemory: number;          // os.freemem() bytes
  processMemory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  pid: number;                 // process.pid
  serverVersion: string;       // from package.json
  ffmpegPath: string;          // detected path
  hwAccel: string;             // configured hw accel
  hwAccelBroken: boolean;      // whether fallback is active
  encoding: {                  // current encoding settings
    preset: string;
    quality: string;
    rateControl: string;
    maxConcurrentJobs: number;
    useChunkedTranscoding: boolean;
  };
  gpu?: {                      // nvidia-smi output if available
    name: string;
    driver: string;
    memoryTotal: string;
    memoryUsed: string;
    utilization: string;
  };
  dataDir: string;
  cacheSize: string;           // total size of cache directory
  dbSize: string;              // size of SQLite DB file
}
```

**Implementation:**
- Use Node.js `os` module for system info
- Use `process.memoryUsage()` for app memory
- Try `nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu --format=csv,noheader` for GPU info (catch error if not available)
- Read encoding settings from SettingsService
- Get hwAccelBroken from TranscoderService
- Stat the cache and DB directories for sizes

### 1.2 Server Restart Endpoint

**`POST /api/v1/admin/restart`** — Triggers server restart

**Implementation:**
- Respond with `{ message: 'Restarting...' }` immediately
- After 1 second delay, call `process.exit(0)`
- The deploy/restart script (or systemd/PM2) will restart the process
- For Windows with PID file: spawn `restart.sh` as a detached child process before exiting

### 1.3 Statistics Endpoint

**`GET /api/v1/admin/stats`** — Returns:
```typescript
{
  cpu: {
    usage: number;             // CPU usage percentage (current process)
    system: number;            // System-wide CPU usage
  };
  memory: {
    app: { rss, heapUsed, heapTotal };
    system: { total, free, used, usedPercent };
  };
  disk: {
    dataDir: { total, free, used, usedPercent, path };
  };
  library: {
    movieCount: number;
    fileCount: number;
    totalFileSize: number;     // sum of all movie file sizes
    sourceCount: number;
  };
  streaming: {
    activeSessions: number;
    activeTranscodes: number;
  };
  transcoding: {
    completedCaches: number;   // count of transcode_cache entries
    totalCacheSize: number;    // size of persistent cache dir
    activeChunks: number;      // currently encoding chunks
    queuedChunks: number;      // pending chunks
  };
}
```

**Implementation:**
- CPU: use `os.cpus()` with diff over 1s interval, or `process.cpuUsage()`
- Disk: use `child_process.execSync('df -h <path>')` on Unix, `wmic logicaldisk` on Windows, or `fs.statfs` (Node 18+)
- Library stats: query DB counts
- Streaming: query StreamService.getActiveSessions()
- Transcoding: query TranscoderService.getActiveTranscodeCount() + ChunkManager

### 1.4 Jobs Endpoints

**`GET /api/v1/admin/jobs`** — List jobs with filters
- Query params: `status` (running|pending|completed|failed|cancelled|paused), `type`, `limit`, `offset`
- Returns array of job records with full details

**`GET /api/v1/admin/jobs/:id`** — Get single job with full details

**`POST /api/v1/admin/jobs/:id/pause`** — Pause a running job
- Set status to 'paused', stop the FFmpeg process but keep the job record
- When resumed, continue from where it left off

**`POST /api/v1/admin/jobs/:id/resume`** — Resume a paused job

**`POST /api/v1/admin/jobs/:id/cancel`** — Cancel a job (already exists)

**Job Details Enhancement:**
Currently `JobRecord` has: id, type, label, status, payload, priority, progress, result, error, createdAt, startedAt, completedAt

**Add to JobRecord:**
```typescript
{
  // Existing fields...
  movieTitle?: string;        // Resolved from payload.movieId
  filePath?: string;          // From payload.filePath
  quality?: string;           // From payload.quality
  inputFileSize?: number;     // File size in bytes
  outputFileSize?: number;    // Result file/cache size
  durationMs?: number;        // Computed from startedAt to completedAt
  estimatedRemainingMs?: number; // Based on progress rate
}
```

**Job History (DB):**

New table `job_history`:
```sql
CREATE TABLE job_history (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT,              -- JSON
  priority INTEGER DEFAULT 10,
  progress REAL DEFAULT 0,
  result TEXT,               -- JSON
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  movie_id TEXT,
  movie_title TEXT,
  file_path TEXT,
  quality TEXT
);
```

When a job completes/fails/cancels, insert into `job_history` and remove from the in-memory job map after a delay.

### 1.5 Logs Endpoint

**`GET /api/v1/admin/logs`** — Read server log
- Query params: `lines` (default 200), `file` ('server' | 'transcode-debug')
- Returns: `{ content: string, path: string, sizeBytes: number }`
- Read last N lines from `data/logs/server.log` or `data/logs/transcode-debug.log`

**Implementation:**
- Use `readFile` and split by newlines, take last N lines
- For large files, use a reverse line reader or `tail` equivalent

---

## Phase 2: Frontend — Settings > Server Page

### 2.1 New Server Tab

**File:** `packages/client/src/pages/Settings.tsx`

Add a new tab `'server'` to the tab list, visible only when `currentUser.value?.role === 'admin'`.

### 2.2 Server Info Section (Collapsible)

- Show server uptime (formatted as "X days, Y hours, Z minutes")
- Show OS, Node version, CPU, RAM
- Show GPU info if available (name, driver, memory, utilization)
- Show encoding settings (preset, quality, hw accel status)
- Show data directory, cache size, DB size
- "Restart Server" button with confirmation modal

### 2.3 Statistics Section (Collapsible)

- CPU usage gauge/bar
- Memory usage (app vs system) with bars
- Disk usage bar
- Library stats (movie count, file count, total size)
- Active streams count
- Active transcodes count
- Auto-refresh every 5 seconds (or manual refresh button)

### 2.4 Jobs Section (Collapsible)

Two sub-tabs: "Current" and "History"

**Current Jobs:**
- List of running/pending jobs as cards
- Each card shows: type icon, label, movie title, quality, progress bar, elapsed time, ETA
- Expand on click for full details (file path, FFmpeg command, encoding settings)
- Stop/Pause/Resume buttons per job
- Auto-refresh every 3 seconds

**History:**
- Filterable by status (completed/failed/cancelled)
- Table/list with: label, status badge, duration, quality, completed time
- Click to expand for full details
- Pagination (20 per page)

### 2.5 Logs Section (Collapsible)

- Dropdown to select log file (server.log / transcode-debug.log)
- Read-only textarea/pre with monospace font, dark background
- Number of lines selector (100/200/500/1000)
- Refresh button (top right)
- Copy to clipboard button (top right)
- Auto-scroll to bottom on load

---

## Phase 3: Components

### New Components

```
packages/client/src/pages/ServerSettings.tsx          — Main server settings component
packages/client/src/components/admin/ServerInfo.tsx    — Server info section
packages/client/src/components/admin/ServerStats.tsx   — Statistics section
packages/client/src/components/admin/JobsList.tsx      — Jobs section with tabs
packages/client/src/components/admin/ServerLogs.tsx    — Log viewer section
packages/client/src/components/admin/CollapsibleSection.tsx — Reusable collapsible wrapper
```

### Collapsible Section Component

```tsx
function CollapsibleSection({ title, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div class={styles.section}>
      <button class={styles.sectionHeader} onClick={() => setOpen(!open)}>
        <h3>{title}</h3>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div class={styles.sectionContent}>{children}</div>}
    </div>
  );
}
```

---

## Phase 4: Database Schema

### New Table: `job_history`

**File:** `packages/server/src/database/schema/job-history.ts`

```typescript
export const jobHistory = sqliteTable('job_history', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  label: text('label').notNull(),
  status: text('status').notNull(),
  payload: text('payload'),
  priority: integer('priority').default(10),
  progress: real('progress').default(0),
  result: text('result'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  durationMs: integer('duration_ms'),
  movieId: text('movie_id'),
  movieTitle: text('movie_title'),
  filePath: text('file_path'),
  quality: text('quality'),
});
```

Add to schema index exports. Run `pnpm db:migrate` after.

---

## Phase 5: Job System Enhancements

### Add 'paused' status

**File:** `packages/server/src/jobs/job.interface.ts`

Update `JobStatus` type to include `'paused'`.

### Add pause/resume to JobManagerService

**File:** `packages/server/src/jobs/job-manager.service.ts`

```typescript
pause(id: string): boolean {
  const job = this.jobs.get(id);
  if (!job || job.status !== 'running') return false;
  // Call onCancel to stop FFmpeg
  const callback = this.onCancelCallbacks.get(id);
  if (callback) callback();
  job.status = 'paused';
  this.running.delete(id);
  return true;
}

resume(id: string): boolean {
  const job = this.jobs.get(id);
  if (!job || job.status !== 'paused') return false;
  job.status = 'pending';
  // Re-enqueue at original priority
  this.queue.unshift(id); // Front of queue for priority
  this.processQueue();
  return true;
}
```

### Write to job_history on completion

In `runJob`, after setting final status, insert into `job_history` table.

---

## Implementation Order

1. **Backend endpoints** (server-info, stats, logs, job enhancements) — can be done independently
2. **Database schema** (job_history table) — needed before job history features
3. **Job system enhancements** (pause/resume, history writes)
4. **Frontend components** (CollapsibleSection, then each section)
5. **Settings page integration** (add Server tab, wire up components)

### Estimated Files to Create/Modify

**Create (8 files):**
- `packages/server/src/admin/server.controller.ts` — Server info, stats, restart, logs endpoints
- `packages/server/src/admin/server.service.ts` — Server info gathering logic
- `packages/server/src/database/schema/job-history.ts` — Job history table
- `packages/client/src/pages/ServerSettings.tsx` — Main server settings component
- `packages/client/src/components/admin/ServerInfo.tsx`
- `packages/client/src/components/admin/ServerStats.tsx`
- `packages/client/src/components/admin/JobsList.tsx`
- `packages/client/src/components/admin/ServerLogs.tsx`

**Modify (6 files):**
- `packages/server/src/admin/admin.module.ts` — Register new controller/service
- `packages/server/src/jobs/job.interface.ts` — Add 'paused' status
- `packages/server/src/jobs/job-manager.service.ts` — Pause/resume, history writes
- `packages/server/src/jobs/job.controller.ts` — Pause/resume endpoints
- `packages/server/src/database/schema/index.ts` — Export job_history
- `packages/client/src/pages/Settings.tsx` — Add Server tab

# Refactor plan — `TranscoderService`

**Source:** `src/packages/server/src/stream/transcoder/transcoder.service.ts` (2097 lines)
**Trigger:** graphify community C7 — single class spans 5 distinct concerns; cohesion 0.07.
**Goal:** carve into ~4 services along the natural sub-cluster boundaries, keep `TranscoderService` as a thin orchestrator.

## Current state

`TranscoderService` owns:
- FFmpeg process spawn, child-pid tracking, lifecycle (`onModuleDestroy`, `boostProcessPriority`, `getChildPids`, `cleanup`)
- Stream / remux / pre-transcode entry points (`startTranscode`, `startRemux`, `preTranscode`, `transcodeChunk`)
- Encoding-settings resolution (`getEncodingSettings`, `mapNvencPreset`, `getVideoCodec`, `getRateControlOpts`, `encoderForHwAccel`)
- Cache validation & manifest health (`validateCache`, `checkManifestDuration`, `probeSegmentHealth`, `clearCache*`, `getPersistentDir`, `hasCachedTranscode`, `reconcileCaches`)
- Hardware-encoder health (`recycleHwAccel`, `probeEncoder`, `markFfmpegSpawnBroken`, `setHwAccelBroken`, `resetHwAccelBroken`, `isFfmpegSpawnBroken`, `retryWithSoftware`, `preTranscodeWithSoftware`)
- Transcode-debug stderr capture (`appendSessionStderr`)
- Persistent state across SW-fallback (`hwAccelBroken` flag in DB)

These four bullets answer four different questions, get tested in four different ways, and the routing (cache → settings → hw health → process) is now buried inside one 2k-line file.

## Proposed split

| New service | Responsibility | Methods that move |
|---|---|---|
| **`EncodingSettingsService`** | Resolve codec/preset/bitrate from settings + hw-accel state. Pure(ish), no IO. | `getEncodingSettings`, `getVideoCodec`, `getRateControlOpts`, `mapNvencPreset`, `encoderForHwAccel` |
| **`HwAccelHealthService`** | NVENC/QSV/VAAPI broken-flag persistence, recycle routine, encoder probe. | `recycleHwAccel`, `probeEncoder`, `markFfmpegSpawnBroken`, `setHwAccelBroken`, `resetHwAccelBroken`, `isFfmpegSpawnBroken`, `isWindowsSpawnFailure` |
| **`TranscodeCacheService`** | Validate cached HLS, reconcile DB ↔ filesystem, clear by movie/quality. | `validateCache`, `checkManifestDuration`, `probeSegmentHealth`, `getPersistentDir`, `hasCachedTranscode`, `clearCacheQuality`, `clearCache`, `reconcileCaches` |
| **`TranscoderService`** *(thin)* | Orchestrate the spawn → run → cleanup flow; own `activeProcesses` map. | `startTranscode`, `startRemux`, `preTranscode`, `transcodeChunk`, `retryWithSoftware`, `preTranscodeWithSoftware`, `cleanup`, `boostProcessPriority`, `getChildPids`, `appendSessionStderr`, `onModuleInit`, `onModuleDestroy` |

`TranscodeDebuggerService` already exists — leave it alone.
`ChunkManagerService` already exists — leave it alone; it consumes `TranscoderService.transcodeChunk` and that stays put.

## Why these boundaries

- **Encoding settings** is a pure resolver: input = settings JSON + `hwAccelBroken` flag, output = codec/preset string. Easy to unit-test once isolated; today it's tangled with the spawn path.
- **HW-accel health** is the routine I added last week — `recycleHwAccel`, `probeEncoder`, the `hwAccelBroken*` DB keys. It's the only piece of `TranscoderService` that talks to `settingsService` for state persistence; pulling it out makes the CLI script (`scripts/recycle-nvenc.js`) and the API endpoint (`/admin/server/encoder/recycle`) genuinely share a single source of truth.
- **Cache validation** is the slow, easy-to-break piece. `validateCache()` performance is in `CLAUDE.md` as a known gotcha. Isolating it makes the perf invariants ("no per-segment stat") explicit and testable.
- **Transcoder orchestrator** keeps the spawn/lifecycle map and delegates everything else.

## Migration steps

1. **Extract `EncodingSettingsService`** first — pure resolver, smallest blast radius.
   - New module: `src/packages/server/src/stream/transcoder/encoding-settings.service.ts`.
   - Move methods, inject `SettingsService`. Update the one place inside `TranscoderService` that calls them.
   - No behavior change. Verify with a build + the existing transcode flow.

2. **Extract `HwAccelHealthService`**.
   - New module: `src/packages/server/src/stream/transcoder/hw-accel-health.service.ts`.
   - Move the `hwAccelBroken*` flag persistence, `recycleHwAccel`, `probeEncoder`, `markFfmpegSpawnBroken`.
   - Update `EncodingSettingsService` to read the broken-flag from `HwAccelHealthService` (now the single source of truth). Update `server.service.ts` (`recycleHwAccel` wrapper) and the `/encoder/recycle` controller.
   - **Critical check:** `scripts/recycle-nvenc.js` directly reads/writes the same DB rows — confirm the key names didn't drift.

3. **Extract `TranscodeCacheService`**.
   - New module: `src/packages/server/src/stream/transcoder/transcode-cache.service.ts`.
   - Move `validateCache`, `checkManifestDuration`, `probeSegmentHealth`, `getPersistentDir`, `hasCachedTranscode`, `clearCache*`, `reconcileCaches`.
   - `TranscoderService.startTranscode` now calls `TranscodeCacheService.hasCachedTranscode` + `getPersistentDir` directly.
   - Watch for: `validateCache` is on the hot path (per `CLAUDE.md`) — keep the `.complete` marker trust, no per-segment `stat()`.

4. **Slim `TranscoderService`**.
   - What's left: `activeProcesses` map, `startTranscode`, `startRemux`, `preTranscode`, `transcodeChunk`, retry helpers, lifecycle.
   - Should drop from ~2100 lines to ~700.

5. **Update `TranscoderModule`** to provide & export the three new services. `ChunkManagerService` and the controllers continue to inject `TranscoderService` for now — no consumer churn beyond the spawn-related methods.

## Risk notes

- **Hot path:** anything touching `validateCache` or `getEncodingSettings` runs per stream start. Smoke-test the player after each step: open a movie, scrub, change quality, kill mid-stream, restart server, refresh page (existing `CLAUDE.md` regression list).
- **NVENC broken-flag:** the flag is read in three places today (`getEncodingSettings`, the SW-fallback retry, the `EncoderHealthBanner` API). After step 2, all three must call `HwAccelHealthService` — easy to leave a stale read.
- **CLI script parity:** `scripts/recycle-nvenc.js` writes the same DB keys directly (it has to work when the server is down). The rename of the in-memory routine must not change the persisted key names (`hwAccelBroken`, `hwAccelBrokenSince`, `hwAccelBrokenReason`).
- **Module DI:** cross-service injection requires the moved service to be **exported** from `TranscoderModule`, not just declared as a provider (this is in `CLAUDE.md` as a known gotcha).

## Out of scope

- Switching to a different transcode mode (chunked vs monolithic). The toggle stays in `TranscoderService`.
- Touching the `fluent-ffmpeg` patch.
- Restructuring `data/` cache layout or DB schema.

## Definition of done

- `transcoder.service.ts` < 800 lines.
- `EncodingSettingsService.getEncodingSettings` is the single read of `encoding` settings + `hwAccelBroken`.
- `HwAccelHealthService.recycleHwAccel` is what `/admin/server/encoder/recycle` calls — `ServerService` still wraps it but does no work itself.
- All three smoke flows pass: open movie / scrub / change quality / break NVENC and recover via Restart button / `pnpm fix:nvenc`.

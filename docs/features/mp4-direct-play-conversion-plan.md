# MP4 Direct-Play Conversion + Cache Cleanup — Implementation Plan (2026-06-02)

## Goal
Move the library toward native **direct-play MP4** instead of HLS-on-demand, to
(a) fix the EQ/Compressor audio bug app-wide (native `<video>` src attaches Web
Audio; HLS `blob:` MediaSource does not), (b) simplify the player hot path, and
(c) slim disk by replacing originals and clearing HLS caches.

Keep HLS strictly for the **live cold-path** (a movie played before its MP4 exists).

## Decisions (confirmed)
- **Smart convert**: H.264 → lossless remux always. Incompatible codecs
  (HEVC/AV1/VC-1/MPEG-4/Xvid) → re-encode to H.264, **but skip** when the
  predicted output size exceeds `originalSize * growthThreshold` (default 1.05);
  skipped titles stay on on-demand HLS.
- **Convert Original File**: ON by default. Re-encode/remux next to original →
  **ffprobe-verify** (duration within tolerance, size sane) → delete original →
  repoint `movie_files` row → clear caches. Delete is gated on verification.

## Size heuristic (`planConversion(file)`)
Returns `{ action: 'remux' | 'reencode' | 'skip', reason, predictedBytes }`.
- video codec h264/avc → `remux` (lossless, never skip).
- else compute `predictedBytes ≈ (h264RefBitrate[res] + audioBitrate) / 8 * duration`
  where `h264RefBitrate` is a near-lossless per-resolution map
  (480p 2.5M / 720p 5M / 1080p 10M / 1440p 16M / 4k 30M).
  - `predictedBytes <= originalBytes * growthThreshold` → `reencode`.
  - else → `skip` (log it; stays HLS).
- Missing codec/bitrate/duration → `skip` (can't predict safely).

## Server work
1. **Transcoder** (`stream/transcoder/transcoder.service.ts`)
   - `remuxToMp4(input, outPath, onProgress)` — `-c copy -movflags +faststart`.
   - `transcodeToMp4(input, outPath, {preserveResolution, quality}, onProgress)` —
     H.264/AAC, `-movflags +faststart`, source resolution for in-place, reuses
     `getEncodingSettings`/`getRateControlOpts` (near-lossless CRF for in-place).
   - `probeFile(path)` → `{durationSeconds, sizeBytes, codecVideo, codecAudio}` for verify.
   - reuse `clearCache(fileId)` to drop HLS persistent dir.
2. **ConversionService** (new, `stream/conversion/conversion.service.ts`)
   - `planConversion(file)` (heuristic above).
   - `convertFile(file, { inPlace }, onProgress)`:
     - target = inPlace ? `<dir>/<Title (Year)>.mp4` : `<persistent>/<fileId>/direct.mp4`.
     - remux or reencode per plan; verify; if inPlace: delete original, `UPDATE movie_files`
       (filePath, codecVideo='h264', codecAudio, fileSize, containerFormat='mp4', resolution);
       clear HLS cache; if cache-mode: write `.complete`, clear HLS segments.
     - emit `library:movie-updated` + `stream:superseded` for active sessions.
   - `eligibleFiles()` → movie_files needing conversion (mode TRANSCODE/DIRECT_STREAM, or HLS cache present), not already h264-mp4.
3. **Stream serving** (`stream.service.ts` / `stream.controller.ts`)
   - Cache-mode direct play: if a cached `direct.mp4` exists for the file, serve via
     direct-play (`/stream/direct-cache/:fileId`) even when codec would say TRANSCODE.
   - After conversion, emit `stream:superseded {movieId, fileId, newStreamUrl, directPlay}`
     to sessions in `stream_sessions` for that movie.
4. **Jobs** (`library/library-jobs.service.ts`)
   - New `JOB_TYPE.CONVERT_MP4 = 'convert-mp4'`. Handler → `ConversionService.convertFile`
     with progress. Keep `PRE_TRANSCODE` for HLS live.
   - `enqueueConvertJobs({ inPlace })` — plan + enqueue per eligible file. Used by the
     admin action and the "convert all existing" sweep.
   - On scan / new movie: if `convertOriginalFile` on and file is convertible, enqueue convert (in-place).
5. **Settings** (`encoding`)
   - `convertOriginalFile: boolean = true`
   - `autoConvertToMp4: boolean = true`
   - `conversionGrowthThreshold: number = 1.05`
6. **Admin** (`admin.controller.ts`)
   - `POST /admin/convert-and-clear-cache` → `enqueueConvertJobs({ inPlace: true })`; returns count.

## Client work
7. **Settings → Playback : Encoding** — add "Convert Original File" toggle (default on),
   "Auto-convert to MP4" toggle, growth-threshold (advanced). Load/save in `encoding` blob.
8. **Admin quick action** — `ActionRow` "Convert and Clear Cache" + handler + start toast;
   subscribe to `job:progress/completed` for a live-updating toast of converted/total.
9. **Player** — `wsService.subscribe('stream')` + `on('stream:superseded')`: if it's the
   current movie, reload source at current position (reuse `restartStreamAtPosition`/`initPlayback`),
   toast "Switched to direct play (better audio)".

## Safety / rollback
- Original deleted only after probe-verify of the new file.
- Conversion writes to a temp name, then atomically renames before repoint.
- Skipped (would-grow) titles keep working via HLS unchanged.
- HLS path and pre-transcode job remain intact for the cold path.

## Phasing (build-verified between)
- P1: transcoder MP4 methods + probe.  P2: ConversionService + heuristic.
- P3: convert job + enqueue + admin endpoint.  P4: stream-serving + superseded event.
- P5: settings fields (server read + client UI).  P6: admin quick action (client).
- P7: player superseded handler + toast.  P8: migration/docs.

---

## Status: IMPLEMENTED (2026-06-02) — server + client builds green

Files touched:
- `stream/transcoder/transcoder.service.ts` — `probeFile`, `remuxToMp4`,
  `transcodeToMp4` (with `videoCopy`), `cancelConversionByOutput`,
  `getFilePersistentRoot`, `clearHlsCachesExcept`, `getCachedDirectMp4`. MP4
  muxer forced via `-f mp4` + `-movflags +faststart`.
- `stream/conversion/conversion.service.ts` — NEW. `planConversion`,
  `convertFile`, `eligibleFiles`, `cancel`, growth-threshold guard.
- `stream/stream.module.ts` — provides/exports ConversionService.
- `stream/stream.service.ts` `determineStreamMode` + `stream.controller.ts`
  `direct/:fileId` — serve cached `direct.mp4` when present (cache mode).
- `shared/.../enums` + `events.gateway.ts` — `STREAM_SUPERSEDED`.
- `library/library-jobs.service.ts` — `JOB_TYPE.CONVERT_MP4` + handler +
  `enqueueConvertJobs` + auto-convert branch in `enqueuePreTranscodeIfNeeded`.
- `library/library.controller.ts` — `POST /sources/convert-and-clear-cache`.
- client `pages/Settings.tsx` — Encoding § new toggles (auto-convert,
  convert-original, size limit).
- client `pages/AdminDashboard.tsx` — "Convert and Clear Cache" quick action +
  confirm + live progress toast.
- client `components/player/useVideoEngine.ts` — `stream:superseded` reload.

### Behaviour split (safety)
- **New movies** (scan / movie-added) auto-convert when `autoConvertToMp4` is on
  (in-place per `convertOriginalFile`). Would-grow cases fall through to HLS.
- **Startup resume** still builds HLS for un-converted files — it does NOT mass-
  delete originals on boot. The whole existing library is converted only via the
  explicit **Convert and Clear Cache** admin action (or as each title is next
  pre-transcoded). Deliberate: avoids a silent library-wide delete on restart.
- Original deletion is gated on ffprobe verification (duration within 3s/1%,
  size > 1 MB) of the new file; temp uses a non-media `.part` extension.

### Known caveats / follow-ups
- **Embedded subtitles** in the source are NOT carried into the MP4 (we map
  first video + first audio only). For in-place replacement this means embedded
  subs are lost unless already extracted to sidecars/DB by the subtitle system.
  Follow-up: pre-extract embedded subs before in-place delete, or map
  `mov_text`.
- **Audio is downmixed to stereo** (`-ac 2`), matching the existing HLS path —
  5.1 surround is lost on re-encode/remux-audio. Follow-up: optional
  "preserve channels" setting.
- Live progress toast counts all `convert-mp4` completions globally, so a
  concurrent auto-convert can make the admin-action count approximate.
- No DB migration required (settings in `encoding` blob; `movie_files` columns
  reused).

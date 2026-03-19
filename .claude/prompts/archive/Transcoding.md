
/superpowers:brainstorm I want to build a plan for an ideal and fully complete transcoding-management class or module, which can handle stopping and starting trancoded 'chunks' of the
movies, in 3-12-second intervals (this chunk size will be configurable in the App settings, in an integer 'settings' value), and be able to compile either virtual or real manifests for the
clients, depending on the completed and missing chunks. The module should be smart enough to scan a movies transcoded/cached chunks directory, and understand which chunks are complete or
still need transcoding, and be able to manage all of the calls to ffmpeg to transcode the individual chunks, depending on the configured chunk time size, build the chunks into the cached
transcode directory, and then compiled them together or be able to serve them all smoothly when all chunks are finished. If a user seeks to a new place in a movie that is being transcoded,
to a time which is not yet transcoded, the module should be smart enough to start the transcoding at the new section, determine which chunks are still missing (by looking at the completed
cached chunks direcetory for that movie, or the manifest), and build the missing chunks, even if they are piece-meal (ie. one chunk is missing, the next is not, and then more are, and so
on). It should be smart enough to detect which chunks are actually missing, and manage the transcoding for those chunks. Once a movie is fully transcoded (all chunks finished), it should
finalize the transcoding by merging or finishing the transcoding to be as efficient as possible, and mark the movie as "completed" or ready. Ensure that the plan includes all of these
necessary modifications, and that the transcoding is smart enough to resume at any given place, and not need to re-generate already transcoded chunks.
This process should be able to be managed for any given movie, and even multiple movies, separately. If the server is restarted, the trancsoding system or manager should be smart enough to
resume any movies that were previously being transcoded, by looking at its semi-complete manifest, or scanning the chunks manually, and setting up the map or calls to trascode all of the
remaining missing chunks. If a user is watching a movie that is being transcoded, and then seeks to a time later in the movie, the transcoding system should start chunking that new position,
 as a priority (it should move that transcoding job priority to the top, so that time will be transcoded next, and the chunks after it, so the user can watch the movie as soon as possible
from that time/location). Ensure the new transcoding manager is setup to be able to control the jobs system with re-settings or re-organizing the priority of currently encoding chunks, so
that new requests for a different time will be moved to the top of the priority list, if the user requests a new seek location.

--------------------------------------------------------------------------------

Here's the complete plan for the Chunked Transcoding Manager:

  Architecture Summary

  Instead of one FFmpeg process per movie, each movie is divided into discrete chunks (configurable 3-12s). Each chunk is an independent FFmpeg invocation producing a single .ts segment. This
   enables:

  - Priority-based seek: User seeks to minute 45? Chunks at that position jump to top of queue
  - Resumability: Server restart? Scan disk for existing chunks, re-enqueue only missing ones
  - No wasted work: Seeking doesn't discard previously transcoded segments
  - Multi-user: Two users seeking different positions both get prioritized

  New Files

  ┌───────────────────────────┬─────────────────────────────────────────────────────────────┐
  │           File            │                           Purpose                           │
  ├───────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ chunk-manager.service.ts  │ Core service: chunk maps, priority queue, FFmpeg scheduling │
  ├───────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ chunk-manifest.service.ts │ Dynamic HLS manifest generation with #EXT-X-GAP markers     │
  ├───────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ chunk-meta.ts             │ Metadata interface persisted as chunk-meta.json per movie   │
  └───────────────────────────┴─────────────────────────────────────────────────────────────┘

  Key Design Points

  - Chunk Map: Array of {index, startTime, duration, status} per movie+quality
  - Priority Queue: Internal scheduler (not JobManager) with levels: SEEK(1) > LOOKAHEAD(5) > SEQUENTIAL(20) > BACKGROUND(40)
  - Virtual Manifests: Use HLS v6 #EXT-X-GAP for uncompleted chunks — HLS.js skips them natively
  - FFmpeg per chunk: ffmpeg -ss <start> -t <duration> -i <input> -f mpegts -force_key_frames 0 segment_XXXX.ts
  - Finalization: When all chunks complete → write final manifest + .complete marker
  - Feature flag: useChunkedTranscoding setting for gradual rollout

  Client Changes

  - Seek no longer destroys/recreates HLS — just reloads the manifest
  - HLS.js handles #EXT-X-GAP markers natively, playing available chunks
  - Manifest polling (1-2s) after seek until target chunk appears

--------------------------------------------------------------------------------

we also need to make sure... in some way... that if a movie is being transcoded, or has existing chunks (and isn't fully complete), but if the user changes the transcoding 'chunk' time,
in the app settings, the new transcoding chunks will be a different time, in the manifest. In that case, can the system detect how long each individual chunk is, and be able to
compensate for those changes? Ie. if a '4-second chunk' is missing, but the chunk time is '12s', it should automatically know it only needs to transcode the remaining 4-second chunk,
and not re-encode every chunk to 12s. I'm not sure if that is possible. If it is not, and the user changes the transcoding chunk time during transcodes in progress, I think they would
need to be cancelled, and transcoding should start over with the new chunk segment time. I would prefer not to have to do that, if we can manage the chunk timing ourself, with unique
times for each chunk (or otherwise combine the chunks for transcodes-in progress, if the user changes the chunk time setting while transcodes are in progress)

This is a great question. There are two approaches:

Approach A: Variable-duration chunks (preferred)

This is actually possible and fits naturally with how HLS works. Each #EXTINF line in the manifest already specifies the exact duration of that segment independently. So the manifest can
have:

#EXTINF:4.000,
segment_0000.ts    (old 4s chunk)
#EXTINF:4.000,
segment_0001.ts    (old 4s chunk)
#EXTINF:12.000,
segment_0002.ts    (new 12s chunk, covering what would have been segments 2-4)

The key insight: the chunk index doesn't need to map 1:1 to a fixed time grid. Instead of naming chunks by index, we can name them by their start time offset (e.g., chunk_t0000.ts,
chunk_t0008.ts, chunk_t0020.ts). The chunk map would store the actual start time and duration of each chunk individually, and the manifest generator already writes per-chunk #EXTINF
durations.

When the chunk size setting changes:
1. Scan existing chunks on disk, note their actual time ranges (from chunk-meta.json or by probing)
2. Build a new chunk map where existing segments keep their original durations
3. Fill gaps with new chunks at the new configured duration
4. No re-encoding of existing chunks needed

Approach B: Cancel and restart

If variable-duration chunk management feels too complex, simply detect the setting change, cancel in-progress transcodes, wipe partial caches, and restart with the new chunk size. Simpler
	but wastes work.

My recommendation: The current implementation I'm building already stores per-chunk duration in the ChunkInfo struct and writes it to the manifest individually. So Approach A is
architecturally supported. The main change needed is:

- Use time-based segment naming (segment_t{seconds}.ts) instead of sequential index naming
- When rebuilding a chunk map after a settings change, scan existing files, determine their time coverage, and only create new chunks for uncovered time ranges
- Store each chunk's actual duration in chunk-meta.json

This is feasible but adds complexity to the gap-detection logic. I'd suggest we start with the current sequential approach and add variable-duration support as a follow-up — for now, if
the chunk size changes mid-transcode, we can keep existing chunks and just use the new size for remaining gaps, since the manifest already supports per-segment durations.


--------------------------------------------------------------------------------

We need to show some indication on the movie details page, and the movie cards, for movies that are not completely transcoded. Do we have a flag that is set on the
movies if the transcoding is complete? If so, then on the movie details or card page, show a special label that the movie is not fully transcoded, just so the user
knows that their may be issues playing. This can also just be the same 'Processing...' label that is already there... However it should show if the movies are not
fully transcoded, and it should also ensure those movies transcoding operations (that are missing) are resumed, when the server starts, or at any point it detects
them. It should try to be smart, in that case, and move the movies from the top of the 'recently played' list as the highest priority transcoding operations, if they
need to be transcoded still. Basically the server should check all movies in the database on startup, and if any are not marked as 'transcoding complete', and need
transcoding, an operation should be started for each movie (with the recently played movies at the highest transcoding priority, and started first). It should be able
to detect which chunks are missing from those movies, and begin transcoding and filling them in, when that movie transcoding job starts to finish it. When it is
finished, the transcoding should mark the movie as complete in the database, and the UI should update
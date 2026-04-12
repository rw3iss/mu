# Seek Thumbnail Sprite Sheets — Design Spec

## Overview

Generate sprite sheet images (grids of video frames) for each movie so the seek bar can show a thumbnail preview on hover. Frames are extracted at intervals fine enough for ~1:1 pixel mapping on a 4K seek bar. Thumbnails are 150% larger than typical players.

## Server: Generation

### Frame Interval
- Formula: `duration_seconds / 3600`, clamped to min 1s, max 5s
- Targets ~3600 frames max, matching 4K seekbar width (~3500px)
- 2-hour movie: ~2s intervals (3600 frames)
- 30-min video: ~1s intervals (1800 frames)

### Frame Size
- 240x135 pixels (16:9 aspect ratio)
- 150% area of typical player thumbnails (160x90)
- Non-16:9 content: scale proportionally, max-width 240

### Sprite Sheet Layout
- Grid: 10 columns x 10 rows = 100 frames per sheet
- Sheet dimensions: 2400x1350 JPEG, quality 70
- 2-hour movie = ~36 sheets, ~150-300KB each, ~7-10MB total
- Storage: `data/sprites/{movieId}/`

### FFmpeg Strategy
Single FFmpeg command per sheet using fps + tile filters:
```
ffmpeg -i input.mp4 -vf "fps=1/{interval},scale=240:-2,tile=10x10" -q:v 5 output_%03d.jpg
```
This extracts frames at the interval and tiles them into grids in one pass — much faster than individual frame extraction.

### Job Integration
- New job type: `sprite-sheet`
- Enqueued during movie scan after thumbnail job, priority 45
- Also enqueueable via admin action
- Handler in `LibraryJobsService`

### Metadata File
`data/sprites/{movieId}/meta.json`:
```json
{
  "interval": 2,
  "frameWidth": 240,
  "frameHeight": 135,
  "columns": 10,
  "rows": 10,
  "sheetCount": 36,
  "totalFrames": 3600
}
```

## Server: Serving

- `GET /media/sprites/:movieId/meta.json` — sprite metadata
- `GET /media/sprites/:movieId/:index.jpg` — individual sheet, cached 1 year (immutable)
- Both served by `ThumbnailController` (or new `SpriteController`)

## Client: Display

### Loading
- On stream start, fetch `/media/sprites/{movieId}/meta.json`
- If 404 (no sprites), silently degrade to time-only tooltip
- Store metadata in player state

### Hover Logic
On seek bar mousemove:
1. `timestamp = (mouseX / barWidth) * duration`
2. `frameIndex = Math.floor(timestamp / interval)`
3. `sheetIndex = Math.floor(frameIndex / (columns * rows))`
4. `frameInSheet = frameIndex % (columns * rows)`
5. `col = frameInSheet % columns`, `row = Math.floor(frameInSheet / columns)`
6. `backgroundPosition = -${col * frameWidth}px -${row * frameHeight}px`
7. `backgroundImage = url(/media/sprites/{movieId}/{sheetIndex}.jpg)`

### Edge Clamping
- Calculate tooltip center at mouse X position
- Clamp: `left = max(0, min(mouseX - tooltipWidth/2, containerWidth - tooltipWidth))`
- Tooltip sticks to container edge when near beginning/end of seek bar
- Time label inside tooltip can remain centered on actual time position

### Tooltip Appearance
- Frame: 240x135
- 2px border, subtle shadow, rounded corners
- Time label below frame
- Total size: ~248x155
- Positioned above seek bar

## Files to Modify/Create

### Server
1. New: `src/packages/server/src/media/sprite.service.ts` — generation logic, metadata, file paths
2. Modify: `src/packages/server/src/media/thumbnail.controller.ts` — add sprite serving endpoints
3. Modify: `src/packages/server/src/media/media.module.ts` — register SpriteService
4. Modify: `src/packages/server/src/library/library-jobs.service.ts` — register sprite-sheet job handler, enqueue during scan

### Client
5. Modify: `src/packages/client/src/components/player/PlayerControls.tsx` — add sprite thumbnail to seek tooltip
6. Modify: `src/packages/client/src/components/player/PlayerControls.module.scss` — tooltip styles
7. Modify: `src/packages/client/src/state/player.state.ts` — sprite metadata state

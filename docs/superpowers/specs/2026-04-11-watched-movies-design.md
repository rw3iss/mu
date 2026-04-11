# Watched Movies Feature — Design Spec

## Overview

Add a "watched" tracking system that lets users filter out movies they've already seen. Builds entirely on the existing `user_watch_history` table and `completed` flag — no new tables needed.

## Approach

The existing infrastructure already tracks watch progress per user per movie:
- `user_watch_history` table has `userId`, `movieId`, `durationWatchedSeconds`, `completed`, `positionSeconds`
- `stream.service.updateProgress()` already upserts watch history on every progress tick
- `movies.service.findAll()` already left-joins `user_watch_history` and returns `watchCompleted`

We piggyback on all of this. The only new pieces are:
1. Auto-mark `completed = true` when cumulative `durationWatchedSeconds` crosses a configurable threshold
2. A `hideWatched` query filter on the movies endpoint
3. UI toggles and context menu items
4. A "watched threshold" setting
5. Lightweight in-memory cache on movie list queries

## 1. Auto-Detection of "Watched" Status

### Where: `stream.service.ts` — `updateProgress()` method

Currently, `updateProgress()` upserts `positionSeconds` into `user_watch_history` but never updates `durationWatchedSeconds` or checks `completed`. The fix:

**On each progress update:**
1. Calculate the time delta since the last progress update for this session (track `lastPositionUpdate` in the existing in-memory `sessionRegistry`)
2. Add the delta to `durationWatchedSeconds` (cumulative across sessions)
3. If `durationWatchedSeconds >= watchedThreshold` and `completed` is still false, set `completed = true`

**Threshold source:** Read from `settings.get('watchedThresholdSeconds', 30)`. Cache the setting value in-memory on the StreamService to avoid DB reads on every progress tick. Invalidate when settings change.

**Edge cases:**
- Seeking forward doesn't count as watch time (delta would be negative or huge — clamp to 0)
- If `completed` is already true, skip the check entirely
- Anonymous/shared viewers (no userId) — skip entirely

### Session-level tracking

Add a `lastProgressPosition: number` and `lastProgressTime: number` field to the in-memory session registry entry. On each `updateProgress()` call:

```
timeDelta = now - lastProgressTime
positionDelta = positionSeconds - lastProgressPosition

// Only count if playing forward at roughly 1x speed (allow up to 2x)
if (positionDelta > 0 && positionDelta < timeDelta * 2.5 / 1000) {
  increment = positionDelta
} else {
  increment = 0
}
```

This prevents seek jumps and paused time from inflating the counter.

## 2. Movies Endpoint Filter

### Where: `movies.service.ts` — `findAll()` method

Add a `hideWatched` query parameter (string, 'true'/'false'):

```typescript
if (String(query.hideWatched) === 'true' && userId) {
  conditions.push(
    sql`(${userWatchHistory.completed} IS NULL OR ${userWatchHistory.completed} = 0)`
  );
}
```

Also add a `watchedOnly` parameter for the inverse (only show watched):

```typescript
if (String(query.watchedOnly) === 'true' && userId) {
  conditions.push(sql`${userWatchHistory.completed} = 1`);
}
```

Update the count queries to reflect the filtered totals.

Add a `watchedCount` to the response (similar to existing `hiddenCount`):
```typescript
const watchedResult = userId
  ? db.select({ count: count() }).from(userWatchHistory)
      .where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
      .get()
  : null;
const watchedCount = watchedResult?.count ?? 0;
```

### Movie detail response

`findAll()` already returns `watchCompleted` but then strips it to `undefined` in the response mapping (line 186). Instead, include it as a boolean `watched` flag:

```typescript
watched: row.watchCompleted === true || row.watchCompleted === 1,
```

`findById()` should also return this flag when a userId is present.

## 3. Endpoint Caching

### Where: New `MoviesCacheService` (or inline in `movies.service.ts`)

Simple in-memory TTL cache for `findAll()` results:

- **Key:** JSON.stringify of `{ ...query, userId }` (normalized/sorted)
- **TTL:** 60 seconds
- **Max entries:** 100 (LRU eviction)
- **Invalidation:** Any movie mutation (create, update, delete, hide, mark watched/unwatched) calls `invalidate()` which clears the cache. This is simple and correct — the cache is just to deduplicate rapid identical requests (e.g., page loads, back-nav).

Implementation: a `Map<string, { data: any; expires: number }>` on the MoviesService. No external dependency needed.

`findById()` gets its own single-entry cache per movie ID + userId, same TTL pattern.

## 4. Mark Watched / Unwatched Endpoints

### Already exist in `history.controller.ts`:
- `POST /history/:movieId/watched` → `historyService.markWatched(userId, movieId)`
- `DELETE /history/:movieId` → `historyService.markUnwatched(userId, movieId)`

These are sufficient. After each call, invalidate the movies cache.

The `markUnwatched` method currently deletes the entire watch history row. This is fine — it resets both the "watched" flag and the resume position, which is the expected behavior when a user marks something as unwatched.

## 5. Clear All Watched — Admin/Settings Endpoint

### Where: `history.controller.ts` or `admin.controller.ts`

Add: `DELETE /history/watched` — clears all `completed = true` entries for the current user (not all history, just the watched flag). This preserves in-progress resume positions.

```typescript
// Reset completed flag rather than deleting rows, to preserve resume positions
db.update(userWatchHistory)
  .set({ completed: false })
  .where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
  .run();
```

Also add: `GET /history/watched/count` — returns the count of watched movies for the current user (for the confirmation dialog).

## 6. Watched Threshold Setting

### Server setting
- Key: `watchedThresholdSeconds`
- Default: `30`
- Min: `4`, Max: `1800` (30 minutes)
- Stored via existing `settings` table

### Client UI — Settings > General tab

Add a new section "Watch Tracking" after the existing Display section:

```
Watch Tracking
─────────────────────────────
Watched Threshold          [  30  ] seconds
Mark movies as "watched" after this
amount of cumulative play time.
(4 seconds – 30 minutes)
```

Use a number input with min/max validation. Save via `settings.set('watchedThresholdSeconds', value)`.

## 7. Library UI — Hide Watched Toggle

### Where: `library.state.ts` + `Library.tsx`

Mirror the existing `showHidden` pattern exactly:

**State (`library.state.ts`):**
```typescript
export const hideWatched = signal(
  localStorage.getItem('mu_hide_watched') === 'true'
);

export function toggleHideWatched(): void {
  hideWatched.value = !hideWatched.value;
  localStorage.setItem('mu_hide_watched', String(hideWatched.value));
  fetchMovies(1);
}
```

**API integration:** In `fetchMovies()`, pass `hideWatched: hideWatched.value` as a query param.

**UI (`Library.tsx`):** Add a button next to the existing "Hidden" toggle:

```tsx
<button
  class={`${styles.showHiddenBtn} ${hideWatched.value ? styles.active : ''}`}
  onClick={toggleHideWatched}
  title={hideWatched.value ? 'Showing unwatched only' : 'Hide watched movies'}
>
  {hideWatched.value ? '✓ Unwatched' : '👁 Unwatched'}
</button>
```

Also display `watchedCount` from the API response near the toggle, similar to how `hiddenCount` is shown.

## 8. Movie Context Menu — Watched Toggle

### Where: `MovieOptionsMenu.tsx`

Add a new menu item after "Hide from Library", before the divider:

```tsx
<button class={styles.menuItem} onClick={handleWatchedToggle}>
  <span class={styles.menuIcon}>{movie.watched ? '↩' : '✓'}</span>
  {movie.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
</button>
```

**Handler:**
- If not watched: `POST /history/{movieId}/watched` → update movie state → notify "Marked as watched"
- If watched: `DELETE /history/{movieId}` → update movie state → notify "Marked as unwatched"

After the API call, call `onMovieUpdate?.({ ...movie, watched: !movie.watched })` to update the UI immediately.

## 9. Movie Type Update

### Where: `library.state.ts` — `Movie` type

Add `watched?: boolean` to the Movie interface/type. This is populated from the `watchCompleted` field that `findAll()` already returns (just needs to stop stripping it).

## 10. Settings > Admin — Clear Watched Button

### Where: `AdminDashboard.tsx`

Add a button following the existing pattern (like "Remove Broken Movies"):

```tsx
<Button
  variant="danger"
  onClick={() => setShowClearWatchedConfirm(true)}
  loading={clearingWatched}
>
  Clear Watched History
</Button>
<ConfirmDialog
  isOpen={showClearWatchedConfirm}
  onClose={() => setShowClearWatchedConfirm(false)}
  onConfirm={handleClearWatched}
  title="Clear Watched History"
  message={`This will reset the "watched" status for all ${watchedCount} movie(s). Resume positions will be preserved. This cannot be undone.`}
  confirmLabel="Clear Watched History"
  variant="danger"
/>
```

On mount of the Admin tab, fetch `GET /history/watched/count` to populate the count in the message.

## 11. Watchlist Page — View Unwatched Toggle

### Where: `Watchlist.tsx`

Add a toggle button at the top of the page:

```tsx
<button
  class={`${styles.toggleBtn} ${viewingUnwatched ? styles.active : ''}`}
  onClick={() => setViewingUnwatched(!viewingUnwatched)}
>
  {viewingUnwatched ? 'View Watchlist' : 'View Unwatched'}
</button>
```

When `viewingUnwatched` is true:
- Fetch movies from the same `/movies` endpoint with `hideWatched=true` (reuse the library API)
- Display in the same MovieGrid
- Show count: "X unwatched movies"

When toggled back:
- Fetch from `/watchlist` as before

## Files to Modify

### Server
1. `stream/stream.service.ts` — Add watched threshold check to `updateProgress()`, add session-level time tracking
2. `movies/movies.service.ts` — Add `hideWatched`/`watchedOnly` filters, return `watched` flag, add in-memory cache
3. `movies/movies.controller.ts` — Accept new query params
4. `movies/history.service.ts` — Add `clearWatchedFlags()` and `getWatchedCount()`
5. `movies/history.controller.ts` — Add `DELETE /history/watched` and `GET /history/watched/count`

### Client
6. `state/library.state.ts` — Add `hideWatched` signal, `toggleHideWatched()`, `watched` on Movie type, pass param in `fetchMovies()`
7. `pages/Library.tsx` — Add toggle button
8. `components/movie/MovieOptionsMenu.tsx` — Add watched/unwatched toggle
9. `pages/Settings.tsx` — Add watched threshold input in General tab
10. `pages/AdminDashboard.tsx` — Add "Clear Watched History" button
11. `pages/Watchlist.tsx` — Add "View Unwatched" toggle

## Non-Goals

- No separate "watched" table — reuse existing `user_watch_history.completed`
- No complex watch analytics — just a boolean flag
- No per-file tracking — tracked at the movie level
- No real-time sync across devices — cache invalidates on mutations, next page load picks it up

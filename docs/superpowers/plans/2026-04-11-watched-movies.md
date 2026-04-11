# Watched Movies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users filter out movies they've already watched, with auto-detection based on cumulative play time and manual toggle support.

**Architecture:** Builds on the existing `user_watch_history` table and its `completed` boolean flag. The `stream.service.updateProgress()` method gains cumulative time tracking to auto-flip `completed = true` when a configurable threshold is crossed. A new `hideWatched` query parameter on the movies endpoint filters out watched movies. An in-memory TTL cache on `MoviesService.findAll()` deduplicates rapid queries.

**Tech Stack:** NestJS, Drizzle ORM, SQLite, Preact, Preact Signals, SCSS Modules

---

## File Map

### Server (modify)
- `src/packages/shared/src/types/api.ts` — Add `hideWatched` and `watchedOnly` to `MovieListQuery`
- `src/packages/server/src/stream/stream.service.ts` — Add cumulative watched time tracking to `updateProgress()`
- `src/packages/server/src/movies/movies.service.ts` — Add `hideWatched`/`watchedOnly` filters, return `watched` flag, add in-memory cache with invalidation
- `src/packages/server/src/movies/history.service.ts` — Add `clearWatchedFlags()` and `getWatchedCount()`
- `src/packages/server/src/movies/history.controller.ts` — Add `DELETE /history/watched` and `GET /history/watched/count`

### Client (modify)
- `src/packages/client/src/state/library.state.ts` — Add `watched` to Movie type, `hideWatched` signal, `watchedCount` signal, `toggleHideWatched()`
- `src/packages/client/src/services/movies.service.ts` — Add `markWatched()`, `markUnwatched()` methods, update `MovieListResponse`
- `src/packages/client/src/pages/Library.tsx` — Add "Unwatched" toggle button
- `src/packages/client/src/components/movie/MovieOptionsMenu.tsx` — Add watched/unwatched context menu item
- `src/packages/client/src/pages/Settings.tsx` — Add watched threshold setting in General tab
- `src/packages/client/src/pages/AdminDashboard.tsx` — Add "Clear Watched History" button
- `src/packages/client/src/pages/Watchlist.tsx` — Add "View Unwatched" toggle

---

### Task 1: Add `hideWatched`/`watchedOnly` to shared types

**Files:**
- Modify: `src/packages/shared/src/types/api.ts:23-36`

- [ ] **Step 1: Add query params to MovieListQuery**

In `src/packages/shared/src/types/api.ts`, add `hideWatched` and `watchedOnly` to the interface:

```typescript
export interface MovieListQuery extends PaginationQuery {
	search?: string;
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	ratingFrom?: number;
	ratingTo?: number;
	resolution?: string;
	watched?: boolean;
	hideWatched?: boolean;
	watchedOnly?: boolean;
	hasSubtitles?: boolean;
	showHidden?: boolean;
	/** Filter by media server: 'local', 'all', or a specific remote server ID */
	server?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/packages/shared/src/types/api.ts
git commit -m "feat: add hideWatched/watchedOnly to MovieListQuery type"
```

---

### Task 2: Server — Add watched filters and `watched` flag to movies endpoint

**Files:**
- Modify: `src/packages/server/src/movies/movies.service.ts:40-195` (findAll) and `:197-260` (findById)

- [ ] **Step 1: Add `hideWatched`/`watchedOnly` filter conditions to `findAll()`**

In `movies.service.ts`, inside `findAll()`, after the existing `showHidden` condition block (around line 48), add:

```typescript
// Filter watched/unwatched movies (requires userId for the join)
if (String(query.hideWatched) === 'true' && userId) {
	conditions.push(
		sql`(${userWatchHistory.completed} IS NULL OR ${userWatchHistory.completed} = 0)`,
	);
}

if (String(query.watchedOnly) === 'true' && userId) {
	conditions.push(sql`${userWatchHistory.completed} = 1`);
}
```

- [ ] **Step 2: Return `watched` flag in `findAll()` response mapping**

In the `findAll()` return mapping (around line 179), change:

```typescript
// OLD:
watchCompleted: undefined,

// NEW:
watched: row.watchCompleted === true || row.watchCompleted === 1,
```

- [ ] **Step 3: Add `watchedCount` to `findAll()` response**

After the existing `hiddenCount` query (around line 176), add:

```typescript
const watchedCountResult = userId
	? this.database.db
			.select({ count: count() })
			.from(userWatchHistory)
			.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
			.get()
	: null;
const watchedCount = watchedCountResult?.count ?? 0;
```

Add `watchedCount` to the returned object alongside `hiddenCount`:

```typescript
return {
	movies: data.map((row) => { /* ... */ }),
	total,
	hiddenCount,
	watchedCount,
	page,
	pageSize,
	totalPages: Math.ceil(total / pageSize),
};
```

- [ ] **Step 4: Return `watched` flag from `findById()`**

In `findById()` (around line 241), after reading `historyEntry`, extract the watched flag:

```typescript
let watched = false;
if (historyEntry) {
	watchPosition = historyEntry.completed ? 0 : (historyEntry.positionSeconds ?? 0);
	watched = historyEntry.completed === true || historyEntry.completed === 1;
}
```

Include `watched` in the returned movie object (add it alongside `inWatchlist`, `rating`, `watchPosition`, `durationSeconds`).

- [ ] **Step 5: Commit**

```bash
git add src/packages/server/src/movies/movies.service.ts
git commit -m "feat: add hideWatched/watchedOnly filters and watched flag to movies endpoint"
```

---

### Task 3: Server — Add in-memory cache on `MoviesService.findAll()`

**Files:**
- Modify: `src/packages/server/src/movies/movies.service.ts`

- [ ] **Step 1: Add cache infrastructure to MoviesService class**

At the top of the `MoviesService` class, add:

```typescript
private readonly listCache = new Map<string, { data: any; expires: number }>();
private static readonly CACHE_TTL_MS = 60_000; // 60 seconds
private static readonly CACHE_MAX_ENTRIES = 100;

/** Invalidate all cached movie list results. */
invalidateListCache(): void {
	this.listCache.clear();
}

private getCacheKey(query: MovieListQuery, userId?: string): string {
	return JSON.stringify({ ...query, userId });
}
```

- [ ] **Step 2: Wrap `findAll()` with cache read/write**

At the top of `findAll()`, add:

```typescript
const cacheKey = this.getCacheKey(query, userId);
const cached = this.listCache.get(cacheKey);
if (cached && cached.expires > Date.now()) {
	return cached.data;
}
```

At the bottom of `findAll()`, before the `return`, add:

```typescript
const result = { movies: /* ... */, total, hiddenCount, watchedCount, page, pageSize, totalPages };

// Evict oldest entries if over max
if (this.listCache.size >= MoviesService.CACHE_MAX_ENTRIES) {
	const firstKey = this.listCache.keys().next().value;
	if (firstKey) this.listCache.delete(firstKey);
}
this.listCache.set(cacheKey, { data: result, expires: Date.now() + MoviesService.CACHE_TTL_MS });

return result;
```

- [ ] **Step 3: Add cache invalidation calls to mutation methods**

In `update()`, `remove()`, `deleteFromDisk()`, `purgeMovie()`, and `bulkAction()` methods, add `this.invalidateListCache();` at the start of each method.

- [ ] **Step 4: Commit**

```bash
git add src/packages/server/src/movies/movies.service.ts
git commit -m "feat: add in-memory TTL cache to movies findAll endpoint"
```

---

### Task 4: Server — Auto-detect watched status in `updateProgress()`

**Files:**
- Modify: `src/packages/server/src/stream/stream.service.ts:718-770`

- [ ] **Step 1: Add session progress tracking map**

At the top of the `StreamService` class (near the existing `sessionDirs` and `sessionInfo` maps), add:

```typescript
/** Track last progress position/time per session for cumulative watch time calculation */
private readonly sessionProgress = new Map<
	string,
	{ lastPosition: number; lastTime: number }
>();
```

- [ ] **Step 2: Update `updateProgress()` to track cumulative watched time**

Replace the existing `updateProgress()` method with:

```typescript
async updateProgress(sessionId: string, positionSeconds: number) {
	const sessions = await this.database.db
		.select()
		.from(streamSessions)
		.where(eq(streamSessions.id, sessionId));

	if (sessions.length === 0) {
		// Share/anonymous viewers don't have a persisted session row —
		// silently accept the progress update so the client doesn't error out.
		if (this.sessionRegistry.get(sessionId)) return;
		throw new NotFoundException(`Stream session ${sessionId} not found`);
	}

	const session = sessions[0]!;

	await this.database.db
		.update(streamSessions)
		.set({
			positionSeconds,
			lastActiveAt: nowISO(),
		})
		.where(eq(streamSessions.id, sessionId));

	// Calculate cumulative watch time increment
	const now = Date.now();
	const prev = this.sessionProgress.get(sessionId);
	let increment = 0;
	if (prev) {
		const posDelta = positionSeconds - prev.lastPosition;
		const timeDelta = (now - prev.lastTime) / 1000;
		// Only count if playing forward at a reasonable speed (not seeking)
		if (posDelta > 0 && posDelta < timeDelta * 2.5) {
			increment = Math.round(posDelta);
		}
	}
	this.sessionProgress.set(sessionId, { lastPosition: positionSeconds, lastTime: now });

	// Upsert watch history
	const existing = await this.database.db
		.select()
		.from(userWatchHistory)
		.where(
			and(
				eq(userWatchHistory.userId, session.userId),
				eq(userWatchHistory.movieId, session.movieId),
			),
		);

	if (existing.length > 0) {
		const entry = existing[0]!;
		const newDuration = (entry.durationWatchedSeconds ?? 0) + increment;
		const threshold = this.settings.get<number>('watchedThresholdSeconds', 30);
		const shouldComplete = !entry.completed && newDuration >= threshold;

		await this.database.db
			.update(userWatchHistory)
			.set({
				positionSeconds,
				durationWatchedSeconds: newDuration,
				...(shouldComplete ? { completed: true } : {}),
				watchedAt: nowISO(),
			})
			.where(eq(userWatchHistory.id, entry.id));
	} else {
		const threshold = this.settings.get<number>('watchedThresholdSeconds', 30);
		await this.database.db.insert(userWatchHistory).values({
			id: crypto.randomUUID(),
			userId: session.userId,
			movieId: session.movieId,
			positionSeconds,
			durationWatchedSeconds: increment,
			completed: increment >= threshold,
			watchedAt: nowISO(),
		});
	}
}
```

- [ ] **Step 3: Clean up session progress tracking on stream end**

In `endStream()`, after `this.sessionInfo.delete(sessionId)` (around line 793), add:

```typescript
this.sessionProgress.delete(sessionId);
```

Also in `reapStaleSessions()`, inside the for loop that processes stale sessions, add:

```typescript
this.sessionProgress.delete(session.id);
```

- [ ] **Step 4: Commit**

```bash
git add src/packages/server/src/stream/stream.service.ts
git commit -m "feat: auto-detect watched status via cumulative play time tracking"
```

---

### Task 5: Server — Add history endpoints for clearing watched and getting count

**Files:**
- Modify: `src/packages/server/src/movies/history.service.ts`
- Modify: `src/packages/server/src/movies/history.controller.ts`

- [ ] **Step 1: Add `getWatchedCount()` and `clearWatchedFlags()` to HistoryService**

In `history.service.ts`, add these methods after `getContinueWatching()`:

```typescript
getWatchedCount(userId: string): number {
	const result = this.database.db
		.select({ count: count() })
		.from(userWatchHistory)
		.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
		.get();
	return result?.count ?? 0;
}

clearWatchedFlags(userId: string): number {
	const watchedCount = this.getWatchedCount(userId);
	this.database.db
		.update(userWatchHistory)
		.set({ completed: false })
		.where(and(eq(userWatchHistory.userId, userId), eq(userWatchHistory.completed, true)))
		.run();
	return watchedCount;
}
```

Add `count` to the drizzle-orm imports at the top if not already present.

- [ ] **Step 2: Add controller endpoints**

In `history.controller.ts`, add these endpoints:

```typescript
@Get('watched/count')
getWatchedCount(@CurrentUser('id') userId: string) {
	return { count: this.historyService.getWatchedCount(userId) };
}

@Delete('watched')
clearWatched(@CurrentUser('id') userId: string) {
	const cleared = this.historyService.clearWatchedFlags(userId);
	return { success: true, clearedCount: cleared };
}
```

**Important:** The `@Get('watched/count')` route must be declared **before** any parameterized routes in the controller to avoid route conflicts.

- [ ] **Step 3: Commit**

```bash
git add src/packages/server/src/movies/history.service.ts src/packages/server/src/movies/history.controller.ts
git commit -m "feat: add endpoints for watched count and clearing watched flags"
```

---

### Task 6: Server — Invalidate movies cache on watched status changes

**Files:**
- Modify: `src/packages/server/src/movies/movies.controller.ts`

- [ ] **Step 1: Call `invalidateListCache()` after mark watched/unwatched**

In `movies.controller.ts`, update the `markWatched()` and `markUnwatched()` methods to invalidate cache:

```typescript
@Post(':id/watched')
markWatched(@Param('id') movieId: string, @CurrentUser('id') userId: string) {
	this.historyService.markWatched(userId, movieId);
	this.moviesService.invalidateListCache();
	return { success: true };
}

@Delete(':id/watched')
markUnwatched(@Param('id') movieId: string, @CurrentUser('id') userId: string) {
	this.historyService.markUnwatched(userId, movieId);
	this.moviesService.invalidateListCache();
	return { success: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/packages/server/src/movies/movies.controller.ts
git commit -m "feat: invalidate movie list cache on watched status changes"
```

---

### Task 7: Client — Add `watched` to Movie type, state signals, and service methods

**Files:**
- Modify: `src/packages/client/src/state/library.state.ts`
- Modify: `src/packages/client/src/services/movies.service.ts`

- [ ] **Step 1: Add `watched` to Movie interface**

In `library.state.ts`, add to the `Movie` interface (after `durationSeconds`):

```typescript
watched?: boolean;
```

- [ ] **Step 2: Add signals and toggle function**

In `library.state.ts`, after `export const showHidden = signal(false);` (line 118), add:

```typescript
export const hideWatched = signal(
	localStorage.getItem('mu_hide_watched') === 'true',
);
export const watchedCount = signal(0);
```

After the existing `toggleShowHidden()` function, add:

```typescript
export function toggleHideWatched(): void {
	hideWatched.value = !hideWatched.value;
	localStorage.setItem('mu_hide_watched', String(hideWatched.value));
	fetchMovies(1);
}
```

- [ ] **Step 3: Pass `hideWatched` param in `fetchMovies()`**

In `fetchMovies()`, after the `showHidden` param block (around line 171), add:

```typescript
if (hideWatched.value) {
	params.hideWatched = 'true';
}
```

And in the response handling (around line 181), add:

```typescript
watchedCount.value = response.watchedCount ?? 0;
```

- [ ] **Step 4: Update `MovieListResponse` in movies.service.ts**

In `src/packages/client/src/services/movies.service.ts`, add `watchedCount` to the response type:

```typescript
export interface MovieListResponse {
	movies: Movie[];
	total: number;
	hiddenCount?: number;
	watchedCount?: number;
	page: number;
	pageSize: number;
}
```

Add `markWatched` and `markUnwatched` methods:

```typescript
markWatched(movieId: string): Promise<{ success: boolean }> {
	return api.post<{ success: boolean }>(`/movies/${movieId}/watched`);
},

markUnwatched(movieId: string): Promise<{ success: boolean }> {
	return api.delete<{ success: boolean }>(`/movies/${movieId}/watched`);
},
```

- [ ] **Step 5: Commit**

```bash
git add src/packages/client/src/state/library.state.ts src/packages/client/src/services/movies.service.ts
git commit -m "feat: add watched flag to Movie type, state signals, and API methods"
```

---

### Task 8: Client — Add "Unwatched" toggle button in Library page

**Files:**
- Modify: `src/packages/client/src/pages/Library.tsx`

- [ ] **Step 1: Import new signals**

Add `hideWatched`, `toggleHideWatched`, and `watchedCount` to the imports from `@/state/library.state`:

```typescript
import {
	// ... existing imports ...
	hideWatched,
	toggleHideWatched,
	watchedCount,
} from '@/state/library.state';
```

- [ ] **Step 2: Add toggle button next to the existing "Hidden" button**

After the "Hidden" button (around line 231), add:

```tsx
<button
	class={`${styles.showHiddenBtn} ${hideWatched.value ? styles.active : ''}`}
	onClick={toggleHideWatched}
	title={hideWatched.value ? 'Showing unwatched only' : 'Hide watched movies'}
>
	{hideWatched.value ? '\u2713 Unwatched' : '\u{1F441} Unwatched'}
</button>
```

- [ ] **Step 3: Show watched count next to total**

In the count display area (around line 187), after the hidden count span, add:

```tsx
{watchedCount.value > 0 && !hideWatched.value && (
	<span class={styles.hiddenCount}> ({watchedCount.value} watched)</span>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/packages/client/src/pages/Library.tsx
git commit -m "feat: add Unwatched toggle button to library toolbar"
```

---

### Task 9: Client — Add watched/unwatched toggle to movie context menu

**Files:**
- Modify: `src/packages/client/src/components/movie/MovieOptionsMenu.tsx`

- [ ] **Step 1: Import moviesService methods**

The `moviesService` import is already present. No additional import needed.

- [ ] **Step 2: Add the watched toggle handler**

Inside the `MovieOptionsMenu` component, add this handler after `handleHideToggle`:

```typescript
const handleWatchedToggle = useCallback(
	async (e: Event) => {
		e.stopPropagation();
		try {
			if (movie.watched) {
				await moviesService.markUnwatched(movie.id);
				onMovieUpdate?.({ ...movie, watched: false });
				notifySuccess('Marked as unwatched');
			} else {
				await moviesService.markWatched(movie.id);
				onMovieUpdate?.({ ...movie, watched: true });
				notifySuccess('Marked as watched');
			}
			setOpen(false);
		} catch {
			notifyError('Failed to update watched status');
		}
	},
	[movie, onMovieUpdate],
);
```

- [ ] **Step 3: Add the menu item**

In the menu JSX, after the "Hide from Library" button (after line 261), add:

```tsx
<button class={styles.menuItem} onClick={handleWatchedToggle}>
	<span class={styles.menuIcon}>{movie.watched ? '\u21A9' : '\u2713'}</span>
	{movie.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
</button>
```

- [ ] **Step 4: Commit**

```bash
git add src/packages/client/src/components/movie/MovieOptionsMenu.tsx
git commit -m "feat: add watched/unwatched toggle to movie context menu"
```

---

### Task 10: Client — Add watched threshold setting in Settings > General

**Files:**
- Modify: `src/packages/client/src/pages/Settings.tsx`

- [ ] **Step 1: Add state for the watched threshold**

In the Settings component, near the other state declarations for General tab settings, add:

```typescript
const [watchedThreshold, setWatchedThreshold] = useState(30);
```

- [ ] **Step 2: Load the setting on mount**

In the existing `useEffect` that loads settings (find the one that calls `api.get('/settings/...')`), add loading of the watched threshold. If settings are loaded per-tab, add it where general settings are loaded:

```typescript
// Load watched threshold
api.get<{ value: number }>('/settings/watchedThresholdSeconds')
	.then((res) => {
		if (res?.value) setWatchedThreshold(res.value);
	})
	.catch(() => {});
```

- [ ] **Step 3: Add the UI in the General tab**

In the General tab panel, after the "Display" section, add a new "Watch Tracking" section:

```tsx
<h3 class={styles.sectionTitle}>Watch Tracking</h3>

<div class={styles.settingRow}>
	<div class={styles.settingInfo}>
		<span class={styles.settingLabel}>Watched Threshold</span>
		<span class={styles.settingDescription}>
			Mark movies as "watched" after this many seconds of cumulative
			play time. Range: 4–1800 seconds (30 minutes).
		</span>
	</div>
	<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
		<input
			type="number"
			class={styles.select}
			min={4}
			max={1800}
			value={watchedThreshold}
			onInput={(e) => {
				const val = parseInt((e.target as HTMLInputElement).value, 10);
				if (!isNaN(val)) setWatchedThreshold(val);
			}}
			style={{ width: '80px' }}
		/>
		<span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
			seconds
		</span>
	</div>
</div>
```

- [ ] **Step 4: Save the setting**

Find the existing save handler for general settings (likely `handleSaveRating` or a general save function). Add saving the threshold to it, or create a dedicated save if the tab uses per-section saves:

```typescript
await api.put('/settings/watchedThresholdSeconds', {
	value: Math.max(4, Math.min(1800, watchedThreshold)),
});
```

- [ ] **Step 5: Commit**

```bash
git add src/packages/client/src/pages/Settings.tsx
git commit -m "feat: add watched threshold setting to Settings > General"
```

---

### Task 11: Client — Add "Clear Watched History" to Admin Dashboard

**Files:**
- Modify: `src/packages/client/src/pages/AdminDashboard.tsx`

- [ ] **Step 1: Add state variables**

In the AdminDashboard component, add:

```typescript
const [clearingWatched, setClearingWatched] = useState(false);
const [showClearWatchedConfirm, setShowClearWatchedConfirm] = useState(false);
const [watchedMovieCount, setWatchedMovieCount] = useState(0);
```

- [ ] **Step 2: Fetch watched count on mount**

In the existing `loadData` function or the component's initial `useEffect`, add:

```typescript
api.get<{ count: number }>('/history/watched/count')
	.then((res) => setWatchedMovieCount(res.count))
	.catch(() => {});
```

- [ ] **Step 3: Add the clear handler**

```typescript
const handleClearWatched = useCallback(async () => {
	setClearingWatched(true);
	try {
		const result = await api.delete<{ clearedCount: number }>('/history/watched');
		notifySuccess(`Cleared watched status for ${result.clearedCount} movie(s)`);
		setWatchedMovieCount(0);
		fetchMovies(1);
	} catch {
		notifyError('Failed to clear watched history');
	} finally {
		setClearingWatched(false);
	}
}, []);
```

Import `fetchMovies` from `@/state/library.state` (already imported from earlier work).

- [ ] **Step 4: Add button and confirm dialog**

In the admin actions section, after the existing "Remove Broken Movies" button, add:

```tsx
<Button
	variant="danger"
	onClick={() => setShowClearWatchedConfirm(true)}
	loading={clearingWatched}
>
	Clear Watched History
</Button>
```

After the existing `ConfirmDialog` for broken movies, add:

```tsx
<ConfirmDialog
	isOpen={showClearWatchedConfirm}
	onClose={() => setShowClearWatchedConfirm(false)}
	onConfirm={handleClearWatched}
	title="Clear Watched History"
	message={`This will reset the "watched" status for ${watchedMovieCount} movie(s). Resume positions will be preserved. This cannot be undone.`}
	confirmLabel="Clear Watched History"
	variant="danger"
/>
```

- [ ] **Step 5: Commit**

```bash
git add src/packages/client/src/pages/AdminDashboard.tsx
git commit -m "feat: add Clear Watched History button to admin dashboard"
```

---

### Task 12: Client — Add "View Unwatched" toggle to Watchlist page

**Files:**
- Modify: `src/packages/client/src/pages/Watchlist.tsx`

- [ ] **Step 1: Add state and import**

```typescript
import { moviesService } from '@/services/movies.service';

// Inside the component:
const [viewingUnwatched, setViewingUnwatched] = useState(false);
```

- [ ] **Step 2: Add effect to load unwatched movies when toggle is active**

After the existing `useEffect` that loads watchlist data, add:

```typescript
useEffect(() => {
	if (!viewingUnwatched) return;
	setIsLoading(true);
	moviesService
		.list({ hideWatched: 'true', pageSize: '200', sortBy: 'addedAt', sortOrder: 'desc' })
		.then((response) => {
			setMovies(response.movies);
		})
		.catch((error) => {
			console.error('Failed to load unwatched movies:', error);
		})
		.finally(() => {
			setIsLoading(false);
		});
}, [viewingUnwatched]);
```

Also modify the existing watchlist load effect to only run when `viewingUnwatched` is false:

```typescript
useEffect(() => {
	if (viewingUnwatched) return;
	async function load() {
		// ... existing watchlist loading code ...
	}
	load();
}, [viewingUnwatched]);
```

- [ ] **Step 3: Add toggle button in the header**

In the header section, after the count span, add:

```tsx
<button
	class={`${styles.toggleBtn ?? ''} ${viewingUnwatched ? styles.active ?? '' : ''}`}
	onClick={() => setViewingUnwatched(!viewingUnwatched)}
	style={{
		padding: '4px 12px',
		borderRadius: 'var(--radius-md)',
		border: '1px solid var(--color-border)',
		background: viewingUnwatched ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
		color: viewingUnwatched ? '#fff' : 'var(--color-text-secondary)',
		cursor: 'pointer',
		fontSize: 'var(--font-size-sm)',
		marginLeft: 'var(--space-md)',
	}}
>
	{viewingUnwatched ? 'View Watchlist' : 'View Unwatched'}
</button>
```

- [ ] **Step 4: Update the empty message**

Update the `MovieGrid` emptyMessage prop to be context-aware:

```tsx
<MovieGrid
	movies={movies}
	isLoading={isLoading}
	emptyMessage={
		viewingUnwatched
			? "All movies have been watched! Nice."
			: "Your watchlist is empty. Browse the library and add movies you want to watch."
	}
/>
```

- [ ] **Step 5: Update the count display**

```tsx
{movies.length > 0 && (
	<span class={styles.count}>
		{movies.length} {viewingUnwatched ? 'unwatched' : ''} {movies.length === 1 ? 'movie' : 'movies'}
	</span>
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/packages/client/src/pages/Watchlist.tsx
git commit -m "feat: add View Unwatched toggle to Watchlist page"
```

---

### Task 13: Integration verification

- [ ] **Step 1: Build shared package**

```bash
cd src && pnpm build --filter=@mu/shared
```

Expected: builds without errors.

- [ ] **Step 2: Build server**

```bash
pnpm build --filter=@mu/server
```

Expected: builds without errors.

- [ ] **Step 3: Build client**

```bash
pnpm build --filter=@mu/client
```

Expected: builds without errors.

- [ ] **Step 4: Run biome check**

```bash
npx biome check --write --unsafe .
```

Expected: no errors (warnings about unused params are acceptable).

- [ ] **Step 5: Final commit with any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for watched movies feature"
```

(Skip if no changes.)

import type { EntityRef, MusicOfflinePolicy, TrackSummary } from '@mu/shared';
import { computed, effect, signal } from '@preact/signals';
import { musicService } from '@/services/music.service';
import {
	loadManifest,
	OFFLINE_CACHE,
	type OfflineGroup,
	type OfflineGroupKind,
	type OfflineManifest,
	type OfflineTrack,
	offlineFileKey,
	saveManifest,
} from '@/services/music-offline-index';
import { currentUser } from '@/state/auth.state';
import { musicEnabled } from '@/state/features.state';
import { notifyError, notifyInfo, notifySuccess } from '@/state/notifications.state';
import { clearMine, setMine, userSettings } from '@/state/userSettings.state';

/**
 * Offline music downloads (docs/music-support-plan.md §6.5).
 *
 * The page fetches short-lived signed URLs (`POST /music/offline/token`),
 * downloads each track at the admin's download profile and stores the bytes
 * in Cache Storage (`music-offline`) under a per-track-file key. The service
 * worker serves `/music/files/<id>` from there with Range support, so the
 * normal player plays offline copies transparently; `musicService.startStream`
 * falls back to a local session when the server is unreachable.
 *
 * Budget: min(user `music.offlineMaxGb`, admin `maxOfflineGbPerDevice`).
 * Over budget → evict least-recently-played tracks whose album/playlist is
 * not marked "Keep".
 */

const GB = 1024 * 1024 * 1024;
const TOKEN_BATCH = 200;
const USER_LIMIT_KEY = 'music.offlineMaxGb';

export const offlineManifest = signal<OfflineManifest>(loadManifest());
export const offlinePolicy = signal<MusicOfflinePolicy | null>(null);

export interface DownloadJob {
	title: string;
	done: number;
	total: number;
	failed: number;
}
export const downloadJobs = signal<Record<string, DownloadJob>>({});

export const storageInfo = signal<{ usage: number; quota: number; persisted: boolean } | null>(
	null,
);

export const offlineBytes = computed(() =>
	Object.values(offlineManifest.value.tracks).reduce((s, t) => s + (t.bytes || 0), 0),
);

/** The user's own limit (GB), or null when unset (= admin cap). */
export const userOfflineLimitGb = computed(() => {
	const v = Number(userSettings.value[USER_LIMIT_KEY]);
	return Number.isFinite(v) && v > 0 ? v : null;
});

/** Effective per-device budget in GB. */
export const offlineBudgetGb = computed(() => {
	const cap = offlinePolicy.value?.maxOfflineGbPerDevice ?? 10;
	const mine = userOfflineLimitGb.value;
	return mine === null ? cap : Math.min(mine, cap);
});

export const offlineAllowed = computed(() => !!offlinePolicy.value?.allowed);

const controllers = new Map<string, AbortController>();

function commit(m: OfflineManifest): void {
	const next = { tracks: { ...m.tracks }, groups: { ...m.groups } };
	saveManifest(next);
	offlineManifest.value = next;
}

export function groupKey(kind: OfflineGroupKind, id: string): string {
	return `${kind}:${id}`;
}

export function isTrackOffline(trackId: string): boolean {
	return !!offlineManifest.value.tracks[trackId];
}

export type GroupStatus = 'none' | 'downloading' | 'partial' | 'downloaded';

export function groupStatus(key: string): GroupStatus {
	if (downloadJobs.value[key]) return 'downloading';
	const g = offlineManifest.value.groups[key];
	if (!g) return 'none';
	const have = g.trackIds.filter((id) => offlineManifest.value.tracks[id]).length;
	if (have === 0) return 'none';
	return have >= g.trackIds.length ? 'downloaded' : 'partial';
}

async function openCache(): Promise<Cache | null> {
	if (typeof caches === 'undefined') return null;
	try {
		return await caches.open(OFFLINE_CACHE);
	} catch {
		return null;
	}
}

export async function refreshStorageInfo(): Promise<void> {
	if (!navigator.storage?.estimate) return;
	try {
		const est = await navigator.storage.estimate();
		const persisted = (await navigator.storage.persisted?.()) ?? false;
		storageInfo.value = { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
	} catch {
		// Unsupported / denied.
	}
}

let persistAsked = false;
async function askPersist(): Promise<void> {
	if (persistAsked || !navigator.storage?.persist) return;
	persistAsked = true;
	await navigator.storage.persist().catch(() => false);
}

async function deleteTrackBytes(cache: Cache | null, t: OfflineTrack): Promise<void> {
	await cache?.delete(offlineFileKey(t.trackFileId)).catch(() => false);
}

function isKept(m: OfflineManifest, t: OfflineTrack): boolean {
	return t.groups.some((k) => m.groups[k]?.keep);
}

/**
 * Evict least-recently-used, un-kept tracks (outside `protect`) until the
 * total fits `budgetBytes`. Returns false when it can't fit.
 */
async function enforceBudget(protect: Set<string>, extraBytes = 0): Promise<boolean> {
	const budget = offlineBudgetGb.value * GB;
	const m = offlineManifest.value;
	let total = offlineBytes.value + extraBytes;
	if (total <= budget) return true;
	const cache = await openCache();
	const victims = Object.values(m.tracks)
		.filter((t) => !protect.has(t.track.id) && !isKept(m, t))
		.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
	const tracks = { ...m.tracks };
	for (const v of victims) {
		if (total <= budget) break;
		await deleteTrackBytes(cache, v);
		delete tracks[v.track.id];
		total -= v.bytes;
	}
	commit({ ...m, tracks });
	return total <= budget;
}

async function fetchWithProgress(url: string, signal: AbortSignal): Promise<Blob> {
	const res = await fetch(url, { signal, credentials: 'omit' });
	if (!res.ok) {
		let msg = `Download failed (HTTP ${res.status})`;
		try {
			const body = (await res.json()) as { message?: string };
			if (body?.message) msg = body.message;
		} catch {
			// not JSON
		}
		throw new Error(msg);
	}
	return res.blob();
}

const artCached = new Set<string>();
async function cacheArt(cache: Cache, artUrl: string | null): Promise<void> {
	if (!artUrl || artCached.has(artUrl)) return;
	artCached.add(artUrl);
	try {
		const res = await fetch(artUrl, { credentials: 'same-origin' });
		if (res.ok) await cache.put(new URL(artUrl, location.origin).href, res);
	} catch {
		// Art is optional.
	}
}

/**
 * Download tracks as one album / playlist / single-track group. Tracks
 * already on the device just join the group.
 */
export async function downloadTracks(
	group: { kind: OfflineGroupKind; id: string; title: string },
	tracks: TrackSummary[],
): Promise<void> {
	const key = groupKey(group.kind, group.id);
	if (downloadJobs.value[key]) return;
	if (!offlinePolicy.value) await loadOfflinePolicy();
	if (!offlinePolicy.value?.allowed) {
		notifyError('Offline downloads are not allowed for your account');
		return;
	}
	const cache = await openCache();
	if (!cache) {
		notifyError('This browser cannot store offline music');
		return;
	}
	if (tracks.length === 0) return;
	void askPersist();

	const ids = [...new Set(tracks.map((t) => t.id))];
	const byId = new Map(tracks.map((t) => [t.id, t]));
	const now = Date.now();
	{
		const m = offlineManifest.value;
		const prev = m.groups[key];
		const g: OfflineGroup = {
			key,
			kind: group.kind,
			id: group.id,
			title: group.title,
			keep: prev?.keep ?? false,
			trackIds: ids,
			addedAt: prev?.addedAt ?? now,
		};
		const tracksMap = { ...m.tracks };
		for (const id of ids) {
			const t = tracksMap[id];
			if (t && !t.groups.includes(key)) tracksMap[id] = { ...t, groups: [...t.groups, key] };
		}
		commit({ tracks: tracksMap, groups: { ...m.groups, [key]: g } });
	}

	const todo = ids.filter((id) => !offlineManifest.value.tracks[id]);
	const job: DownloadJob = {
		title: group.title,
		done: ids.length - todo.length,
		total: ids.length,
		failed: 0,
	};
	const setJob = () => {
		downloadJobs.value = { ...downloadJobs.value, [key]: { ...job } };
	};
	setJob();
	const controller = new AbortController();
	controllers.set(key, controller);
	const protect = new Set(ids);
	let stopReason: string | null = null;

	try {
		for (let i = 0; i < todo.length && !stopReason; i += TOKEN_BATCH) {
			const batch = todo.slice(i, i + TOKEN_BATCH);
			const res = await musicService.offlineTokens(batch);
			job.failed += res.missing.length;
			for (const item of res.items) {
				if (controller.signal.aborted) {
					stopReason = 'cancelled';
					break;
				}
				const summary = byId.get(item.trackId);
				if (!summary) continue;
				try {
					const blob = await fetchWithProgress(item.url, controller.signal);
					if (!(await enforceBudget(protect, blob.size))) {
						stopReason = `Offline storage limit reached (${offlineBudgetGb.value} GB)`;
						break;
					}
					await cache.put(
						offlineFileKey(item.trackFileId),
						new Response(blob, {
							headers: {
								'Content-Type': blob.type || 'application/octet-stream',
								'Content-Length': String(blob.size),
							},
						}),
					);
					void cacheArt(cache, summary.artUrl);
					const m = offlineManifest.value;
					const ts = Date.now();
					commit({
						...m,
						tracks: {
							...m.tracks,
							[item.trackId]: {
								track: summary,
								trackFileId: item.trackFileId,
								profile: item.profile,
								codec: item.codec,
								bytes: blob.size,
								groups: Object.values(m.groups)
									.filter((g) => g.trackIds.includes(item.trackId))
									.map((g) => g.key),
								addedAt: ts,
								lastUsedAt: ts,
							},
						},
					});
					job.done++;
				} catch (err) {
					if (controller.signal.aborted) {
						stopReason = 'cancelled';
						break;
					}
					job.failed++;
					if ((err as Error)?.name === 'QuotaExceededError') {
						stopReason = 'The browser ran out of storage for offline music';
					}
				}
				setJob();
			}
		}
	} catch (err) {
		stopReason =
			(err as { body?: { message?: string } })?.body?.message ||
			(err as Error)?.message ||
			'Download failed';
	} finally {
		controllers.delete(key);
		const { [key]: _, ...rest } = downloadJobs.value;
		downloadJobs.value = rest;
		void refreshStorageInfo();
	}

	if (stopReason === 'cancelled') notifyInfo(`Stopped downloading "${group.title}"`);
	else if (stopReason) notifyError(stopReason);
	else if (job.failed) notifyError(`Downloaded "${group.title}" — ${job.failed} track(s) failed`);
	else notifySuccess(`"${group.title}" is available offline`);
}

/** Download a track or album from an entity menu. */
export async function downloadEntity(ref: EntityRef): Promise<void> {
	try {
		if (ref.type === 'track') {
			const t = await musicService.track(ref.id);
			await downloadTracks({ kind: 'track', id: t.id, title: t.title }, [t]);
		} else if (ref.type === 'album') {
			const a = await musicService.album(ref.id);
			await downloadTracks({ kind: 'album', id: a.id, title: a.title }, a.tracks);
		}
	} catch (err) {
		notifyError((err as Error)?.message || 'Download failed');
	}
}

export function cancelDownload(key: string): void {
	controllers.get(key)?.abort();
}

/** Remove a group; tracks no other group holds are deleted from the device. */
export async function removeGroup(key: string): Promise<void> {
	cancelDownload(key);
	const m = offlineManifest.value;
	const g = m.groups[key];
	if (!g) return;
	const cache = await openCache();
	const tracks = { ...m.tracks };
	for (const id of g.trackIds) {
		const t = tracks[id];
		if (!t) continue;
		const groups = t.groups.filter((k) => k !== key);
		if (groups.length === 0) {
			await deleteTrackBytes(cache, t);
			delete tracks[id];
		} else {
			tracks[id] = { ...t, groups };
		}
	}
	const { [key]: _, ...groups } = m.groups;
	commit({ tracks, groups });
	void refreshStorageInfo();
}

export function setKeep(key: string, keep: boolean): void {
	const m = offlineManifest.value;
	const g = m.groups[key];
	if (!g) return;
	commit({ ...m, groups: { ...m.groups, [key]: { ...g, keep } } });
}

export async function clearOfflineMusic(): Promise<void> {
	for (const c of controllers.values()) c.abort();
	if (typeof caches !== 'undefined') await caches.delete(OFFLINE_CACHE).catch(() => false);
	artCached.clear();
	commit({ tracks: {}, groups: {} });
	void refreshStorageInfo();
}

/** Set (GB) or clear (null) the user's own limit; applies the budget right away. */
export async function setUserOfflineLimitGb(gb: number | null): Promise<void> {
	if (gb === null) await clearMine(USER_LIMIT_KEY);
	else await setMine(USER_LIMIT_KEY, gb);
	await enforceBudget(new Set());
}

export async function loadOfflinePolicy(): Promise<void> {
	try {
		offlinePolicy.value = await musicService.offlinePolicy();
	} catch {
		offlinePolicy.value = null;
	}
}

/** Drop manifest rows whose bytes the browser evicted. */
async function reconcile(): Promise<void> {
	const cache = await openCache();
	if (!cache) return;
	const keys = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
	const m = offlineManifest.value;
	const tracks = { ...m.tracks };
	let changed = false;
	for (const [id, t] of Object.entries(tracks)) {
		if (!keys.has(offlineFileKey(t.trackFileId))) {
			delete tracks[id];
			changed = true;
		}
	}
	if (changed) commit({ ...m, tracks });
}

let lastHitSave = 0;
function onSwMessage(e: MessageEvent): void {
	const data = e.data as { type?: string; trackFileId?: string } | null;
	if (data?.type !== 'music-offline-hit' || !data.trackFileId) return;
	const m = offlineManifest.value;
	const hit = Object.values(m.tracks).find((t) => t.trackFileId === data.trackFileId);
	if (!hit) return;
	hit.lastUsedAt = Date.now();
	// Range requests hit many times per play; persist at most every 30s.
	if (Date.now() - lastHitSave > 30_000) {
		lastHitSave = Date.now();
		commit(m);
	}
}

let initialised = false;
export function initMusicOffline(): void {
	if (initialised) return;
	initialised = true;
	navigator.serviceWorker?.addEventListener('message', onSwMessage);
	void reconcile();
	effect(() => {
		if (musicEnabled.value && currentUser.value) void loadOfflinePolicy();
	});
}

import { type EntityRef, entityMediaKind, type MediaKind } from '@mu/shared';
import { computed, type Signal } from '@preact/signals';
import { getUiSettingSignal, setUiSetting } from '@/hooks/useUiSetting';

/**
 * One entry in a play queue.
 *
 * Deliberately denormalised — title and artwork are copied in at enqueue time
 * so the queue panel renders instantly from localStorage on a cold load, with
 * no fetch per row. If an entity is later renamed the queue entry goes slightly
 * stale, which is a fair trade for a list the user is about to consume.
 *
 * `ref` is polymorphic so the same queue machinery serves movies (video) and,
 * later, tracks (audio). For movies `subtitle` holds the release year.
 */
export interface QueueItem {
	ref: EntityRef;
	title: string;
	subtitle?: string | null;
	artUrl?: string | null;
	durationSeconds?: number | null;
}

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Persisted key per media kind. Video keeps the original `play_queue` key so
 * existing users' queues survive the upgrade (migrated in place below).
 */
const QUEUE_KEYS: Record<MediaKind, string> = {
	video: 'play_queue',
	audio: 'play_queue_audio',
};

/** Shape persisted before queues became polymorphic (movies only). */
interface LegacyQueueItem {
	movieId: string;
	title: string;
	posterUrl?: string | null;
	year?: number | null;
}

function isLegacyItem(v: unknown): v is LegacyQueueItem {
	return (
		!!v &&
		typeof v === 'object' &&
		typeof (v as LegacyQueueItem).movieId === 'string' &&
		!('ref' in (v as object))
	);
}

function isQueueItem(v: unknown): v is QueueItem {
	const ref = (v as QueueItem | null)?.ref;
	return !!ref && typeof ref.type === 'string' && typeof ref.id === 'string';
}

/**
 * Normalise whatever is in storage into the current shape. Old
 * `{movieId,title,posterUrl,year}` entries become movie refs; anything
 * unrecognisable is dropped rather than crashing the panel.
 */
function migrate(raw: unknown): { items: QueueItem[]; changed: boolean } {
	if (!Array.isArray(raw)) return { items: [], changed: raw != null };
	let changed = false;
	const items: QueueItem[] = [];
	for (const entry of raw) {
		if (isQueueItem(entry)) {
			items.push(entry);
		} else if (isLegacyItem(entry)) {
			changed = true;
			items.push({
				ref: { type: 'movie', id: entry.movieId },
				title: entry.title,
				subtitle: entry.year ? String(entry.year) : null,
				artUrl: entry.posterUrl ?? null,
			});
		} else {
			changed = true;
		}
	}
	return { items, changed };
}

function createQueueSignal(kind: MediaKind): Signal<QueueItem[]> {
	const key = QUEUE_KEYS[kind];
	const s = getUiSettingSignal<QueueItem[]>(key, []);
	const { items, changed } = migrate(s.value);
	if (changed) setUiSetting(key, items);
	return s;
}

/**
 * The queues, persisted through the same uiSetting layer as the rest of the
 * view state so they survive a refresh and stay in sync across components.
 * Index 0 is "up next".
 */
const queues: Record<MediaKind, Signal<QueueItem[]>> = {
	video: createQueueSignal('video'),
	audio: createQueueSignal('audio'),
};

export function getQueue(kind: MediaKind): Signal<QueueItem[]> {
	return queues[kind];
}

/** The video (movie) queue. Kept as a named export for existing callers. */
export const playQueue = queues.video;
export const audioQueue = queues.audio;

/** Video-queue size / presence. */
export const queueCount = computed(() => playQueue.value.length);
export const hasQueue = computed(() => playQueue.value.length > 0);
/** Audio-queue size ("up next" badge while music is active). */
export const audioQueueCount = computed(() => audioQueue.value.length);

// ── Audio-only playback modes (persisted) ──

export const audioRepeat = getUiSettingSignal<RepeatMode>('play_queue_audio_repeat', 'off');
export const audioShuffle = getUiSettingSignal<boolean>('play_queue_audio_shuffle', false);

export function setAudioRepeat(mode: RepeatMode): void {
	setUiSetting('play_queue_audio_repeat', mode);
}

export function setAudioShuffle(on: boolean): void {
	setUiSetting('play_queue_audio_shuffle', on);
}

// ── Helpers ──

function kindOf(ref: EntityRef): MediaKind {
	return entityMediaKind(ref.type) ?? 'video';
}

function sameRef(a: EntityRef, b: EntityRef): boolean {
	return a.type === b.type && a.id === b.id;
}

/** Stable string key for an entity ref (list keys, de-dupe). */
export function queueItemKey(item: QueueItem): string {
	return `${item.ref.type}:${item.ref.id}`;
}

function write(kind: MediaKind, next: QueueItem[]): void {
	setUiSetting(QUEUE_KEYS[kind], next);
}

/** Drop any existing entry for an entity — an item appears at most once. */
function without(list: QueueItem[], ref: EntityRef): QueueItem[] {
	return list.filter((i) => !sameRef(i.ref, ref));
}

// ── Actions ──

/** Append to the end of its kind's queue. Re-queueing an item moves it to the end. */
export function addToQueue(item: QueueItem): void {
	const kind = kindOf(item.ref);
	write(kind, [...without(queues[kind].value, item.ref), item]);
}

/** Insert at the front, so it plays as soon as the current item finishes. */
export function playNext(item: QueueItem): void {
	const kind = kindOf(item.ref);
	write(kind, [item, ...without(queues[kind].value, item.ref)]);
}

export function removeFromQueue(ref: EntityRef): void {
	const kind = kindOf(ref);
	write(kind, without(queues[kind].value, ref));
}

export function clearQueue(kind: MediaKind = 'video'): void {
	write(kind, []);
}

/** Replace a kind's whole queue (album / playlist "play all", shuffle). */
export function setQueue(kind: MediaKind, items: QueueItem[]): void {
	write(kind, items);
}

/**
 * Move an entry, used by the panel's drag-and-drop reorder. Indices are
 * clamped so a drop past either end is a no-op rather than a crash.
 */
export function moveInQueue(from: number, to: number, kind: MediaKind = 'video'): void {
	const list = queues[kind].value;
	if (from === to || from < 0 || from >= list.length) return;
	const target = Math.max(0, Math.min(to, list.length - 1));
	const next = [...list];
	const [moved] = next.splice(from, 1);
	if (!moved) return;
	next.splice(target, 0, moved);
	write(kind, next);
}

/**
 * Pop the next entry off the front. Returns null when the queue is empty.
 * Used by the end-of-playback handler; removing before playing means an item
 * that fails to start can't wedge the queue in a retry loop.
 */
export function takeNextFromQueue(kind: MediaKind = 'video'): QueueItem | null {
	const [next, ...rest] = queues[kind].value;
	if (!next) return null;
	write(kind, rest);
	return next;
}

/** Jump straight to an entry, discarding everything queued ahead of it. */
export function takeFromQueue(ref: EntityRef): QueueItem | null {
	const kind = kindOf(ref);
	const list = queues[kind].value;
	const idx = list.findIndex((i) => sameRef(i.ref, ref));
	if (idx === -1) return null;
	write(kind, list.slice(idx + 1));
	return list[idx] ?? null;
}

export function isQueued(ref: EntityRef): boolean {
	return queues[kindOf(ref)].value.some((i) => sameRef(i.ref, ref));
}

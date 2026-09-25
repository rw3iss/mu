import { computed } from '@preact/signals';
import { getUiSettingSignal, setUiSetting } from '@/hooks/useUiSetting';

/**
 * One entry in the play queue.
 *
 * Deliberately denormalised — title and poster are copied in at enqueue time so
 * the queue panel renders instantly from localStorage on a cold load, with no
 * fetch per row. If a movie is later renamed the queue entry goes slightly
 * stale, which is a fair trade for a list the user is about to consume.
 */
export interface QueueItem {
	movieId: string;
	title: string;
	posterUrl?: string | null;
	year?: number | null;
}

const KEY = 'play_queue';

/**
 * The queue, persisted through the same uiSetting layer as the rest of the
 * view state so it survives a refresh and stays in sync across components.
 * Index 0 is "up next".
 */
export const playQueue = getUiSettingSignal<QueueItem[]>(KEY, []);

export const queueCount = computed(() => playQueue.value.length);
export const hasQueue = computed(() => playQueue.value.length > 0);

function write(next: QueueItem[]): void {
	setUiSetting(KEY, next);
}

/** Drop any existing entry for a movie — a title appears at most once. */
function without(list: QueueItem[], movieId: string): QueueItem[] {
	return list.filter((i) => i.movieId !== movieId);
}

/** Append to the end of the queue. Re-queueing a title moves it to the end. */
export function addToQueue(item: QueueItem): void {
	write([...without(playQueue.value, item.movieId), item]);
}

/** Insert at the front, so it plays as soon as the current title finishes. */
export function playNext(item: QueueItem): void {
	write([item, ...without(playQueue.value, item.movieId)]);
}

export function removeFromQueue(movieId: string): void {
	write(without(playQueue.value, movieId));
}

export function clearQueue(): void {
	write([]);
}

/**
 * Move an entry, used by the panel's drag-and-drop reorder. Indices are
 * clamped so a drop past either end is a no-op rather than a crash.
 */
export function moveInQueue(from: number, to: number): void {
	const list = playQueue.value;
	if (from === to || from < 0 || from >= list.length) return;
	const target = Math.max(0, Math.min(to, list.length - 1));
	const next = [...list];
	const [moved] = next.splice(from, 1);
	if (!moved) return;
	next.splice(target, 0, moved);
	write(next);
}

/**
 * Pop the next entry off the front. Returns null when the queue is empty.
 * Used by the end-of-playback handler; removing before playing means a title
 * that fails to start can't wedge the queue in a retry loop.
 */
export function takeNextFromQueue(): QueueItem | null {
	const [next, ...rest] = playQueue.value;
	if (!next) return null;
	write(rest);
	return next;
}

/** Jump straight to an entry, discarding everything queued ahead of it. */
export function takeFromQueue(movieId: string): QueueItem | null {
	const list = playQueue.value;
	const idx = list.findIndex((i) => i.movieId === movieId);
	if (idx === -1) return null;
	write(list.slice(idx + 1));
	return list[idx] ?? null;
}

export function isQueued(movieId: string): boolean {
	return playQueue.value.some((i) => i.movieId === movieId);
}

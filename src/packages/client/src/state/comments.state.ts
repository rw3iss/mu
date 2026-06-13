import { signal } from '@preact/signals';
import { commentsService, type MovieComment } from '@/services/comments.service';

/**
 * Per-movie comment cache. One signal holding a map keyed by movieId so any
 * surface (detail page, info panels, seek-bar bubbles) re-renders when a
 * movie's comments change. Mutations replace the movie's entry with the
 * fresh tree the server returns (its cache is busted server-side).
 */
export const movieComments = signal<Record<string, MovieComment[]>>({});

const inflight = new Map<string, Promise<MovieComment[]>>();

function put(movieId: string, list: MovieComment[]): MovieComment[] {
	movieComments.value = { ...movieComments.value, [movieId]: list };
	return list;
}

export function getComments(movieId: string): MovieComment[] | null {
	return movieComments.value[movieId] ?? null;
}

/** Flat list of time-anchored comments (for seek-bar bubbles). */
export function getTimedComments(movieId: string): MovieComment[] {
	const list = movieComments.value[movieId] ?? [];
	const out: MovieComment[] = [];
	const walk = (nodes: MovieComment[]) => {
		for (const c of nodes) {
			if (c.timeSeconds != null) out.push(c);
			if (c.replies?.length) walk(c.replies);
		}
	};
	walk(list);
	return out;
}

export function countComments(movieId: string): number {
	const list = movieComments.value[movieId] ?? [];
	const count = (nodes: MovieComment[]): number =>
		nodes.reduce((n, c) => n + 1 + (c.replies ? count(c.replies) : 0), 0);
	return count(list);
}

export async function loadComments(movieId: string, force = false): Promise<MovieComment[]> {
	if (!force && movieComments.value[movieId]) return movieComments.value[movieId]!;
	const existing = inflight.get(movieId);
	if (existing) return existing;
	const p = commentsService
		.list(movieId)
		.then((r) => put(movieId, r.comments))
		.finally(() => inflight.delete(movieId));
	inflight.set(movieId, p);
	return p;
}

export async function addComment(
	movieId: string,
	body: { text: string; timeSeconds?: number | null; parentId?: string | null },
) {
	const r = await commentsService.create(movieId, body);
	return put(movieId, r.comments);
}

export async function editComment(
	movieId: string,
	id: string,
	body: { text?: string; timeSeconds?: number | null },
) {
	const r = await commentsService.update(id, body);
	return put(movieId, r.comments);
}

export async function deleteComment(movieId: string, id: string) {
	const r = await commentsService.remove(id);
	return put(movieId, r.comments);
}

export async function reactToComment(movieId: string, id: string, emoji: string) {
	const r = await commentsService.react(id, emoji);
	return put(movieId, r.comments);
}

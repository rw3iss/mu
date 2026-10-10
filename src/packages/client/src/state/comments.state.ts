import type { EntityRef } from '@mu/shared';
import { signal } from '@preact/signals';
import { commentsService, type MovieComment } from '@/services/comments.service';
import { entitiesService } from '@/services/entities.service';

/**
 * A comment target: a bare string is a movie id (legacy callers); an
 * EntityRef targets any entity via the generic /entities endpoints.
 */
export type CommentTarget = string | EntityRef;

/** Cache key — movies keep their bare id so existing readers still work. */
export function commentKey(t: CommentTarget): string {
	if (typeof t === 'string') return t;
	return t.type === 'movie' ? t.id : `${t.type}:${t.id}`;
}

function asRef(t: CommentTarget): EntityRef {
	return typeof t === 'string' ? { type: 'movie', id: t } : t;
}

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

export async function loadComments(target: CommentTarget, force = false): Promise<MovieComment[]> {
	const key = commentKey(target);
	if (!force && movieComments.value[key]) return movieComments.value[key]!;
	const existing = inflight.get(key);
	if (existing) return existing;
	const ref = asRef(target);
	const req =
		ref.type === 'movie' ? commentsService.list(ref.id) : entitiesService.listComments(ref);
	const p = req.then((r) => put(key, r.comments)).finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}

export async function addComment(
	target: CommentTarget,
	body: { text: string; timeSeconds?: number | null; parentId?: string | null },
) {
	const ref = asRef(target);
	const r =
		ref.type === 'movie'
			? await commentsService.create(ref.id, body)
			: await entitiesService.createComment(ref, body);
	return put(commentKey(target), r.comments);
}

export async function editComment(
	target: CommentTarget,
	id: string,
	body: { text?: string; timeSeconds?: number | null },
) {
	const r = await commentsService.update(id, body);
	return put(commentKey(target), r.comments);
}

export async function deleteComment(target: CommentTarget, id: string) {
	const r = await commentsService.remove(id);
	return put(commentKey(target), r.comments);
}

export async function reactToComment(target: CommentTarget, id: string, emoji: string) {
	const r = await commentsService.react(id, emoji);
	return put(commentKey(target), r.comments);
}

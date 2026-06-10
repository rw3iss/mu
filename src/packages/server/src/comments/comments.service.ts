import { nowISO } from '@mu/shared';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { commentReactions, movieComments, users } from '../database/schema/index.js';

export interface CommentReactionSummary {
	emoji: string;
	count: number;
	/** Whether the requesting user reacted with this emoji. */
	mine: boolean;
}

export interface CommentView {
	id: string;
	movieId: string;
	userId: string;
	parentId: string | null;
	timeSeconds: number | null;
	text: string;
	edited: boolean;
	createdAt: string;
	updatedAt: string;
	authorName: string;
	reactions: CommentReactionSummary[];
	replies?: CommentView[];
}

/** Raw cached shape — per-user `mine` flags are derived per request. */
interface RawComment extends Omit<CommentView, 'reactions' | 'replies'> {
	reactions: { emoji: string; userIds: string[] }[];
}

/**
 * Movie comments: general or time-anchored, one level of replies, emoji
 * reactions. Read path is cached per movie (raw, user-agnostic) and busted
 * on every mutation; the per-user `mine` flags are shaped per request.
 */
@Injectable()
export class CommentsService {
	constructor(private readonly database: DatabaseService) {}

	private readonly cache = new Map<string, { data: RawComment[]; expires: number }>();
	private static readonly TTL_MS = 5 * 60_000;

	bust(movieId: string): void {
		this.cache.delete(movieId);
	}

	/** Comment tree for a movie, shaped for `forUserId` (mine flags). */
	getForMovie(movieId: string, forUserId?: string): CommentView[] {
		const raw = this.getRaw(movieId);
		const shape = (c: RawComment): CommentView => ({
			...c,
			reactions: c.reactions.map((r) => ({
				emoji: r.emoji,
				count: r.userIds.length,
				mine: !!forUserId && r.userIds.includes(forUserId),
			})),
		});
		const top: CommentView[] = [];
		const byId = new Map<string, CommentView>();
		for (const c of raw) {
			const v = shape(c);
			byId.set(v.id, v);
			if (!v.parentId) {
				v.replies = [];
				top.push(v);
			}
		}
		for (const c of raw) {
			if (!c.parentId) continue;
			const parent = byId.get(c.parentId);
			if (parent) parent.replies!.push(byId.get(c.id)!);
			else top.push(byId.get(c.id)!); // orphan (parent deleted) — show flat
		}
		return top;
	}

	count(movieId: string): number {
		return this.getRaw(movieId).length;
	}

	private getRaw(movieId: string): RawComment[] {
		const hit = this.cache.get(movieId);
		if (hit && hit.expires > Date.now()) return hit.data;

		const rows = this.database.db
			.select({
				id: movieComments.id,
				movieId: movieComments.movieId,
				userId: movieComments.userId,
				parentId: movieComments.parentId,
				timeSeconds: movieComments.timeSeconds,
				text: movieComments.text,
				edited: movieComments.edited,
				createdAt: movieComments.createdAt,
				updatedAt: movieComments.updatedAt,
				authorName: sql<string>`COALESCE(${users.displayName}, ${users.username}, 'Unknown')`,
			})
			.from(movieComments)
			.leftJoin(users, eq(movieComments.userId, users.id))
			.where(eq(movieComments.movieId, movieId))
			.orderBy(asc(movieComments.createdAt))
			.all();

		const reactions = rows.length
			? this.database.db
					.select()
					.from(commentReactions)
					.where(
						sql`${commentReactions.commentId} IN (SELECT id FROM movie_comments WHERE movie_id = ${movieId})`,
					)
					.all()
			: [];

		const byComment = new Map<string, Map<string, string[]>>();
		for (const r of reactions) {
			let per = byComment.get(r.commentId);
			if (!per) byComment.set(r.commentId, (per = new Map()));
			(per.get(r.emoji) ?? per.set(r.emoji, []).get(r.emoji)!).push(r.userId);
		}

		const data: RawComment[] = rows.map((r) => ({
			...r,
			edited: !!r.edited,
			reactions: [...(byComment.get(r.id) ?? new Map()).entries()].map(
				([emoji, userIds]) => ({ emoji, userIds }),
			),
		}));
		this.cache.set(movieId, { data, expires: Date.now() + CommentsService.TTL_MS });
		return data;
	}

	create(
		movieId: string,
		userId: string,
		body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	) {
		const text = (body.text ?? '').trim();
		if (!text) throw new ForbiddenException('Comment text is required');
		if (body.parentId) {
			const parent = this.database.db
				.select({ id: movieComments.id, parentId: movieComments.parentId })
				.from(movieComments)
				.where(eq(movieComments.id, body.parentId))
				.get();
			if (!parent) throw new NotFoundException('Parent comment not found');
			// One level deep only — replying to a reply attaches to its parent.
			if (parent.parentId) body.parentId = parent.parentId;
		}
		const now = nowISO();
		const id = crypto.randomUUID();
		this.database.db
			.insert(movieComments)
			.values({
				id,
				movieId,
				userId,
				parentId: body.parentId ?? null,
				timeSeconds:
					typeof body.timeSeconds === 'number' && body.timeSeconds >= 0
						? body.timeSeconds
						: null,
				text: text.slice(0, 2000),
				createdAt: now,
				updatedAt: now,
			})
			.run();
		this.bust(movieId);
		return this.getForMovie(movieId, userId);
	}

	update(id: string, userId: string, body: { text?: string; timeSeconds?: number | null }) {
		const existing = this.requireOwn(id, userId);
		const patch: Record<string, unknown> = { updatedAt: nowISO(), edited: true };
		if (typeof body.text === 'string' && body.text.trim()) {
			patch.text = body.text.trim().slice(0, 2000);
		}
		if (body.timeSeconds !== undefined) {
			patch.timeSeconds =
				typeof body.timeSeconds === 'number' && body.timeSeconds >= 0
					? body.timeSeconds
					: null;
		}
		this.database.db.update(movieComments).set(patch).where(eq(movieComments.id, id)).run();
		this.bust(existing.movieId);
		return this.getForMovie(existing.movieId, userId);
	}

	remove(id: string, userId: string, isAdmin = false) {
		const existing = this.database.db
			.select()
			.from(movieComments)
			.where(eq(movieComments.id, id))
			.get();
		if (!existing) throw new NotFoundException('Comment not found');
		if (existing.userId !== userId && !isAdmin) {
			throw new ForbiddenException('Only the author can delete this comment');
		}
		// Replies cascade-delete via parent cleanup below (no FK on parent_id).
		this.database.db.delete(movieComments).where(eq(movieComments.id, id)).run();
		this.database.db.delete(movieComments).where(eq(movieComments.parentId, id)).run();
		this.bust(existing.movieId);
		return this.getForMovie(existing.movieId, userId);
	}

	/** Toggle an emoji reaction for the user. */
	toggleReaction(commentId: string, userId: string, emoji: string) {
		const comment = this.database.db
			.select({ movieId: movieComments.movieId })
			.from(movieComments)
			.where(eq(movieComments.id, commentId))
			.get();
		if (!comment) throw new NotFoundException('Comment not found');
		const e = (emoji ?? '').slice(0, 16);
		if (!e) throw new ForbiddenException('Emoji required');

		const existing = this.database.db
			.select({ id: commentReactions.id })
			.from(commentReactions)
			.where(
				sql`${commentReactions.commentId} = ${commentId} AND ${commentReactions.userId} = ${userId} AND ${commentReactions.emoji} = ${e}`,
			)
			.get();
		if (existing) {
			this.database.db
				.delete(commentReactions)
				.where(eq(commentReactions.id, existing.id))
				.run();
		} else {
			this.database.db
				.insert(commentReactions)
				.values({
					id: crypto.randomUUID(),
					commentId,
					userId,
					emoji: e,
					createdAt: nowISO(),
				})
				.run();
		}
		this.bust(comment.movieId);
		return this.getForMovie(comment.movieId, userId);
	}

	private requireOwn(id: string, userId: string) {
		const existing = this.database.db
			.select()
			.from(movieComments)
			.where(eq(movieComments.id, id))
			.get();
		if (!existing) throw new NotFoundException('Comment not found');
		if (existing.userId !== userId) {
			throw new ForbiddenException('Only the author can edit this comment');
		}
		return existing;
	}
}

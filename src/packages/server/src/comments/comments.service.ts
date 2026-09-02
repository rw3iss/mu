import { NotificationType, nowISO } from '@mu/shared';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { commentReactions, movieComments, movies, users } from '../database/schema/index.js';
import { NotificationsService } from '../notifications/notifications.service.js';

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
	constructor(
		private readonly database: DatabaseService,
		private readonly notifications: NotificationsService,
	) {}

	/** Display name for a user id (falls back to username / 'Someone'). */
	private userName(userId: string): string {
		const u = this.database.db
			.select({
				name: sql<string>`COALESCE(${users.displayName}, ${users.username}, 'Someone')`,
			})
			.from(users)
			.where(eq(users.id, userId))
			.get();
		return u?.name ?? 'Someone';
	}

	private movieTitle(movieId: string): string | undefined {
		const m = this.database.db
			.select({ title: movies.title })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		return m?.title ?? undefined;
	}

	private readonly cache = new Map<string, { data: RawComment[]; expires: number }>();
	private static readonly TTL_MS = 5 * 60_000;
	/** Max reply nesting depth (root = 0). Replies past this reparent up. */
	private static readonly MAX_DEPTH = 20;

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
		// Build the full reply tree (arbitrary depth). Each node gets a
		// `replies[]`; children are attached to their parent, orphans (parent
		// deleted) surface at top level. Raw rows are createdAt-ascending, so
		// replies stay in chronological order within each parent.
		const byId = new Map<string, CommentView>();
		for (const c of raw) {
			const v = shape(c);
			v.replies = [];
			byId.set(v.id, v);
		}
		const top: CommentView[] = [];
		for (const c of raw) {
			const node = byId.get(c.id)!;
			const parent = c.parentId ? byId.get(c.parentId) : null;
			if (parent) parent.replies!.push(node);
			else top.push(node);
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

	/**
	 * A user's comments across all movies, newest first, pageable. Joined with
	 * movie title/poster for profile rendering. Light query — no cache needed.
	 */
	listByUser(userId: string, page = 1, pageSize = 20) {
		const limit = Math.min(50, Math.max(1, pageSize));
		const offset = (Math.max(1, page) - 1) * limit;
		const rows = this.database.db
			.select({
				id: movieComments.id,
				movieId: movieComments.movieId,
				parentId: movieComments.parentId,
				timeSeconds: movieComments.timeSeconds,
				text: movieComments.text,
				edited: movieComments.edited,
				createdAt: movieComments.createdAt,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
				movieThumbnailUrl: movies.thumbnailUrl,
			})
			.from(movieComments)
			.leftJoin(movies, eq(movieComments.movieId, movies.id))
			.where(eq(movieComments.userId, userId))
			.orderBy(sql`${movieComments.createdAt} DESC`)
			.limit(limit + 1)
			.offset(offset)
			.all();
		const hasMore = rows.length > limit;
		return { comments: rows.slice(0, limit), page: Math.max(1, page), hasMore };
	}

	create(
		movieId: string,
		userId: string,
		body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	) {
		const text = (body.text ?? '').trim();
		if (!text) throw new ForbiddenException('Comment text is required');
		if (body.parentId) {
			// Walk the ancestor chain to validate the parent exists, belongs to
			// the same movie, and the new reply wouldn't exceed MAX_DEPTH. If the
			// chain is already at the cap, attach to the deepest allowed ancestor.
			let cursor: string | null = body.parentId;
			const chain: string[] = [];
			let guard = 0;
			while (cursor && guard++ < CommentsService.MAX_DEPTH + 2) {
				const row = this.database.db
					.select({
						id: movieComments.id,
						parentId: movieComments.parentId,
						movieId: movieComments.movieId,
					})
					.from(movieComments)
					.where(eq(movieComments.id, cursor))
					.get();
				if (!row) break;
				if (row.movieId !== movieId)
					throw new ForbiddenException('Parent belongs to another movie');
				chain.unshift(row.id);
				cursor = row.parentId;
			}
			if (chain.length === 0) throw new NotFoundException('Parent comment not found');
			// chain = root..parent. The new reply sits one below parent → its
			// depth = chain.length. Cap by reparenting to the deepest ancestor
			// that keeps depth <= MAX_DEPTH.
			if (chain.length >= CommentsService.MAX_DEPTH) {
				body.parentId = chain[CommentsService.MAX_DEPTH - 1] ?? body.parentId;
			}
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

		// Notify the parent comment's author of a reply (not your own).
		if (body.parentId) {
			const parent = this.database.db
				.select({ userId: movieComments.userId })
				.from(movieComments)
				.where(eq(movieComments.id, body.parentId))
				.get();
			if (parent && parent.userId !== userId) {
				this.notifications.create(
					NotificationType.CommentReply,
					{
						fromUserId: userId,
						fromUserName: this.userName(userId),
						movieId,
						movieTitle: this.movieTitle(movieId),
						commentId: body.parentId,
						replyId: id,
						snippet: text.slice(0, 140),
					},
					parent.userId,
				);
			}
		}

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
		// Recursively delete this comment + ALL descendant replies (no FK on
		// parent_id, so we collect the subtree by BFS then delete it).
		const toDelete = [id];
		const queue = [id];
		let guard = 0;
		while (queue.length && guard++ < 10_000) {
			const parentId = queue.shift()!;
			const children = this.database.db
				.select({ id: movieComments.id })
				.from(movieComments)
				.where(eq(movieComments.parentId, parentId))
				.all();
			for (const c of children) {
				toDelete.push(c.id);
				queue.push(c.id);
			}
		}
		this.database.db.delete(movieComments).where(inArray(movieComments.id, toDelete)).run();
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
			// Notify the comment's author of the reaction (not your own).
			const author = this.database.db
				.select({ userId: movieComments.userId, text: movieComments.text })
				.from(movieComments)
				.where(eq(movieComments.id, commentId))
				.get();
			if (author && author.userId !== userId) {
				this.notifications.create(
					NotificationType.CommentReaction,
					{
						fromUserId: userId,
						fromUserName: this.userName(userId),
						movieId: comment.movieId,
						movieTitle: this.movieTitle(comment.movieId),
						commentId,
						emoji: e,
						snippet: (author.text ?? '').slice(0, 140),
					},
					author.userId,
				);
			}
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

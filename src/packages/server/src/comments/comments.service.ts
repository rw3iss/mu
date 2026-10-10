import { type EntityRef, type EntityType, NotificationType, nowISO } from '@mu/shared';
import {
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
	type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { entityCommentReactions, entityComments, movies, users } from '../database/schema/index.js';
import { EntityLifecycleService } from '../entities/entity-lifecycle.service.js';
import { EntityResolverRegistry } from '../entities/entity-resolver.registry.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface CommentReactionSummary {
	emoji: string;
	count: number;
	/** Whether the requesting user reacted with this emoji. */
	mine: boolean;
}

export interface CommentView {
	id: string;
	entityType: EntityType;
	entityId: string;
	/** Set for movie comments only (legacy field the movie UI reads). */
	movieId?: string;
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

const cacheKey = (ref: EntityRef) => `${ref.type}:${ref.id}`;
const movieRef = (id: string): EntityRef => ({ type: 'movie', id });

/**
 * Entity comments (movies today; any EntityRef): general or time-anchored,
 * nested replies, emoji reactions. Read path is cached per entity (raw,
 * user-agnostic) and busted on every mutation; the per-user `mine` flags are
 * shaped per request.
 */
@Injectable()
export class CommentsService implements OnModuleInit {
	private readonly logger = new Logger('CommentsService');

	constructor(
		private readonly database: DatabaseService,
		private readonly notifications: NotificationsService,
		private readonly resolvers: EntityResolverRegistry,
		private readonly lifecycle: EntityLifecycleService,
	) {}

	onModuleInit() {
		this.lifecycle.onPurge((ref) => this.bust(ref));
	}

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

	/**
	 * Send a comment notification with the entity's title resolved. Movies keep
	 * the legacy `movieId`/`movieTitle` fields the client formatter reads.
	 */
	private notify(
		type: NotificationType,
		ref: EntityRef,
		data: Record<string, unknown>,
		recipientId: string,
	): void {
		void this.resolvers
			.summary(ref)
			.catch(() => null)
			.then((summary) => {
				const title = summary?.title ?? undefined;
				this.notifications.create(
					type,
					{
						...data,
						entityType: ref.type,
						entityId: ref.id,
						entityTitle: title,
						...(ref.type === 'movie' ? { movieId: ref.id, movieTitle: title } : {}),
					},
					recipientId,
				);
			})
			.catch((err) =>
				this.logger.warn(`comment notification failed: ${err?.message ?? err}`),
			);
	}

	private readonly cache = new Map<string, { data: RawComment[]; expires: number }>();
	private static readonly TTL_MS = 5 * 60_000;
	/** Max reply nesting depth (root = 0). Replies past this reparent up. */
	private static readonly MAX_DEPTH = 20;

	bust(ref: EntityRef): void {
		this.cache.delete(cacheKey(ref));
	}

	/** Comment tree for a movie, shaped for `forUserId` (mine flags). */
	getForMovie(movieId: string, forUserId?: string): CommentView[] {
		return this.getForEntity(movieRef(movieId), forUserId);
	}

	/** Comment tree for any entity, shaped for `forUserId` (mine flags). */
	getForEntity(ref: EntityRef, forUserId?: string): CommentView[] {
		const raw = this.getRaw(ref);
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

	count(ref: EntityRef): number {
		return this.getRaw(ref).length;
	}

	private getRaw(ref: EntityRef): RawComment[] {
		const key = cacheKey(ref);
		const hit = this.cache.get(key);
		if (hit && hit.expires > Date.now()) return hit.data;

		const rows = this.database.db
			.select({
				id: entityComments.id,
				userId: entityComments.userId,
				parentId: entityComments.parentId,
				timeSeconds: entityComments.timeSeconds,
				text: entityComments.text,
				edited: entityComments.edited,
				createdAt: entityComments.createdAt,
				updatedAt: entityComments.updatedAt,
				authorName: sql<string>`COALESCE(${users.displayName}, ${users.username}, 'Unknown')`,
			})
			.from(entityComments)
			.leftJoin(users, eq(entityComments.userId, users.id))
			.where(
				and(eq(entityComments.entityType, ref.type), eq(entityComments.entityId, ref.id)),
			)
			.orderBy(asc(entityComments.createdAt))
			.all();

		const reactions = rows.length
			? this.database.db
					.select()
					.from(entityCommentReactions)
					.where(
						inArray(
							entityCommentReactions.commentId,
							rows.map((r) => r.id),
						),
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
			entityType: ref.type,
			entityId: ref.id,
			...(ref.type === 'movie' ? { movieId: ref.id } : {}),
			edited: !!r.edited,
			reactions: [...(byComment.get(r.id) ?? new Map()).entries()].map(
				([emoji, userIds]) => ({ emoji, userIds }),
			),
		}));
		this.cache.set(key, { data, expires: Date.now() + CommentsService.TTL_MS });
		return data;
	}

	/**
	 * A user's movie comments, newest first, pageable. Joined with
	 * movie title/poster for profile rendering. Light query — no cache needed.
	 */
	listByUser(userId: string, page = 1, pageSize = 20) {
		const limit = Math.min(50, Math.max(1, pageSize));
		const offset = (Math.max(1, page) - 1) * limit;
		const rows = this.database.db
			.select({
				id: entityComments.id,
				movieId: entityComments.entityId,
				parentId: entityComments.parentId,
				timeSeconds: entityComments.timeSeconds,
				text: entityComments.text,
				edited: entityComments.edited,
				createdAt: entityComments.createdAt,
				movieTitle: movies.title,
				movieYear: movies.year,
				moviePosterUrl: movies.posterUrl,
				movieThumbnailUrl: movies.thumbnailUrl,
			})
			.from(entityComments)
			.leftJoin(movies, eq(entityComments.entityId, movies.id))
			.where(and(eq(entityComments.userId, userId), eq(entityComments.entityType, 'movie')))
			.orderBy(sql`${entityComments.createdAt} DESC`)
			.limit(limit + 1)
			.offset(offset)
			.all();
		const hasMore = rows.length > limit;
		return { comments: rows.slice(0, limit), page: Math.max(1, page), hasMore };
	}

	create(
		ref: EntityRef,
		userId: string,
		body: { text: string; timeSeconds?: number | null; parentId?: string | null },
	) {
		const text = (body.text ?? '').trim();
		if (!text) throw new ForbiddenException('Comment text is required');
		if (body.parentId) {
			// Walk the ancestor chain to validate the parent exists, belongs to
			// the same entity, and the new reply wouldn't exceed MAX_DEPTH. If the
			// chain is already at the cap, attach to the deepest allowed ancestor.
			let cursor: string | null = body.parentId;
			const chain: string[] = [];
			let guard = 0;
			while (cursor && guard++ < CommentsService.MAX_DEPTH + 2) {
				const row = this.database.db
					.select({
						id: entityComments.id,
						parentId: entityComments.parentId,
						entityType: entityComments.entityType,
						entityId: entityComments.entityId,
					})
					.from(entityComments)
					.where(eq(entityComments.id, cursor))
					.get();
				if (!row) break;
				if (row.entityType !== ref.type || row.entityId !== ref.id)
					throw new ForbiddenException(`Parent belongs to another ${ref.type}`);
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
			.insert(entityComments)
			.values({
				id,
				entityType: ref.type,
				entityId: ref.id,
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
				.select({ userId: entityComments.userId })
				.from(entityComments)
				.where(eq(entityComments.id, body.parentId))
				.get();
			if (parent && parent.userId !== userId) {
				this.notify(
					NotificationType.CommentReply,
					ref,
					{
						fromUserId: userId,
						fromUserName: this.userName(userId),
						commentId: body.parentId,
						replyId: id,
						snippet: text.slice(0, 140),
					},
					parent.userId,
				);
			}
		}

		this.bust(ref);
		return this.getForEntity(ref, userId);
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
		this.database.db.update(entityComments).set(patch).where(eq(entityComments.id, id)).run();
		const ref = this.refOf(existing);
		this.bust(ref);
		return this.getForEntity(ref, userId);
	}

	remove(id: string, userId: string, isAdmin = false) {
		const existing = this.database.db
			.select()
			.from(entityComments)
			.where(eq(entityComments.id, id))
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
				.select({ id: entityComments.id })
				.from(entityComments)
				.where(eq(entityComments.parentId, parentId))
				.all();
			for (const c of children) {
				toDelete.push(c.id);
				queue.push(c.id);
			}
		}
		this.database.db.delete(entityComments).where(inArray(entityComments.id, toDelete)).run();
		const ref = this.refOf(existing);
		this.bust(ref);
		return this.getForEntity(ref, userId);
	}

	/** Toggle an emoji reaction for the user. */
	toggleReaction(commentId: string, userId: string, emoji: string) {
		const comment = this.database.db
			.select({ entityType: entityComments.entityType, entityId: entityComments.entityId })
			.from(entityComments)
			.where(eq(entityComments.id, commentId))
			.get();
		if (!comment) throw new NotFoundException('Comment not found');
		const e = (emoji ?? '').slice(0, 16);
		if (!e) throw new ForbiddenException('Emoji required');

		const existing = this.database.db
			.select({ id: entityCommentReactions.id })
			.from(entityCommentReactions)
			.where(
				sql`${entityCommentReactions.commentId} = ${commentId} AND ${entityCommentReactions.userId} = ${userId} AND ${entityCommentReactions.emoji} = ${e}`,
			)
			.get();
		if (existing) {
			this.database.db
				.delete(entityCommentReactions)
				.where(eq(entityCommentReactions.id, existing.id))
				.run();
		} else {
			this.database.db
				.insert(entityCommentReactions)
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
				.select({ userId: entityComments.userId, text: entityComments.text })
				.from(entityComments)
				.where(eq(entityComments.id, commentId))
				.get();
			if (author && author.userId !== userId) {
				this.notify(
					NotificationType.CommentReaction,
					this.refOf(comment),
					{
						fromUserId: userId,
						fromUserName: this.userName(userId),
						commentId,
						emoji: e,
						snippet: (author.text ?? '').slice(0, 140),
					},
					author.userId,
				);
			}
		}
		const ref = this.refOf(comment);
		this.bust(ref);
		return this.getForEntity(ref, userId);
	}

	private refOf(row: { entityType: string; entityId: string }): EntityRef {
		return { type: row.entityType as EntityType, id: row.entityId };
	}

	private requireOwn(id: string, userId: string) {
		const existing = this.database.db
			.select()
			.from(entityComments)
			.where(eq(entityComments.id, id))
			.get();
		if (!existing) throw new NotFoundException('Comment not found');
		if (existing.userId !== userId) {
			throw new ForbiddenException('Only the author can edit this comment');
		}
		return existing;
	}
}

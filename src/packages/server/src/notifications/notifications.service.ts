import { type NotificationType, nowISO, WsEvent } from '@mu/shared';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { desc, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { notifications } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';

export interface NotificationView {
	id: string;
	userId: string | null;
	type: string;
	data: Record<string, unknown>;
	read: boolean;
	createdAt: string;
}

/**
 * Generic notifications: per-user (userId set) and system-wide (userId null,
 * shown to everyone, stored once). Read tracking is per-user; system-wide rows
 * have no shared read flag (a user dismisses them only locally — see client).
 * Per-user unread counts are cached and busted on any write touching that user.
 */
@Injectable()
export class NotificationsService {
	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
	) {}

	/** Per-user unread-count cache (short TTL; busted on create/read). */
	private readonly unreadCache = new Map<string, { value: number; at: number }>();
	private static readonly UNREAD_TTL_MS = 30_000;

	private bust(userId: string | null): void {
		if (userId) this.unreadCache.delete(userId);
		else this.unreadCache.clear(); // system-wide affects everyone
	}

	private toView(row: typeof notifications.$inferSelect): NotificationView {
		let data: Record<string, unknown> = {};
		try {
			data = JSON.parse(row.data || '{}');
		} catch {
			/* keep empty */
		}
		return {
			id: row.id,
			userId: row.userId,
			type: row.type,
			data,
			read: !!row.read,
			createdAt: row.createdAt,
		};
	}

	/**
	 * Create a notification and push it over WS to its recipient(s).
	 * `userId` null = system-wide. Returns the created view.
	 */
	create(
		type: NotificationType | string,
		data: Record<string, unknown>,
		userId: string | null = null,
	): NotificationView {
		const id = crypto.randomUUID();
		const createdAt = nowISO();
		this.database.db
			.insert(notifications)
			.values({
				id,
				userId: userId ?? null,
				type: String(type),
				data: JSON.stringify(data),
				createdAt,
			})
			.run();
		this.bust(userId);
		const view: NotificationView = {
			id,
			userId: userId ?? null,
			type: String(type),
			data,
			read: false,
			createdAt,
		};
		// WS push — the gateway routes by `userId` (null = all).
		this.events.emit(WsEvent.NOTIFICATION, view);
		return view;
	}

	/** A user's notifications (their own + system-wide), newest first, paged. */
	list(
		userId: string,
		page = 1,
		pageSize = 30,
	): { notifications: NotificationView[]; hasMore: boolean } {
		const limit = Math.min(100, Math.max(1, pageSize));
		const offset = (Math.max(1, page) - 1) * limit;
		const rows = this.database.db
			.select()
			.from(notifications)
			.where(or(eq(notifications.userId, userId), isNull(notifications.userId)))
			.orderBy(desc(notifications.createdAt))
			.limit(limit + 1)
			.offset(offset)
			.all();
		const hasMore = rows.length > limit;
		return { notifications: rows.slice(0, limit).map((r) => this.toView(r)), hasMore };
	}

	/** Unread count = unread personal rows + unread system-wide rows. */
	unreadCount(userId: string): number {
		const hit = this.unreadCache.get(userId);
		if (hit && Date.now() - hit.at < NotificationsService.UNREAD_TTL_MS) return hit.value;
		const r = this.database.db.get<{ n: number }>(sql`
			SELECT COUNT(*) AS n FROM notifications
			WHERE read = 0 AND (user_id = ${userId} OR user_id IS NULL)
		`);
		const value = r?.n ?? 0;
		this.unreadCache.set(userId, { value, at: Date.now() });
		return value;
	}

	markRead(id: string, userId: string): void {
		// Only the recipient may mark a personal one; system-wide rows are
		// marked read globally (acceptable — they're informational).
		const row = this.database.db
			.select()
			.from(notifications)
			.where(eq(notifications.id, id))
			.get();
		if (!row) return;
		if (row.userId && row.userId !== userId)
			throw new ForbiddenException('Not your notification');
		this.database.db
			.update(notifications)
			.set({ read: true })
			.where(eq(notifications.id, id))
			.run();
		this.bust(userId);
	}

	markAllRead(userId: string): void {
		this.database.db
			.update(notifications)
			.set({ read: true })
			.where(or(eq(notifications.userId, userId), isNull(notifications.userId)))
			.run();
		this.bust(userId);
	}

	remove(id: string, userId: string): void {
		const row = this.database.db
			.select()
			.from(notifications)
			.where(eq(notifications.id, id))
			.get();
		if (!row) return;
		if (row.userId && row.userId !== userId)
			throw new ForbiddenException('Not your notification');
		this.database.db.delete(notifications).where(eq(notifications.id, id)).run();
		this.bust(userId);
	}
}

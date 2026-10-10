import { type EntityRef, nowISO, RATING_MAX, RATING_MIN } from '@mu/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, avg, count, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { entityRatings } from '../database/schema/index.js';

export interface EntityRatingRow {
	id: string;
	userId: string;
	entityType: string;
	entityId: string;
	rating: number;
	createdAt: string;
	updatedAt: string;
}

export interface RatingSummary {
	avg: number | null;
	count: number;
	userRating: number | null;
}

/** Per-user ratings for any entity (movie, person, artist, album, track). */
@Injectable()
export class EntityRatingsService {
	constructor(private readonly database: DatabaseService) {}

	private where(userId: string, ref: EntityRef) {
		return and(
			eq(entityRatings.userId, userId),
			eq(entityRatings.entityType, ref.type),
			eq(entityRatings.entityId, ref.id),
		);
	}

	get(userId: string, ref: EntityRef): EntityRatingRow | null {
		return (
			this.database.db.select().from(entityRatings).where(this.where(userId, ref)).get() ??
			null
		);
	}

	rate(userId: string, ref: EntityRef, rating: number): EntityRatingRow {
		if (typeof rating !== 'number' || rating < RATING_MIN || rating > RATING_MAX) {
			throw new BadRequestException(`Rating must be between ${RATING_MIN} and ${RATING_MAX}`);
		}
		const now = nowISO();
		const existing = this.get(userId, ref);
		if (existing) {
			this.database.db
				.update(entityRatings)
				.set({ rating, updatedAt: now })
				.where(eq(entityRatings.id, existing.id))
				.run();
			return { ...existing, rating, updatedAt: now };
		}
		const row: EntityRatingRow = {
			id: crypto.randomUUID(),
			userId,
			entityType: ref.type,
			entityId: ref.id,
			rating,
			createdAt: now,
			updatedAt: now,
		};
		this.database.db.insert(entityRatings).values(row).run();
		return row;
	}

	remove(userId: string, ref: EntityRef): void {
		this.database.db.delete(entityRatings).where(this.where(userId, ref)).run();
	}

	summary(ref: EntityRef, userId?: string): RatingSummary {
		const agg = this.database.db
			.select({ avg: avg(entityRatings.rating), count: count() })
			.from(entityRatings)
			.where(and(eq(entityRatings.entityType, ref.type), eq(entityRatings.entityId, ref.id)))
			.get();
		const n = agg?.count ?? 0;
		return {
			avg: n > 0 && agg?.avg != null ? Number(agg.avg) : null,
			count: n,
			userRating: userId ? (this.get(userId, ref)?.rating ?? null) : null,
		};
	}
}

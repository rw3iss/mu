import { nowISO } from '@mu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { audioProfiles } from '../database/schema/index.js';

@Injectable()
export class AudioProfilesService {
	constructor(private readonly database: DatabaseService) {}

	findAll(userId: string) {
		return this.database.db
			.select()
			.from(audioProfiles)
			.where(eq(audioProfiles.userId, userId))
			.all();
	}

	findOne(userId: string, id: string) {
		const profile = this.database.db
			.select()
			.from(audioProfiles)
			.where(and(eq(audioProfiles.id, id), eq(audioProfiles.userId, userId)))
			.get();
		if (!profile) throw new NotFoundException('Audio profile not found');
		return profile;
	}

	create(
		userId: string,
		data: { name: string; type: string; config: string; isDefault?: boolean },
	) {
		const now = nowISO();
		const id = crypto.randomUUID();

		if (data.isDefault) {
			// Clear other defaults of the same type
			this.database.db
				.update(audioProfiles)
				.set({ isDefault: false, updatedAt: now })
				.where(and(eq(audioProfiles.userId, userId), eq(audioProfiles.type, data.type)))
				.run();
		}

		this.database.db
			.insert(audioProfiles)
			.values({
				id,
				userId,
				name: data.name,
				type: data.type,
				config: data.config,
				isDefault: data.isDefault ?? false,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		return this.findOne(userId, id);
	}

	update(
		userId: string,
		id: string,
		data: { name?: string; config?: string; isDefault?: boolean },
	) {
		const existing = this.findOne(userId, id);
		const now = nowISO();

		if (data.isDefault) {
			this.database.db
				.update(audioProfiles)
				.set({ isDefault: false, updatedAt: now })
				.where(and(eq(audioProfiles.userId, userId), eq(audioProfiles.type, existing.type)))
				.run();
		}

		this.database.db
			.update(audioProfiles)
			.set({
				...(data.name !== undefined && { name: data.name }),
				...(data.config !== undefined && { config: data.config }),
				...(data.isDefault !== undefined && { isDefault: data.isDefault }),
				updatedAt: now,
			})
			.where(eq(audioProfiles.id, id))
			.run();

		return this.findOne(userId, id);
	}

	remove(userId: string, id: string) {
		this.findOne(userId, id); // ensure exists
		this.database.db
			.delete(audioProfiles)
			.where(and(eq(audioProfiles.id, id), eq(audioProfiles.userId, userId)))
			.run();
	}
}

import { nowISO } from '@mu/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { mediaSources } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';

@Injectable()
export class LibraryService {
	private readonly logger = new Logger('LibraryService');

	constructor(
		private readonly database: DatabaseService,
		private readonly events: EventsService,
	) {}

	getSources() {
		return this.database.db.select().from(mediaSources).all();
	}

	getSource(id: string) {
		const source = this.database.db
			.select()
			.from(mediaSources)
			.where(eq(mediaSources.id, id))
			.get();

		if (!source) {
			throw new NotFoundException(`Source ${id} not found`);
		}
		return source;
	}

	addSource(path: string, label?: string) {
		const now = nowISO();
		const id = crypto.randomUUID();

		this.database.db
			.insert(mediaSources)
			.values({
				id,
				path,
				label: label ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		this.logger.log(`Added media source: ${path}`);
		this.events.emit('library:source-added', { id, path });

		return this.getSource(id);
	}

	removeSource(id: string) {
		const source = this.getSource(id);
		this.database.db.delete(mediaSources).where(eq(mediaSources.id, id)).run();
		this.logger.log(`Removed media source: ${source.path}`);
		this.events.emit('library:source-removed', { id, path: source.path });
	}

	findByPath(path: string) {
		return this.database.db
			.select()
			.from(mediaSources)
			.where(eq(mediaSources.path, path))
			.get();
	}

	syncSources(paths: string[]) {
		const existing = this.getSources();
		const existingPaths = new Set(existing.map((s) => s.path));
		const newPaths = new Set(paths);

		const created: typeof existing = [];
		const kept: typeof existing = [];
		const removedPaths: string[] = [];

		// Add new paths
		for (const path of paths) {
			if (!existingPaths.has(path)) {
				created.push(this.addSource(path));
			} else {
				const source = existing.find((s) => s.path === path)!;
				kept.push(source);
			}
		}

		// Remove sources whose paths are no longer in the list
		for (const source of existing) {
			if (!newPaths.has(source.path)) {
				this.removeSource(source.id);
				removedPaths.push(source.path);
			}
		}

		return { created, removed: removedPaths, kept };
	}

	updateSource(
		id: string,
		data: Partial<{ label: string; enabled: boolean; scanIntervalHours: number }>,
	) {
		const existing = this.getSource(id);
		if (!existing) {
			throw new NotFoundException(`Source ${id} not found`);
		}

		this.database.db
			.update(mediaSources)
			.set({ ...data, updatedAt: nowISO() })
			.where(eq(mediaSources.id, id))
			.run();

		return this.getSource(id);
	}
}

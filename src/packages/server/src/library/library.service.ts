import { type MediaKind, nowISO } from '@mu/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

	/** All media sources, optionally only those of one kind. */
	getSources(kind?: MediaKind) {
		const all = this.database.db.select().from(mediaSources).all();
		return kind ? all.filter((s) => (s.kind || 'video') === kind) : all;
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

	/**
	 * Add a media source of `kind` (default `video`). A path that overlaps a
	 * source of the OTHER kind (same dir, parent or child) is allowed — each
	 * importer only takes its own extensions — but the result carries a
	 * `warning` so the UI can tell the admin (plan §12 #9).
	 */
	addSource(path: string, label?: string, kind: MediaKind = 'video') {
		if (kind !== 'video' && kind !== 'audio') {
			throw new BadRequestException(`Invalid source kind "${kind}"`);
		}
		const warning = this.overlapWarning(path, kind);
		const now = nowISO();
		const id = crypto.randomUUID();

		this.database.db
			.insert(mediaSources)
			.values({
				id,
				path,
				label: label ?? null,
				kind,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		this.logger.log(`Added ${kind} media source: ${path}`);
		if (warning) this.logger.warn(warning);
		this.events.emit('library:source-added', { id, path, kind });

		const source = this.getSource(id);
		return warning ? { ...source, warning } : source;
	}

	/** Human-readable warning when `path` overlaps a source of a different kind. */
	overlapWarning(path: string, kind: MediaKind): string | undefined {
		const norm = (p: string) => p.replace(/[\\/]+$/, '');
		const target = norm(path);
		const clash = this.getSources().find((s) => {
			if ((s.kind || 'video') === kind) return false;
			const other = norm(s.path);
			return (
				other === target ||
				target.startsWith(`${other}/`) ||
				other.startsWith(`${target}/`) ||
				target.startsWith(`${other}\\`) ||
				other.startsWith(`${target}\\`)
			);
		});
		if (!clash) return undefined;
		const otherKind = (clash.kind || 'video') === 'audio' ? 'music' : 'movie';
		return `This folder overlaps the ${otherKind} folder "${clash.path}". Each library only imports its own file types, but keeping movie and music folders separate is recommended.`;
	}

	removeSource(id: string) {
		const source = this.getSource(id);
		this.database.db.delete(mediaSources).where(eq(mediaSources.id, id)).run();
		this.logger.log(`Removed media source: ${source.path}`);
		this.events.emit('library:source-removed', { id, path: source.path });
	}

	/**
	 * The default media source for new uploads etc. Resolution order:
	 * the explicitly flagged default → the single source when only one
	 * exists → the first source found. Null when no sources exist.
	 */
	getDefaultSource(kind: MediaKind = 'video') {
		const sources = this.getSources(kind);
		if (sources.length === 0) return null;
		return sources.find((s) => s.isDefault) ?? sources[0]!;
	}

	findByPath(path: string) {
		return this.database.db
			.select()
			.from(mediaSources)
			.where(eq(mediaSources.path, path))
			.get();
	}

	/**
	 * Make the set of `kind` sources equal `paths`. Sources of other kinds are
	 * never touched (the movie-folder list must not delete music folders).
	 */
	syncSources(paths: string[], kind: MediaKind = 'video') {
		const existing = this.getSources(kind);
		const existingPaths = new Set(existing.map((s) => s.path));
		const newPaths = new Set(paths);

		const created: typeof existing = [];
		const kept: typeof existing = [];
		const removedPaths: string[] = [];

		// Add new paths
		for (const path of paths) {
			if (!existingPaths.has(path)) {
				created.push(this.addSource(path, undefined, kind));
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
		data: Partial<{
			label: string;
			enabled: boolean;
			scanIntervalHours: number;
			isDefault: boolean;
		}>,
	) {
		const existing = this.getSource(id);
		if (!existing) {
			throw new NotFoundException(`Source ${id} not found`);
		}

		// Only one source per kind may be the default — clear the flag on the
		// other sources of the same kind.
		if (data.isDefault === true) {
			this.database.db
				.update(mediaSources)
				.set({ isDefault: false, updatedAt: nowISO() })
				.where(eq(mediaSources.kind, existing.kind || 'video'))
				.run();
		}

		this.database.db
			.update(mediaSources)
			.set({ ...data, updatedAt: nowISO() })
			.where(eq(mediaSources.id, id))
			.run();

		// Enable/disable (and other edits) change which paths the watcher covers.
		this.events.emit('library:source-updated', { id, path: existing.path });

		return this.getSource(id);
	}
}

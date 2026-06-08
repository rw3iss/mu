import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { movieFiles, movies } from '../../database/schema/index.js';

export interface SubtitleTrackRow {
	index: number;
	language?: string;
	title?: string;
	codec?: string;
	forced?: boolean;
	external?: boolean;
	/** This movie's chosen default subtitle (at most one true). */
	default?: boolean;
	/** Source sidecar filename (external tracks). */
	fileName?: string;
}

/**
 * DB access for subtitle-track metadata. The actual VTT cache + ffmpeg
 * lookups live in SubtitleService; this repo only owns the movieFiles
 * row's `subtitleTracks` JSON column and the two movie-lookup helpers
 * the subtitle controllers all share.
 */
@Injectable()
export class SubtitleTracksRepository {
	constructor(private readonly database: DatabaseService) {}

	async getMovie(movieId: string) {
		const result = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!result) throw new NotFoundException(`Movie ${movieId} not found`);
		return result;
	}

	async getAvailableMovieFile(movieId: string) {
		const result = this.database.db
			.select()
			.from(movieFiles)
			.where(and(eq(movieFiles.movieId, movieId), eq(movieFiles.available, true)))
			.get();
		if (!result) throw new NotFoundException(`No available file for movie ${movieId}`);
		return result;
	}

	/** Any file for the movie, regardless of `available` — used for deletes. */
	getAnyMovieFile(movieId: string) {
		return (
			this.database.db
				.select()
				.from(movieFiles)
				.where(eq(movieFiles.movieId, movieId))
				.get() ?? null
		);
	}

	parseTracks(json: string | null): SubtitleTrackRow[] {
		if (!json) return [];
		try {
			return JSON.parse(json) as SubtitleTrackRow[];
		} catch {
			return [];
		}
	}

	async setTracks(fileId: string, tracks: SubtitleTrackRow[]): Promise<void> {
		await this.database.db
			.update(movieFiles)
			.set({
				subtitleTracks: JSON.stringify(
					tracks.map((t) => ({
						index: t.index,
						language: t.language,
						title: t.title,
						external: t.external ?? false,
						// Preserve the default flag (only set when true to keep the JSON lean).
						...(t.default ? { default: true } : {}),
						...(t.fileName ? { fileName: t.fileName } : {}),
					})),
				),
			})
			.where(eq(movieFiles.id, fileId));
	}

	/**
	 * Mark one track as the movie's default subtitle (clearing it on all
	 * others). Returns the updated track list. Throws if the index is unknown.
	 */
	async setDefault(fileId: string, index: number): Promise<SubtitleTrackRow[]> {
		const tracks = this.getPersistedTracks(fileId);
		if (!tracks.some((t) => t.index === index)) {
			throw new NotFoundException(`Subtitle track ${index} not found`);
		}
		const updated = tracks.map((t) => ({ ...t, default: t.index === index }));
		await this.setTracks(fileId, updated);
		return updated;
	}

	/** Refetch the persisted tracks for a file (used after extractSubtitles returns empty). */
	getPersistedTracks(fileId: string): SubtitleTrackRow[] {
		const row = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.id, fileId))
			.get();
		return this.parseTracks(row?.subtitleTracks ?? null);
	}

	/** Every movie file that has at least one persisted subtitle track. */
	getAllFilesWithSubtitles(): { id: string; filePath: string; subtitleTracks: string | null }[] {
		return this.database.db
			.select({
				id: movieFiles.id,
				filePath: movieFiles.filePath,
				subtitleTracks: movieFiles.subtitleTracks,
			})
			.from(movieFiles)
			.all()
			.filter((r) => !!r.subtitleTracks && r.subtitleTracks !== '[]');
	}
}

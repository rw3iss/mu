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
					})),
				),
			})
			.where(eq(movieFiles.id, fileId));
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
}

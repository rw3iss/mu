import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { CACHE_NAMESPACES, nowISO, WsEvent } from '@mu/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { CacheService } from '../cache/cache.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { MatchCandidatesRepository, NewCandidate } from './match-candidates.repository.js';
import {
	DEFAULT_MATCHER_CONFIG,
	extractYear,
	findBestMatch,
	type MatchCandidate,
} from './matching/index.js';
import { OmdbProvider, OmdbSearchResult } from './providers/omdb.provider.js';
import {
	type TmdbCollectionSearchResult,
	type TmdbTvSearchResult,
	TmdbProvider,
} from './providers/tmdb.provider.js';

/**
 * Number of top candidates to persist when the matcher couldn't pick a
 * single winner confidently. The UI surfaces these as a dropdown.
 */
const MAX_PERSISTED_CANDIDATES = 8;

/** Provenance tags used in `metadata_match_candidates.provider`. */
type ProviderTag = 'tmdb' | 'omdb';

interface MovieCandidate extends MatchCandidate {
	provider: ProviderTag;
	overview?: string | null;
	tmdbId?: number;
	imdbId?: string;
}

@Injectable()
export class MetadataService {
	private readonly logger = new Logger('MetadataService');

	constructor(
		private readonly database: DatabaseService,
		private readonly tmdb: TmdbProvider,
		private readonly omdb: OmdbProvider,
		private readonly cache: CacheService,
		private readonly events: EventsService,
		private readonly matchCandidates: MatchCandidatesRepository,
	) {}

	/**
	 * Resolve and persist metadata for a movie. Strategy:
	 *   1. Fast-path: if movie already has tmdbId/imdbId, skip search and
	 *      go straight to details (with cross-provider enrichment).
	 *   2. Otherwise, parallel title search on TMDB + OMDB; score all
	 *      candidates with the shared matcher.
	 *   3. If best match clears the auto-apply threshold → apply + clear
	 *      candidates. If ambiguous → persist top candidates + bail. If
	 *      no match → clear candidates + bail.
	 *   4. After a confident match, fetch full details from BOTH
	 *      providers (cross-looking up by IMDB ID where one side was
	 *      missed) and merge field-by-field with IMDB-backed sources
	 *      preferred for ratings / IMDB ID, TMDB preferred for structured
	 *      data (cast, posters, trailers, keywords).
	 */
	async fetchForMovie(movieId: string): Promise<any> {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) {
			throw new NotFoundException(`Movie ${movieId} not found`);
		}

		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();
		const fileDurationMinutes = file?.durationSeconds
			? Math.round(file.durationSeconds / 60)
			: null;

		// Best-effort year recovery: stored → filename → folder name.
		const resolvedYear =
			extractYear({
				storedYear: movie.year,
				filePath: file?.filePath,
				folderPath: file?.filePath ? path.dirname(file.filePath) : null,
			}) ?? null;

		// --- 1. Fast path: known IDs --------------------------------------
		if (movie.tmdbId || movie.imdbId) {
			this.logger.log(
				`Fast-path: movie ${movieId} has ${movie.tmdbId ? `tmdbId=${movie.tmdbId}` : ''}${
					movie.tmdbId && movie.imdbId ? ' ' : ''
				}${movie.imdbId ? `imdbId=${movie.imdbId}` : ''}`,
			);
			const result = await this.fetchAndMerge({
				movieId,
				tmdbId: movie.tmdbId ?? null,
				imdbId: movie.imdbId ?? null,
				priorYear: resolvedYear,
			});
			if (result) {
				this.matchCandidates.clear('movie', movieId);
				this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
					movieId,
					source: 'metadata-refresh',
				});
			}
			return result;
		}

		// --- 2. Parallel title search across providers --------------------
		const [tmdbSearch, omdbSearch] = await Promise.allSettled([
			this.tmdb.searchMovie(movie.title, resolvedYear ?? undefined),
			this.omdb.searchByTitle(movie.title, resolvedYear ?? undefined),
		]);
		const tmdbResults =
			tmdbSearch.status === 'fulfilled' ? (tmdbSearch.value ?? []) : [];
		const omdbResult: OmdbSearchResult | null =
			omdbSearch.status === 'fulfilled' ? omdbSearch.value : null;
		if (tmdbSearch.status === 'rejected') {
			this.logger.warn(`TMDB search failed: ${tmdbSearch.reason}`);
		}
		if (omdbSearch.status === 'rejected') {
			this.logger.warn(`OMDB search failed: ${omdbSearch.reason}`);
		}

		// Build unified candidate list. OMDB tends to return one strong
		// match; TMDB returns many — the matcher dedupes by score.
		const candidates: MovieCandidate[] = [];
		for (const r of tmdbResults) {
			const candYear = r.release_date
				? parseInt(r.release_date.slice(0, 4), 10)
				: null;
			candidates.push({
				provider: 'tmdb',
				externalId: r.id,
				title: r.title,
				year: Number.isFinite(candYear) ? candYear : null,
				runtimeMinutes: null,
				popularity: r.popularity ?? null,
				posterUrl: this.tmdb.getImageUrl(r.poster_path),
				overview: r.overview,
				tmdbId: r.id,
			});
		}
		if (omdbResult) {
			candidates.push({
				provider: 'omdb',
				externalId: omdbResult.imdbId,
				title: omdbResult.title,
				year: omdbResult.year ?? null,
				runtimeMinutes: omdbResult.runtimeMinutes ?? null,
				popularity: null,
				posterUrl: null,
				overview: omdbResult.plot,
				imdbId: omdbResult.imdbId,
			});
		}

		if (candidates.length === 0) {
			this.matchCandidates.clear('movie', movieId);
			this.logger.warn(
				`No metadata candidates for "${movie.title}" (${resolvedYear ?? '?'})`,
			);
			return null;
		}

		const match = findBestMatch(
			{
				title: movie.title,
				year: resolvedYear,
				durationMinutes: fileDurationMinutes,
			},
			candidates,
			DEFAULT_MATCHER_CONFIG,
		);

		// --- 3. Decision: apply / ambiguous / no-match --------------------
		if (match.noMatch || !match.best) {
			this.matchCandidates.clear('movie', movieId);
			this.logger.warn(
				`No confident metadata match for "${movie.title}" — best confidence ${match.best?.confidence.toFixed(2) ?? 'n/a'}`,
			);
			return null;
		}

		if (match.ambiguous) {
			const persisted: NewCandidate[] = match.ranked
				.slice(0, MAX_PERSISTED_CANDIDATES)
				.map((s) => ({
					provider: s.candidate.provider,
					externalId: s.candidate.externalId,
					title: s.candidate.title,
					year: s.candidate.year ?? null,
					runtimeMinutes: s.candidate.runtimeMinutes ?? null,
					posterUrl: s.candidate.posterUrl ?? null,
					overview: (s.candidate as MovieCandidate).overview ?? null,
					confidence: s.confidence,
				}));
			this.matchCandidates.replace('movie', movieId, persisted);
			this.logger.log(
				`Ambiguous metadata for "${movie.title}" — saved ${persisted.length} candidates (top confidence: ${match.best.confidence.toFixed(2)})`,
			);
			this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
				movieId,
				source: 'metadata-candidates',
			});
			return null;
		}

		// Confident match — pull provider IDs and let fetchAndMerge do the rest.
		const winning = match.best.candidate as MovieCandidate;
		this.matchCandidates.clear('movie', movieId);

		const result = await this.fetchAndMerge({
			movieId,
			tmdbId: winning.tmdbId ?? null,
			imdbId: winning.imdbId ?? null,
			priorYear: resolvedYear,
		});
		if (result) {
			this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
				movieId,
				source: 'metadata-refresh',
			});
		}
		this.logger.log(
			`Metadata matched "${movie.title}" via ${winning.provider} → ${winning.title}${winning.year ? ` (${winning.year})` : ''} confidence=${match.best.confidence.toFixed(2)}`,
		);
		return result;
	}

	/**
	 * Apply a user-picked candidate. Looks up the row in the candidate
	 * table, clears all candidates, then runs the regular merge fetch
	 * with the picked IDs.
	 */
	async applyCandidate(
		movieId: string,
		provider: string,
		externalId: string,
	): Promise<any> {
		const row = this.matchCandidates.find('movie', movieId, provider, externalId);
		if (!row) {
			throw new NotFoundException(
				`Candidate not found: movie=${movieId} provider=${provider} externalId=${externalId}`,
			);
		}
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) throw new NotFoundException(`Movie ${movieId} not found`);

		const tmdbId = provider === 'tmdb' ? Number(externalId) : null;
		const imdbId = provider === 'omdb' ? externalId : null;

		const result = await this.fetchAndMerge({
			movieId,
			tmdbId,
			imdbId,
			priorYear: row.year ?? movie.year ?? null,
		});
		this.matchCandidates.clear('movie', movieId);
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
			movieId,
			source: 'metadata-candidate-applied',
		});
		return result;
	}

	/**
	 * Fetch full details from both providers (cross-looking up via IMDB
	 * ID where one side is missing) and merge into the movies +
	 * movie_metadata rows. Per-field priority:
	 *   - imdbId, ratings (imdb / RT / metacritic), rated → OMDB
	 *   - cast, posters, backdrops, trailers, keywords, budget, revenue,
	 *     production_companies → TMDB
	 *   - overview, plot: prefer OMDB (IMDB-backed) when non-empty, else
	 *     TMDB
	 *   - runtime: prefer OMDB when present (IMDB runtime), else TMDB,
	 *     else file probe
	 *   - genres, director, writer: TMDB structured > OMDB string-split
	 */
	private async fetchAndMerge(opts: {
		movieId: string;
		tmdbId: number | null;
		imdbId: string | null;
		priorYear: number | null;
	}): Promise<any> {
		const { movieId, priorYear } = opts;
		let { tmdbId, imdbId } = opts;

		// Cross-lookup: fill in the missing ID via the provider that has it.
		if (!tmdbId && imdbId) {
			const found = await this.tmdb.findByImdbId(imdbId);
			if (found?.movie?.id) {
				tmdbId = found.movie.id;
			}
		}

		// Parallel fetch — both calls hit cache when warm.
		const [tmdbDetailsRes, omdbByIdRes] = await Promise.allSettled([
			tmdbId ? this.tmdb.getMovieDetails(tmdbId) : Promise.resolve(null),
			imdbId ? this.omdb.getByImdbId(imdbId) : Promise.resolve(null),
		]);
		const tmdbDetails =
			tmdbDetailsRes.status === 'fulfilled' ? tmdbDetailsRes.value : null;
		let omdbData = omdbByIdRes.status === 'fulfilled' ? omdbByIdRes.value : null;

		// If TMDB filled in the IMDB ID, fetch OMDB now to enrich.
		if (!omdbData && tmdbDetails?.imdb_id) {
			imdbId = tmdbDetails.imdb_id;
			omdbData = await this.omdb.getByImdbId(tmdbDetails.imdb_id);
		}

		if (!tmdbDetails && !omdbData) {
			this.logger.warn(`No details from any provider for movie ${movieId}`);
			return null;
		}

		// IMDB ID resolution: prefer OMDB (always authoritative), else TMDB.
		// OMDB getByImdbId doesn't echo the ID back in its trimmed shape, so
		// fall back to the `imdbId` we used to query it.
		const resolvedImdbId = imdbId ?? tmdbDetails?.imdb_id ?? null;
		const resolvedTmdbId = tmdbDetails?.id ?? tmdbId ?? null;

		const now = nowISO();
		const trailerVideo = tmdbDetails?.videos?.results?.find(
			(v) => v.site === 'YouTube' && v.type === 'Trailer',
		);
		const trailerUrl = trailerVideo
			? `https://www.youtube.com/watch?v=${trailerVideo.key}`
			: null;

		const usRelease = tmdbDetails?.release_dates?.results?.find(
			(r) => r.iso_3166_1 === 'US',
		);
		const tmdbCertification = usRelease?.release_dates
			?.map((rd) => rd.certification)
			.find((c) => c && c.length > 0);

		// Per-field merge.
		const overview = firstNonEmpty(tmdbDetails?.overview, omdbData?.plot);
		const tagline = tmdbDetails?.tagline || null;
		const originalTitle =
			tmdbDetails?.original_title && tmdbDetails.original_title !== tmdbDetails.title
				? tmdbDetails.original_title
				: null;
		// Runtime preference: OMDB (IMDB-sourced) → TMDB. File-probe duration
		// already lives on movie_files.duration_seconds, no need to merge it
		// here.
		const runtimeMinutes = omdbData?.runtimeMinutes || tmdbDetails?.runtime || null;
		const releaseDate = tmdbDetails?.release_date || null;
		const year = releaseDate
			? parseInt(releaseDate.slice(0, 4), 10)
			: priorYear;
		const language = tmdbDetails?.spoken_languages?.[0]?.iso_639_1 ?? null;
		const country = tmdbDetails?.production_countries?.[0]?.iso_3166_1 ?? null;
		const posterUrl = this.tmdb.getImageUrl(tmdbDetails?.poster_path ?? null);
		const backdropUrl = this.tmdb.getImageUrl(
			tmdbDetails?.backdrop_path ?? null,
			'w1280',
		);
		const contentRating = firstNonEmpty(omdbData?.rated, tmdbCertification);

		const movieUpdate: Record<string, unknown> = {
			tmdbId: resolvedTmdbId,
			imdbId: resolvedImdbId,
			updatedAt: now,
		};
		if (overview) movieUpdate.overview = overview;
		if (tagline) movieUpdate.tagline = tagline;
		if (originalTitle) movieUpdate.originalTitle = originalTitle;
		if (runtimeMinutes) movieUpdate.runtimeMinutes = runtimeMinutes;
		if (releaseDate) movieUpdate.releaseDate = releaseDate;
		if (year) movieUpdate.year = year;
		if (language) movieUpdate.language = language;
		if (country) movieUpdate.country = country;
		if (posterUrl) movieUpdate.posterUrl = posterUrl;
		if (backdropUrl) movieUpdate.backdropUrl = backdropUrl;
		if (trailerUrl) movieUpdate.trailerUrl = trailerUrl;
		if (contentRating) movieUpdate.contentRating = contentRating;

		this.database.db.update(movies).set(movieUpdate).where(eq(movies.id, movieId)).run();

		// Genres / cast / crew. Prefer TMDB structured arrays; OMDB
		// strings are split on ", " as fallback.
		const genres = tmdbDetails?.genres?.length
			? tmdbDetails.genres.map((g) => g.name)
			: omdbData?.genre
				? omdbData.genre.split(',').map((g) => g.trim()).filter(Boolean)
				: [];

		const castMembers = tmdbDetails?.credits?.cast
			? tmdbDetails.credits.cast.slice(0, 20).map((c) => ({
					name: c.name,
					character: c.character,
					profileUrl: this.tmdb.getImageUrl(c.profile_path, 'w185'),
					tmdbId: c.id,
				}))
			: [];

		const directors = tmdbDetails?.credits?.crew
			? Array.from(
					new Set(
						tmdbDetails.credits.crew
							.filter((c) => c.job === 'Director')
							.map((c) => c.name),
					),
				)
			: omdbData?.director
				? omdbData.director.split(',').map((d) => d.trim()).filter(Boolean)
				: [];

		const writers = tmdbDetails?.credits?.crew
			? Array.from(
					new Set(
						tmdbDetails.credits.crew
							.filter((c) => c.department === 'Writing')
							.map((c) => c.name),
					),
				)
			: omdbData?.writer
				? omdbData.writer.split(',').map((w) => w.trim()).filter(Boolean)
				: [];

		const keywords = tmdbDetails?.keywords?.keywords
			? tmdbDetails.keywords.keywords.map((k) => k.name)
			: [];
		const productionCompanies = tmdbDetails?.production_companies?.map((c) => c.name) ?? [];

		// IMDB-backed signals (always from OMDB).
		const imdbRating = omdbData?.imdbRating ?? null;
		const imdbVotes = omdbData?.imdbVotes ?? null;
		const rottenTomatoesScore = omdbData?.rottenTomatoesScore ?? null;
		const metacriticScore = omdbData?.metacriticScore ?? null;

		// Anything that doesn't fit a column → extendedData JSON.
		const extendedData: Record<string, unknown> = {};
		if (omdbData?.awards) extendedData.omdbAwards = omdbData.awards;
		if (omdbData?.actors) extendedData.omdbActorsRaw = omdbData.actors;
		if (omdbData?.country) extendedData.omdbCountry = omdbData.country;
		if (omdbData?.language) extendedData.omdbLanguage = omdbData.language;
		if (tmdbDetails?.spoken_languages?.length) {
			extendedData.spokenLanguages = tmdbDetails.spoken_languages;
		}
		if (tmdbDetails?.production_countries?.length) {
			extendedData.productionCountries = tmdbDetails.production_countries;
		}

		const sources = [tmdbDetails ? 'tmdb' : null, omdbData ? 'omdb' : null]
			.filter(Boolean)
			.join('+');

		const metaValues = {
			movieId,
			genres: JSON.stringify(genres),
			cast: JSON.stringify(castMembers),
			directors: JSON.stringify(directors),
			writers: JSON.stringify(writers),
			keywords: JSON.stringify(keywords),
			productionCompanies: JSON.stringify(productionCompanies),
			budget: tmdbDetails?.budget || null,
			revenue: tmdbDetails?.revenue || null,
			tmdbRating: tmdbDetails?.vote_average || null,
			tmdbVotes: tmdbDetails?.vote_count || null,
			imdbRating,
			imdbVotes,
			rottenTomatoesScore,
			metacriticScore,
			extendedData: Object.keys(extendedData).length
				? JSON.stringify(extendedData)
				: null,
			source: sources,
			fetchedAt: now,
			updatedAt: now,
		};

		const existingMeta = this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();

		if (existingMeta) {
			this.database.db
				.update(movieMetadata)
				.set(metaValues)
				.where(eq(movieMetadata.id, existingMeta.id))
				.run();
		} else {
			this.database.db
				.insert(movieMetadata)
				.values({ id: crypto.randomUUID(), ...metaValues })
				.run();
		}

		this.logger.log(`Metadata merged for ${movieId} from ${sources}`);

		return this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
	}

	async refreshMetadata(movieId: string) {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) {
			throw new NotFoundException(`Movie ${movieId} not found`);
		}

		// Invalidate provider caches so a refresh fetches fresh upstream data.
		if (movie.tmdbId) {
			await this.cache.delete(CACHE_NAMESPACES.METADATA, `details:${movie.tmdbId}`);
		}
		if (movie.imdbId) {
			await this.cache.delete(CACHE_NAMESPACES.METADATA, `omdb:${movie.imdbId}`);
			await this.cache.delete(CACHE_NAMESPACES.METADATA, `find:imdb:${movie.imdbId}`);
		}
		await this.cache.delete(
			CACHE_NAMESPACES.METADATA,
			`search:${movie.title}:${movie.year ?? ''}`,
		);
		await this.cache.delete(
			CACHE_NAMESPACES.METADATA,
			`omdb:search:${movie.title}:${movie.year ?? ''}`,
		);

		return this.fetchForMovie(movieId);
	}

	async bulkFetch(movieIds: string[], concurrency: number = 3) {
		const results: { movieId: string; success: boolean; error?: string }[] = [];

		for (let i = 0; i < movieIds.length; i += concurrency) {
			const batch = movieIds.slice(i, i + concurrency);
			const batchResults = await Promise.allSettled(
				batch.map(async (movieId) => {
					await this.fetchForMovie(movieId);
					return { movieId, success: true };
				}),
			);

			for (const result of batchResults) {
				if (result.status === 'fulfilled') {
					results.push(result.value);
				} else {
					results.push({
						movieId: batch[batchResults.indexOf(result)] ?? 'unknown',
						success: false,
						error: result.reason?.message ?? 'Unknown error',
					});
				}
			}
		}

		return results;
	}

	/**
	 * Clear all metadata for a movie and reset its title to the filename-derived name.
	 */
	async clearMetadata(movieId: string): Promise<void> {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) throw new NotFoundException(`Movie ${movieId} not found`);

		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();
		let baseTitle = movie.title;
		if (file?.fileName) {
			baseTitle = file.fileName
				.replace(/\.[^.]+$/, '')
				.replace(/[._]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		}

		this.database.db
			.update(movies)
			.set({
				title: baseTitle,
				year: null,
				overview: null,
				tagline: null,
				originalTitle: null,
				posterUrl: null,
				backdropUrl: null,
				trailerUrl: null,
				imdbId: null,
				tmdbId: null,
				releaseDate: null,
				language: null,
				country: null,
				contentRating: null,
				runtimeMinutes: null,
				updatedAt: nowISO(),
			})
			.where(eq(movies.id, movieId))
			.run();

		this.database.db.delete(movieMetadata).where(eq(movieMetadata.movieId, movieId)).run();
		this.matchCandidates.clear('movie', movieId);
		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'clear-metadata' });
	}

	/**
	 * Re-probe a movie's files with FFprobe and update codec info in the DB.
	 */
	async rescanMovie(
		movieId: string,
	): Promise<{ updated: number; missing: number; errors: number }> {
		const files = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.all();

		let updated = 0;
		let missing = 0;
		let errors = 0;

		for (const file of files) {
			if (!existsSync(file.filePath)) {
				this.database.db
					.update(movieFiles)
					.set({ available: false })
					.where(eq(movieFiles.id, file.id))
					.run();
				missing++;
				continue;
			}

			try {
				const stat = statSync(file.filePath);
				if (stat.size < 1024) {
					this.database.db
						.update(movieFiles)
						.set({ available: false })
						.where(eq(movieFiles.id, file.id))
						.run();
					errors++;
					continue;
				}

				if (!file.available) {
					this.database.db
						.update(movieFiles)
						.set({ available: true })
						.where(eq(movieFiles.id, file.id))
						.run();
				}
			} catch {
				missing++;
				continue;
			}

			try {
				await new Promise<void>((resolve, reject) => {
					ffmpeg.ffprobe(file.filePath, (err, metadata) => {
						if (err) {
							reject(err);
							return;
						}

						const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
						const audioStream = metadata.streams?.find((s) => s.codec_type === 'audio');
						const width = videoStream?.width;
						const height = videoStream?.height;
						let resolution: string | undefined;
						if (height) {
							if (height >= 2160) resolution = '2160p';
							else if (height >= 1080) resolution = '1080p';
							else if (height >= 720) resolution = '720p';
							else if (height >= 480) resolution = '480p';
							else resolution = `${height}p`;
						}
						const audioStreams = (metadata.streams ?? []).filter(
							(s) => s.codec_type === 'audio',
						);
						const audioTracks = audioStreams.map((s: any, i: number) => ({
							index: i,
							codec: s.codec_name ?? 'unknown',
							language: s.tags?.language ?? 'und',
							title: s.tags?.title ?? `Track ${i + 1}`,
							channels: s.channels ?? 0,
						}));
						const subtitleStreams = (metadata.streams ?? []).filter(
							(s) => s.codec_type === 'subtitle',
						);
						const subtitleTracks = subtitleStreams.map((s: any, i: number) => ({
							index: i,
							codec: s.codec_name ?? 'unknown',
							language: s.tags?.language ?? 'und',
							title: s.tags?.title ?? `Track ${i + 1}`,
						}));

						this.database.db
							.update(movieFiles)
							.set({
								codecVideo: videoStream?.codec_name ?? null,
								codecAudio: audioStream?.codec_name ?? null,
								resolution: resolution ?? file.resolution,
								durationSeconds: metadata.format?.duration
									? Math.round(metadata.format.duration)
									: null,
								bitrate: metadata.format?.bit_rate
									? Math.round(Number(metadata.format.bit_rate))
									: null,
								videoWidth: width ?? null,
								videoHeight: height ?? null,
								audioTracks: JSON.stringify(audioTracks),
								subtitleTracks: JSON.stringify(subtitleTracks),
							})
							.where(eq(movieFiles.id, file.id))
							.run();

						resolve();
					});
				});
				updated++;
			} catch {
				errors++;
			}
		}

		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'rescan' });
		return { updated, missing, errors };
	}
}

/** Returns the first argument that is a non-empty string. */
function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
	for (const v of values) {
		if (typeof v === 'string' && v.trim().length > 0) return v;
	}
	return null;
}

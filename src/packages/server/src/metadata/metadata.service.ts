import { existsSync, statSync } from 'node:fs';
import { CACHE_NAMESPACES, nowISO, WsEvent } from '@mu/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import { CacheService } from '../cache/cache.service.js';
import { DatabaseService } from '../database/database.service.js';
import { movieFiles, movieMetadata, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { MovieIdentityService } from '../providers/identity/movie-identity.service.js';
import { MovieSourcePayloadsService } from '../providers/identity/movie-source-payloads.service.js';
import { MergeEngine } from '../providers/merge/merge-engine.js';
import type { CanonicalField, ProvenanceMap } from '../providers/merge/merge-types.js';
import { omdbToContribution } from './adapters/omdb.adapter.js';
import { tmdbToContribution } from './adapters/tmdb.adapter.js';
import { MatchCandidatesRepository } from './match-candidates.repository.js';
import {
	buildTitleQuery,
	type MatchCandidate,
	resolveMatch,
	type TitleQuery,
} from './matching/index.js';
import { OmdbProvider, OmdbSearchResult } from './providers/omdb.provider.js';
import { TmdbProvider } from './providers/tmdb.provider.js';

/** Provenance tags used in `metadata_match_candidates.provider`. */
type ProviderTag = 'tmdb' | 'omdb' | 'tmdb-tv-episode';

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
		private readonly mergeEngine: MergeEngine,
		private readonly identityService: MovieIdentityService,
		private readonly payloadsService: MovieSourcePayloadsService,
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
	async fetchForMovie(movieId: string, opts: { overwriteTitle?: boolean } = {}): Promise<any> {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) {
			throw new NotFoundException(`Movie ${movieId} not found`);
		}

		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();

		// Classify: is this row actually a TV episode (SxxEyy in
		// title/filename) or a regular movie? Drives which providers
		// we hit below.
		const query = buildTitleQuery({
			storedTitle: movie.title,
			storedYear: movie.year,
			filePath: file?.filePath ?? null,
			fileName: file?.fileName ?? null,
			durationSeconds: file?.durationSeconds ?? null,
		});
		const resolvedYear = query.year;
		const fileDurationMinutes = query.kind === 'movie' ? query.durationMinutes : null;

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
				overwriteTitle: opts.overwriteTitle,
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

		// --- 2a. TV-episode branch: SxxEyy detected in filename/title ----
		// Try the TV-episode path first when the preprocessor classified
		// this row that way. If the show search yields nothing, fall
		// through to the movie path — some genuine movies coincidentally
		// embed "S01" in their release names.
		if (query.kind === 'tv-episode') {
			const tvOutcome = await this.resolveAsTvEpisode(movieId, movie.title, query);
			if (tvOutcome !== 'fall-through') return tvOutcome;
		}

		// --- 2b. Parallel title search across providers (movie path) ------
		const searchTitle =
			query.kind === 'movie' ? query.sanitisedTitle || query.title : movie.title;
		const [tmdbSearch, omdbSearch] = await Promise.allSettled([
			this.tmdb.searchMovie(searchTitle, resolvedYear ?? undefined),
			this.omdb.searchByTitle(searchTitle, resolvedYear ?? undefined),
		]);
		const tmdbResults = tmdbSearch.status === 'fulfilled' ? (tmdbSearch.value ?? []) : [];
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
			const candYear = r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null;
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

		// --- 3. Resolve the match (apply / ambiguous / no-match) ----------
		const outcome = await resolveMatch<MovieCandidate, any>({
			entityType: 'movie',
			entityId: movieId,
			entityLabel: movie.title,
			candidates,
			query: {
				title: movie.title,
				year: resolvedYear,
				durationMinutes: fileDurationMinutes,
			},
			repository: this.matchCandidates,
			logger: this.logger,
			overviewOf: (c) => c.overview,
			onAmbiguous: () => {
				this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
					movieId,
					source: 'metadata-candidates',
				});
			},
			onConfident: async (winner) => {
				const result = await this.fetchAndMerge({
					movieId,
					tmdbId: winner.tmdbId ?? null,
					imdbId: winner.imdbId ?? null,
					priorYear: resolvedYear,
					overwriteTitle: opts.overwriteTitle,
				});
				if (result) {
					this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
						movieId,
						source: 'metadata-refresh',
					});
				}
				return result;
			},
		});

		return outcome.kind === 'applied' ? outcome.result : null;
	}

	/**
	 * TV-episode resolution path. Search TMDB TV for the show prefix,
	 * run the matcher, then on confident match fetch the specific
	 * episode and apply its fields onto the movie row.
	 *
	 * Returns:
	 *   - The applied metadata row on success.
	 *   - `null` for ambiguous (candidates persisted) or no-match.
	 *   - `'fall-through'` so the caller knows to try the movie path
	 *     when TMDB had zero TV hits — a SxxEyy-shaped string in a
	 *     genuine movie filename shouldn't black-hole the whole refresh.
	 */
	private async resolveAsTvEpisode(
		movieId: string,
		entityLabel: string,
		query: Extract<TitleQuery, { kind: 'tv-episode' }>,
	): Promise<any | 'fall-through'> {
		const tvResults = await this.tmdb.searchTv(query.showTitle, query.year ?? undefined);
		if (!tvResults || tvResults.length === 0) {
			this.logger.debug(
				`TV search for "${query.showTitle}" returned no hits — falling back to movie path`,
			);
			return 'fall-through';
		}

		const candidates: MovieCandidate[] = tvResults.map((r) => {
			const candYear = r.first_air_date ? parseInt(r.first_air_date.slice(0, 4), 10) : null;
			return {
				provider: 'tmdb-tv-episode',
				externalId: r.id,
				title: r.name,
				year: Number.isFinite(candYear) ? candYear : null,
				runtimeMinutes: null,
				popularity: r.popularity ?? null,
				posterUrl: this.tmdb.getImageUrl(r.poster_path),
				overview: r.overview,
				tmdbId: r.id,
			};
		});

		const outcome = await resolveMatch<MovieCandidate, any>({
			entityType: 'movie',
			entityId: movieId,
			entityLabel: `${entityLabel} (TV)`,
			candidates,
			query: {
				title: query.showTitle,
				year: query.year,
				// Single-episode runtime doesn't help match a SHOW — leave null.
				durationMinutes: null,
			},
			repository: this.matchCandidates,
			logger: this.logger,
			overviewOf: (c) => c.overview,
			onAmbiguous: () => {
				this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
					movieId,
					source: 'metadata-candidates',
				});
			},
			onConfident: async (winner) => {
				return this.applyTvEpisodeToMovie(movieId, Number(winner.externalId), query);
			},
		});

		return outcome.kind === 'applied' ? outcome.result : null;
	}

	/**
	 * Fetch TMDB show + episode details and write the episode's fields
	 * onto the movie row. Show-level fields (cast, IMDB ID for the show
	 * itself, posters) go into movie_metadata under a tv-episode source
	 * tag so the UI gets the full picture.
	 */
	private async applyTvEpisodeToMovie(
		movieId: string,
		tmdbTvId: number,
		query: Extract<TitleQuery, { kind: 'tv-episode' }>,
	): Promise<any | null> {
		const [tvDetails, episode] = await Promise.all([
			this.tmdb.getTvDetails(tmdbTvId),
			this.tmdb.getTvEpisodeDetails(tmdbTvId, query.season, query.episode),
		]);
		if (!tvDetails || !episode) {
			this.logger.warn(
				`TV episode resolve: tvDetails=${!!tvDetails} episode=${!!episode} tmdbTvId=${tmdbTvId} S${query.season}E${query.episode}`,
			);
			return null;
		}

		const now = nowISO();
		const episodeTitle = `${tvDetails.name} - S${pad2(query.season)}E${pad2(query.episode)} - ${episode.name}`;
		const showImdbId = tvDetails.external_ids?.imdb_id ?? null;
		const stillUrl = this.tmdb.getImageUrl(episode.still_path, 'w500');
		const backdropUrl = this.tmdb.getImageUrl(tvDetails.backdrop_path, 'w1280');
		const releaseDate = episode.air_date || tvDetails.first_air_date || null;
		const year = releaseDate ? parseInt(releaseDate.slice(0, 4), 10) : null;

		this.database.db
			.update(movies)
			.set({
				title: episodeTitle,
				originalTitle:
					tvDetails.original_name && tvDetails.original_name !== tvDetails.name
						? tvDetails.original_name
						: null,
				overview: episode.overview || tvDetails.overview || null,
				tagline: tvDetails.tagline || null,
				runtimeMinutes: episode.runtime || tvDetails.episode_run_time?.[0] || null,
				releaseDate,
				year: year && !Number.isNaN(year) ? year : null,
				// Use the still as poster; TV show backdrop as backdrop.
				// Falls back to the show's own poster if the episode has no still.
				posterUrl: stillUrl || this.tmdb.getImageUrl(tvDetails.poster_path),
				backdropUrl,
				thumbnailUrl: stillUrl,
				tmdbId: tmdbTvId,
				imdbId: showImdbId,
				language: null,
				country: null,
				contentRating: null,
				updatedAt: now,
			})
			.where(eq(movies.id, movieId))
			.run();

		const directors = (episode.crew ?? [])
			.filter((c) => c.job === 'Director')
			.map((c) => c.name);
		const writers = (episode.crew ?? [])
			.filter((c) => c.department === 'Writing')
			.map((c) => c.name);
		const cast = (tvDetails.credits?.cast ?? []).slice(0, 20).map((c) => ({
			name: c.name,
			character: c.character,
			profileUrl: this.tmdb.getImageUrl(c.profile_path, 'w185'),
			tmdbId: c.id,
		}));

		const metaValues = {
			movieId,
			genres: JSON.stringify(tvDetails.genres?.map((g) => g.name) ?? []),
			cast: JSON.stringify(cast),
			directors: JSON.stringify(directors),
			writers: JSON.stringify(writers),
			keywords: JSON.stringify(tvDetails.keywords?.results?.map((k) => k.name) ?? []),
			productionCompanies: JSON.stringify(tvDetails.networks?.map((n) => n.name) ?? []),
			budget: null,
			revenue: null,
			tmdbRating: episode.vote_average || tvDetails.vote_average || null,
			tmdbVotes: episode.vote_count || tvDetails.vote_count || null,
			imdbRating: null,
			imdbVotes: null,
			rottenTomatoesScore: null,
			metacriticScore: null,
			extendedData: JSON.stringify({
				kind: 'tv-episode',
				tmdbTvId,
				season: query.season,
				episode: query.episode,
				episodeTitle: episode.name,
				airDate: episode.air_date,
			}),
			source: 'tmdb-tv-episode',
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

		this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
			movieId,
			source: 'metadata-refresh',
		});
		this.logger.log(
			`Metadata applied for ${movieId}: ${tvDetails.name} S${query.season}E${query.episode} — ${episode.name}`,
		);

		return this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
	}

	/**
	 * Apply a user-picked candidate. Looks up the row in the candidate
	 * table, clears all candidates, then runs the regular merge fetch
	 * with the picked IDs.
	 */
	async applyCandidate(movieId: string, provider: string, externalId: string): Promise<any> {
		const row = this.matchCandidates.find('movie', movieId, provider, externalId);
		if (!row) {
			throw new NotFoundException(
				`Candidate not found: movie=${movieId} provider=${provider} externalId=${externalId}`,
			);
		}
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) throw new NotFoundException(`Movie ${movieId} not found`);

		// TV-episode candidates were saved with provider='tmdb-tv-episode'
		// and the show's TMDB id. Re-derive the season/episode from the
		// row's file so the apply hits the right episode.
		if (provider === 'tmdb-tv-episode') {
			const file = this.database.db
				.select()
				.from(movieFiles)
				.where(eq(movieFiles.movieId, movieId))
				.get();
			const query = buildTitleQuery({
				storedTitle: movie.title,
				storedYear: movie.year,
				filePath: file?.filePath ?? null,
				fileName: file?.fileName ?? null,
				durationSeconds: file?.durationSeconds ?? null,
			});
			if (query.kind !== 'tv-episode') {
				throw new NotFoundException(
					`Candidate is tagged tv-episode but file no longer parses as one (movieId=${movieId})`,
				);
			}
			const result = await this.applyTvEpisodeToMovie(movieId, Number(externalId), query);
			this.matchCandidates.clear('movie', movieId);
			this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, {
				movieId,
				source: 'metadata-candidate-applied',
			});
			return result;
		}

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
	/**
	 * Free-text provider search for the "Search for Metadata" modal, across BOTH
	 * sources: TMDB (richest — posters, overviews) and OMDb/IMDb (catches titles
	 * TMDB misses). Both provider searches are cached by query, and the later
	 * assign reuses cached details, so re-searching + selecting won't re-hit the
	 * APIs. OMDb hits that duplicate a TMDB result (same title+year) are dropped.
	 */
	async searchCandidates(
		query: string,
		_type?: string,
	): Promise<
		Array<{
			provider: 'tmdb' | 'omdb';
			tmdbId: number | null;
			imdbId: string | null;
			title: string;
			year: number | null;
			overview: string | null;
			posterUrl: string | null;
		}>
	> {
		const q = (query ?? '').trim();
		if (q.length < 2) return [];

		const [tmdbRes, omdbRes] = await Promise.allSettled([
			this.tmdb.searchMovie(q),
			this.omdb.searchMovies(q),
		]);
		const tmdbHits = tmdbRes.status === 'fulfilled' ? (tmdbRes.value ?? []) : [];
		const omdbHits = omdbRes.status === 'fulfilled' ? (omdbRes.value ?? []) : [];

		const candidates: Array<{
			provider: 'tmdb' | 'omdb';
			tmdbId: number | null;
			imdbId: string | null;
			title: string;
			year: number | null;
			overview: string | null;
			posterUrl: string | null;
		}> = [];
		const seen = new Set<string>();
		const key = (title: string, year: number | null) => `${title.toLowerCase()}|${year ?? ''}`;

		for (const r of tmdbHits.slice(0, 20)) {
			const year = r.release_date ? Number(r.release_date.slice(0, 4)) || null : null;
			seen.add(key(r.title, year));
			candidates.push({
				provider: 'tmdb',
				tmdbId: r.id,
				imdbId: null,
				title: r.title,
				year,
				overview: r.overview || null,
				posterUrl: this.tmdb.getImageUrl(r.poster_path),
			});
		}
		for (const h of omdbHits.slice(0, 15)) {
			const year = h.year ?? null;
			if (seen.has(key(h.title, year))) continue; // already shown via TMDB
			seen.add(key(h.title, year));
			candidates.push({
				provider: 'omdb',
				tmdbId: null,
				imdbId: h.imdbId,
				title: h.title,
				year,
				overview: null,
				posterUrl: h.posterUrl ?? null,
			});
		}
		return candidates;
	}

	/**
	 * Assign a user-chosen search result as a movie's metadata — same merge path
	 * as auto-match, with the official title written back. The chosen tmdbId is
	 * applied directly (no re-search); fetchAndMerge pulls cached provider
	 * details. Emits LIBRARY_MOVIE_UPDATED so the UI refreshes.
	 */
	async assignMetadata(
		movieId: string,
		opts: { tmdbId?: number | null; imdbId?: string | null },
	): Promise<any> {
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) throw new NotFoundException(`Movie ${movieId} not found`);
		if (!opts.tmdbId && !opts.imdbId) {
			throw new BadRequestException('tmdbId or imdbId required');
		}
		const result = await this.fetchAndMerge({
			movieId,
			tmdbId: opts.tmdbId ?? null,
			imdbId: opts.imdbId ?? null,
			priorYear: movie.year ?? null,
			overwriteTitle: true,
		});
		if (result) {
			this.events.emit(WsEvent.LIBRARY_MOVIE_UPDATED, { movieId, source: 'metadata-assign' });
		}
		return result;
	}

	private async fetchAndMerge(opts: {
		movieId: string;
		tmdbId: number | null;
		imdbId: string | null;
		priorYear: number | null;
		/** When true, write the merged title back too (user-triggered refresh).
		 * Off by default so background fetches never clobber a manual title. */
		overwriteTitle?: boolean;
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
		const tmdbDetails = tmdbDetailsRes.status === 'fulfilled' ? tmdbDetailsRes.value : null;
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

		const resolvedImdbId = imdbId ?? tmdbDetails?.imdb_id ?? null;
		const resolvedTmdbId = tmdbDetails?.id ?? tmdbId ?? null;

		const now = nowISO();

		// --- Phase 0.5 — generic merge path ---------------------------------
		//
		// Each provider's raw response is normalised to a SourceContribution
		// (canonical field names + values). The MergeEngine resolves
		// per-field precedence using the declarative rules in
		// providers/merge/merge-rules.ts. The result + provenance map is
		// what we persist.
		//
		// Side effects in this orchestrator (still needed because the
		// engine is scope-limited to canonical fields):
		//   - persist the raw payloads so re-merge is possible offline
		//   - link external IDs into the multi-source identity registry
		//   - keep handling tagline + extendedData (still hardcoded — they
		//     don't yet live in the canonical schema)
		const contributions = [];
		if (tmdbDetails) {
			contributions.push(
				tmdbToContribution({
					tmdbDetails,
					getImageUrl: (p, s) => this.tmdb.getImageUrl(p, s),
				}),
			);
			void this.payloadsService.store({ movieId, source: 'tmdb', payload: tmdbDetails });
		}
		if (omdbData) {
			contributions.push(omdbToContribution(omdbData, imdbId));
			void this.payloadsService.store({ movieId, source: 'omdb', payload: omdbData });
		}

		// Load existing provenance so the engine respects what's already
		// there (e.g., a user override survives a re-fetch).
		const existingMeta = this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
		const existingMovieRow = this.database.db
			.select()
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();

		const existingProvenance: ProvenanceMap = existingMeta?.provenance
			? safeJsonParse(existingMeta.provenance)
			: {};

		// Build the existing canonical record from BOTH movies hot
		// columns AND movie_metadata so engine sees the full picture.
		const existingCanonical = {
			title: existingMovieRow?.title ?? null,
			originalTitle: existingMovieRow?.originalTitle ?? null,
			year: existingMovieRow?.year ?? priorYear ?? null,
			overview: existingMovieRow?.overview ?? null,
			tmdbId: existingMovieRow?.tmdbId ?? null,
			imdbId: existingMovieRow?.imdbId ?? null,
			posterUrl: existingMovieRow?.posterUrl ?? null,
			backdropUrl: existingMovieRow?.backdropUrl ?? null,
			trailerUrl: existingMovieRow?.trailerUrl ?? null,
			releaseDate: existingMovieRow?.releaseDate ?? null,
			runtimeMinutes: existingMovieRow?.runtimeMinutes ?? null,
			language: existingMovieRow?.language ?? null,
			country: existingMovieRow?.country ?? null,
			contentRating: existingMovieRow?.contentRating ?? null,
			genres: safeJsonParse(existingMeta?.genres) ?? [],
			cast: safeJsonParse(existingMeta?.cast) ?? [],
			directors: safeJsonParse(existingMeta?.directors) ?? [],
			writers: safeJsonParse(existingMeta?.writers) ?? [],
			keywords: safeJsonParse(existingMeta?.keywords) ?? [],
			productionCompanies: safeJsonParse(existingMeta?.productionCompanies) ?? [],
			budget: existingMeta?.budget ?? null,
			revenue: existingMeta?.revenue ?? null,
			imdbRating: existingMeta?.imdbRating ?? null,
			imdbVotes: existingMeta?.imdbVotes ?? null,
			tmdbRating: existingMeta?.tmdbRating ?? null,
			tmdbVotes: existingMeta?.tmdbVotes ?? null,
			rottenTomatoesScore: existingMeta?.rottenTomatoesScore ?? null,
			metacriticScore: existingMeta?.metacriticScore ?? null,
		};

		const merge = this.mergeEngine.apply(existingCanonical, existingProvenance, contributions);
		const m = merge.merged;

		// Record identities (idempotent) so cross-source lookups work later.
		if (resolvedTmdbId) {
			await this.identityService.link({
				movieId,
				source: 'tmdb',
				externalId: resolvedTmdbId,
			});
		}
		if (resolvedImdbId) {
			await this.identityService.link({
				movieId,
				source: 'imdb',
				externalId: resolvedImdbId,
			});
		}

		// --- Write back to movies (hot columns) ------------------------------
		// `tagline` stays special: it isn't in the canonical schema and is
		// TMDB-only today. extendedData also stays here for now.
		const tagline = tmdbDetails?.tagline || null;

		const movieUpdate: Record<string, unknown> = {
			tmdbId: (m.tmdbId as number | null) ?? resolvedTmdbId,
			imdbId: (m.imdbId as string | null) ?? resolvedImdbId,
			updatedAt: now,
		};
		const setIf = (key: keyof typeof movieUpdate, val: unknown) => {
			if (val !== null && val !== undefined && val !== '') movieUpdate[key] = val;
		};
		setIf('overview', m.overview);
		if (tagline) movieUpdate.tagline = tagline;
		setIf('originalTitle', m.originalTitle);
		setIf('runtimeMinutes', m.runtimeMinutes);
		setIf('releaseDate', m.releaseDate);
		setIf('year', m.year);
		setIf('language', m.language);
		setIf('country', m.country);
		setIf('posterUrl', m.posterUrl);
		setIf('backdropUrl', m.backdropUrl);
		setIf('trailerUrl', m.trailerUrl);
		setIf('contentRating', m.contentRating);
		// Title is normally left alone so refreshes don't clobber manual edits;
		// a user-triggered "Refresh Metadata" (or new-scan auto-fetch) opts in to
		// pulling the real title back. Use the PROVIDER title directly rather
		// than the merged value — the merge engine keeps the existing title by
		// provenance, which would re-apply the same dirty title we're fixing.
		if (opts.overwriteTitle) {
			const providerTitle =
				(tmdbDetails as { title?: string } | null)?.title ||
				(omdbData as { Title?: string } | null)?.Title ||
				(m.title as string | null);
			setIf('title', providerTitle);
		}

		this.database.db.update(movies).set(movieUpdate).where(eq(movies.id, movieId)).run();

		// --- Build extendedData (untouched by engine, still hardcoded) -------
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

		// --- Write back to movie_metadata ------------------------------------
		const metaValues = {
			movieId,
			genres: JSON.stringify(m.genres ?? []),
			cast: JSON.stringify(m.cast ?? []),
			directors: JSON.stringify(m.directors ?? []),
			writers: JSON.stringify(m.writers ?? []),
			keywords: JSON.stringify(m.keywords ?? []),
			productionCompanies: JSON.stringify(m.productionCompanies ?? []),
			budget: (m.budget as number | null) ?? null,
			revenue: (m.revenue as number | null) ?? null,
			tmdbRating: (m.tmdbRating as number | null) ?? null,
			tmdbVotes: (m.tmdbVotes as number | null) ?? null,
			imdbRating: (m.imdbRating as number | null) ?? null,
			imdbVotes: (m.imdbVotes as number | null) ?? null,
			rottenTomatoesScore: (m.rottenTomatoesScore as number | null) ?? null,
			metacriticScore: (m.metacriticScore as number | null) ?? null,
			extendedData: Object.keys(extendedData).length ? JSON.stringify(extendedData) : null,
			source: sources,
			provenance: JSON.stringify(merge.provenance),
			fetchedAt: now,
			updatedAt: now,
		};

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

		this.logger.log(
			`Metadata merged for ${movieId} from ${sources} (${merge.diff.length} field change${merge.diff.length === 1 ? '' : 's'})`,
		);

		return this.database.db
			.select()
			.from(movieMetadata)
			.where(eq(movieMetadata.movieId, movieId))
			.get();
	}

	async refreshMetadata(movieId: string, opts: { overwriteTitle?: boolean } = {}) {
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

		return this.fetchForMovie(movieId, opts);
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
function safeJsonParse(input: string | null | undefined): any {
	if (!input) return null;
	try {
		return JSON.parse(input);
	} catch {
		return null;
	}
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
	for (const v of values) {
		if (typeof v === 'string' && v.trim().length > 0) return v;
	}
	return null;
}

/** Zero-pad to two digits (1 → "01"). Used for episode titles. */
function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

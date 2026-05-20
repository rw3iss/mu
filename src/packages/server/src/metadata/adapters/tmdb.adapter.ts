import type { SourceContribution } from '../../providers/merge/merge-types.js';

/**
 * TMDB-response → canonical {@link SourceContribution} adapter.
 *
 * Lives next to the providers, NOT in the MergeEngine, so the engine
 * stays source-agnostic. Each provider owns the mapping from its
 * idiosyncratic response shape to the project's canonical field names.
 */
export interface TmdbAdapterInput {
	/** Result of TmdbProvider.getMovieDetails — typed loose to avoid
	 *  a circular module dep. The relevant fields are stable. */
	tmdbDetails: any;
	getImageUrl: (path: string | null, size?: string) => string | null;
}

export function tmdbToContribution(input: TmdbAdapterInput): SourceContribution {
	const { tmdbDetails: d, getImageUrl } = input;

	const trailerVideo = d?.videos?.results?.find?.(
		(v: any) => v.site === 'YouTube' && v.type === 'Trailer',
	);
	const trailerUrl = trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : null;

	const usRelease = d?.release_dates?.results?.find?.((r: any) => r.iso_3166_1 === 'US');
	const tmdbCertification = usRelease?.release_dates
		?.map?.((rd: any) => rd.certification)
		.find?.((c: any) => c && c.length > 0);

	return {
		source: 'tmdb',
		fetchedAt: new Date().toISOString(),
		fields: {
			title: d?.title || null,
			originalTitle:
				d?.original_title && d.original_title !== d.title ? d.original_title : null,
			year: d?.release_date ? parseInt(String(d.release_date).slice(0, 4), 10) : null,
			overview: d?.overview || null,
			tmdbId: d?.id ?? null,
			imdbId: d?.imdb_id ?? null,
			posterUrl: getImageUrl(d?.poster_path ?? null) || null,
			backdropUrl: getImageUrl(d?.backdrop_path ?? null, 'w1280') || null,
			trailerUrl,
			releaseDate: d?.release_date || null,
			runtimeMinutes: d?.runtime ?? null,
			language: d?.spoken_languages?.[0]?.iso_639_1 ?? null,
			country: d?.production_countries?.[0]?.iso_3166_1 ?? null,
			contentRating: tmdbCertification ?? null,
			// movie_metadata
			genres: Array.isArray(d?.genres) ? d.genres.map((g: any) => g.name) : [],
			cast: Array.isArray(d?.credits?.cast)
				? d.credits.cast.slice(0, 20).map((c: any) => ({
						name: c.name,
						character: c.character,
						profileUrl: getImageUrl(c.profile_path, 'w185'),
						tmdbId: c.id,
					}))
				: [],
			directors: Array.isArray(d?.credits?.crew)
				? Array.from(
						new Set(
							d.credits.crew
								.filter((c: any) => c.job === 'Director')
								.map((c: any) => c.name),
						),
					)
				: [],
			writers: Array.isArray(d?.credits?.crew)
				? Array.from(
						new Set(
							d.credits.crew
								.filter((c: any) => c.department === 'Writing')
								.map((c: any) => c.name),
						),
					)
				: [],
			keywords: Array.isArray(d?.keywords?.keywords)
				? d.keywords.keywords.map((k: any) => k.name)
				: [],
			productionCompanies: Array.isArray(d?.production_companies)
				? d.production_companies.map((c: any) => c.name)
				: [],
			budget: d?.budget || null,
			revenue: d?.revenue || null,
			tmdbRating: d?.vote_average || null,
			tmdbVotes: d?.vote_count || null,
		},
	};
}

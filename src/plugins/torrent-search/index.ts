import type {
	IPlugin,
	PluginContext,
	PluginInfo,
} from '../../packages/server/src/plugins/plugin.interface.js';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

const YTS_API_BASE = 'https://yts.mx/api/v2';

interface TorrentResult {
	title: string;
	quality: string;
	size: string;
	seeders: number;
	leechers: number;
	magnetUrl: string;
	source: string;
}

interface YtsTorrent {
	url: string;
	hash: string;
	quality: string;
	type: string;
	is_repack: string;
	video_codec: string;
	bit_depth: string;
	audio_channels: string;
	seeds: number;
	peers: number;
	size: string;
	size_bytes: number;
	date_uploaded: string;
	date_uploaded_unix: number;
}

interface YtsMovie {
	id: number;
	url: string;
	imdb_code: string;
	title: string;
	title_english: string;
	title_long: string;
	slug: string;
	year: number;
	rating: number;
	runtime: number;
	genres: string[];
	summary: string;
	description_full: string;
	synopsis: string;
	yt_trailer_code: string;
	language: string;
	background_image: string;
	background_image_original: string;
	small_cover_image: string;
	medium_cover_image: string;
	large_cover_image: string;
	torrents: YtsTorrent[];
}

interface YtsListResponse {
	status: string;
	status_message: string;
	data: {
		movie_count: number;
		limit: number;
		page_number: number;
		movies?: YtsMovie[];
	};
}

export default class TorrentSearchPlugin implements IPlugin {
	private context!: PluginContext;

	async onLoad(context: PluginContext): Promise<void> {
		this.context = context;
		this.context.logger.log('Torrent Search plugin loaded');
	}

	async onUnload(): Promise<void> {
		this.context.logger.log('Torrent Search plugin unloaded');
	}

	getInfo(): PluginInfo {
		return {
			name: 'torrent-search',
			version: '1.0.0',
			description: 'Search for movie torrents across configurable sites',
			author: 'Mu',
			enabled: true,
			loaded: true,
			permissions: ['network'],
		};
	}

	/**
	 * GET /search?query=Movie+Name&year=2024
	 * Searches configured torrent sites and returns aggregated results.
	 */
	async search(query: string, year?: number): Promise<TorrentResult[]> {
		if (!query || query.trim().length === 0) {
			throw new Error('Search query is required');
		}

		const cacheKey = `torrent:search:${query.toLowerCase().trim()}:${year ?? ''}`;
		const cached = await this.context.cache.get<TorrentResult[]>(cacheKey);

		if (cached) {
			this.context.logger.debug(`Cache hit for torrent search: "${query}"`);
			return cached;
		}

		const sites = this.getConfiguredSites();
		const allResults: TorrentResult[] = [];

		// Search each configured site, collecting results and handling errors per-site
		for (const site of sites) {
			try {
				const results = await this.searchSite(site, query, year);
				allResults.push(...results);
			} catch (err) {
				this.context.logger.error(
					`Torrent search failed for site "${site}": ${err instanceof Error ? err.message : err}`,
				);
				// Continue with other sites
			}
		}

		// Sort by seeders descending for best results first
		allResults.sort((a, b) => b.seeders - a.seeders);

		await this.context.cache.set(cacheKey, allResults, CACHE_TTL_SECONDS);

		this.context.logger.log(
			`Torrent search for "${query}" returned ${allResults.length} results from ${sites.length} site(s)`,
		);

		return allResults;
	}

	/**
	 * Searches a single site for torrents.
	 * Currently supports YTS; other sites can be added here.
	 */
	private async searchSite(
		siteUrl: string,
		query: string,
		year?: number,
	): Promise<TorrentResult[]> {
		// Normalize site URL
		const normalizedUrl = siteUrl.replace(/\/+$/, '');

		if (normalizedUrl.includes('yts.mx') || normalizedUrl.includes('yts.')) {
			return this.searchYts(normalizedUrl, query, year);
		}

		this.context.logger.warn(`Unsupported torrent site: ${siteUrl}, skipping`);
		return [];
	}

	/**
	 * Searches the YTS API for movie torrents.
	 */
	private async searchYts(
		_baseUrl: string,
		query: string,
		year?: number,
	): Promise<TorrentResult[]> {
		const params = new URLSearchParams({
			query_term: query,
			sort_by: 'seeds',
			order_by: 'desc',
			limit: '20',
		});

		if (year) {
			// YTS doesn't have a year filter in API, but we can filter results
			params.set('query_term', `${query} ${year}`);
		}

		const url = `${YTS_API_BASE}/list_movies.json?${params.toString()}`;
		this.context.logger.debug(`Searching YTS: "${query}"`);

		const response = await this.context.http.fetch(url);

		if (!response.ok) {
			throw new Error(`YTS API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as YtsListResponse;

		if (data.status !== 'ok') {
			throw new Error(`YTS API error: ${data.status_message}`);
		}

		if (!data.data.movies || data.data.movies.length === 0) {
			this.context.logger.debug(`No YTS results found for "${query}"`);
			return [];
		}

		const results: TorrentResult[] = [];

		for (const movie of data.data.movies) {
			// If year was specified, filter movies that don't match
			if (year && movie.year !== year) {
				continue;
			}

			if (!movie.torrents || movie.torrents.length === 0) {
				continue;
			}

			for (const torrent of movie.torrents) {
				const magnetUrl = this.buildMagnetUrl(
					torrent.hash,
					movie.title_long || movie.title,
				);

				results.push({
					title: movie.title_long || movie.title,
					quality: torrent.quality,
					size: torrent.size,
					seeders: torrent.seeds,
					leechers: torrent.peers,
					magnetUrl,
					source: 'YTS',
				});
			}
		}

		return results;
	}

	/**
	 * Builds a magnet URL from a torrent hash and movie title.
	 */
	private buildMagnetUrl(hash: string, title: string): string {
		const encodedTitle = encodeURIComponent(title);
		const trackers = [
			'udp://open.demonii.com:1337/announce',
			'udp://tracker.openbittorrent.com:80',
			'udp://tracker.coppersurfer.tk:6969',
			'udp://glotorrents.pw:6969/announce',
			'udp://tracker.opentrackr.org:1337/announce',
			'udp://torrent.gresille.org:80/announce',
			'udp://p4p.arenabg.com:1337',
			'udp://tracker.leechers-paradise.org:6969',
		];

		const trackerParams = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');

		return `magnet:?xt=urn:btih:${hash}&dn=${encodedTitle}${trackerParams}`;
	}

	/**
	 * Returns the list of configured torrent search sites.
	 */
	private getConfiguredSites(): string[] {
		const sites = this.context.config.sites;

		if (Array.isArray(sites) && sites.length > 0) {
			return sites as string[];
		}

		// Default to YTS
		return ['https://yts.mx'];
	}
}

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { SubtitleSearchResult } from '@mu/shared';
import { ConfigService } from '../../config/config.service.js';

// ── OpenSubtitles hash algorithm ──
// hash = filesize + checksum(first 64KB) + checksum(last 64KB)
// All as 64-bit little-endian words summed with overflow

async function readChunk(filePath: string, start: number, size: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	return new Promise((resolve, reject) => {
		const stream = createReadStream(filePath, { start, end: start + size - 1 });
		stream.on('data', (chunk: Buffer) => chunks.push(chunk));
		stream.on('end', () => resolve(Buffer.concat(chunks)));
		stream.on('error', reject);
	});
}

export async function computeOpenSubtitlesHash(filePath: string): Promise<string> {
	const CHUNK_SIZE = 65536; // 64KB
	const fileStat = await stat(filePath);
	const fileSize = fileStat.size;

	if (fileSize < CHUNK_SIZE * 2) {
		throw new Error('File too small for OpenSubtitles hash');
	}

	const head = await readChunk(filePath, 0, CHUNK_SIZE);
	const tail = await readChunk(filePath, fileSize - CHUNK_SIZE, CHUNK_SIZE);

	let hash = BigInt(fileSize);

	for (let i = 0; i < CHUNK_SIZE; i += 8) {
		hash += head.readBigUInt64LE(i);
		hash = hash & 0xffffffffffffffffn; // Keep 64-bit
	}

	for (let i = 0; i < CHUNK_SIZE; i += 8) {
		hash += tail.readBigUInt64LE(i);
		hash = hash & 0xffffffffffffffffn;
	}

	return hash.toString(16).padStart(16, '0');
}

// ── Cache entry ──

interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

@Injectable()
export class SubtitleSearchService {
	private readonly logger = new Logger(SubtitleSearchService.name);
	private readonly cache = new Map<string, CacheEntry<SubtitleSearchResult[]>>();
	private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

	private readonly OS_API_BASE = 'https://api.opensubtitles.com/api/v1';
	private readonly OS_API_KEY: string;
	private readonly OS_USER_AGENT = 'Mu v1.0';

	constructor(private readonly config: ConfigService) {
		this.OS_API_KEY = this.config.get<string>('thirdParty.opensubtitles.apiKey', '');
	}

	/**
	 * Search for subtitles using available providers.
	 * Combines results from OpenSubtitles (and optionally SubDL in the future).
	 */
	async search(params: {
		title: string;
		imdbId?: string;
		tmdbId?: number;
		year?: number;
		filePath?: string;
		language?: string;
	}): Promise<SubtitleSearchResult[]> {
		const cacheKey = `${params.title}:${params.imdbId || ''}:${params.language || 'en'}`;
		const cached = this.cache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			this.logger.debug(`Subtitle search cache hit for "${params.title}"`);
			return cached.data;
		}

		const results: SubtitleSearchResult[] = [];

		// Try OpenSubtitles
		if (this.OS_API_KEY) {
			try {
				const osResults = await this.searchOpenSubtitles(params);
				results.push(...osResults);
			} catch (err) {
				this.logger.warn(`OpenSubtitles search failed: ${err}`);
			}
		} else {
			this.logger.debug('OpenSubtitles API key not configured, skipping');
		}

		// Cache results
		this.cache.set(cacheKey, {
			data: results,
			expiresAt: Date.now() + this.CACHE_TTL_MS,
		});

		// Evict old cache entries periodically
		if (this.cache.size > 200) {
			const now = Date.now();
			for (const [key, entry] of this.cache) {
				if (entry.expiresAt < now) this.cache.delete(key);
			}
		}

		return results;
	}

	/**
	 * Download a subtitle file from OpenSubtitles and return the content as a Buffer.
	 * Returns { data, fileName, format }.
	 */
	async downloadFromProvider(
		provider: string,
		fileId: string,
	): Promise<{ data: Buffer; fileName: string; format: string }> {
		if (provider === 'opensubtitles') {
			return this.downloadFromOpenSubtitles(fileId);
		}
		throw new Error(`Unknown subtitle provider: ${provider}`);
	}

	// ── OpenSubtitles implementation ──

	private async searchOpenSubtitles(params: {
		title: string;
		imdbId?: string;
		tmdbId?: number;
		year?: number;
		filePath?: string;
		language?: string;
	}): Promise<SubtitleSearchResult[]> {
		const queryParams = new URLSearchParams();

		// Prefer IMDB ID for precise matching
		if (params.imdbId) {
			const numericId = params.imdbId.replace(/^tt/, '');
			queryParams.set('imdb_id', numericId);
		} else if (params.tmdbId) {
			queryParams.set('tmdb_id', String(params.tmdbId));
		} else {
			queryParams.set('query', params.title);
			if (params.year) queryParams.set('year', String(params.year));
		}

		queryParams.set('languages', params.language || 'en');
		queryParams.set('order_by', 'download_count');
		queryParams.set('order_direction', 'desc');

		// Try file hash for better matching
		let movieHash: string | undefined;
		if (params.filePath) {
			try {
				movieHash = await computeOpenSubtitlesHash(params.filePath);
				queryParams.set('moviehash', movieHash);
			} catch {
				// File may be too small or inaccessible
			}
		}

		const url = `${this.OS_API_BASE}/subtitles?${queryParams.toString()}`;

		const response = await fetch(url, {
			headers: {
				'Api-Key': this.OS_API_KEY,
				'User-Agent': this.OS_USER_AGENT,
				Accept: 'application/json',
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`OpenSubtitles API error ${response.status}: ${body}`);
		}

		const json = (await response.json()) as any;
		const results: SubtitleSearchResult[] = [];

		for (const item of json.data || []) {
			const attrs = item.attributes;
			if (!attrs) continue;

			// Each item may have multiple files; typically just one
			for (const file of attrs.files || []) {
				results.push({
					fileId: String(file.file_id),
					provider: 'opensubtitles',
					language: attrs.language || 'en',
					label: this.buildLabel(attrs),
					downloads: attrs.download_count,
					hearingImpaired: attrs.hearing_impaired ?? false,
					hashMatch: attrs.moviehash_match ?? false,
					releaseName: attrs.release || attrs.feature_details?.movie_name,
					format: file.format || 'srt',
				});
			}
		}

		this.logger.debug(`OpenSubtitles returned ${results.length} results for "${params.title}"`);
		return results;
	}

	private buildLabel(attrs: any): string {
		const lang = (attrs.language || 'en').toUpperCase();
		const release = attrs.release || '';
		const hi = attrs.hearing_impaired ? ' [HI]' : '';
		return release ? `${lang} - ${release}${hi}` : `${lang}${hi}`;
	}

	private async downloadFromOpenSubtitles(
		fileId: string,
	): Promise<{ data: Buffer; fileName: string; format: string }> {
		// Step 1: Request download link
		const response = await fetch(`${this.OS_API_BASE}/download`, {
			method: 'POST',
			headers: {
				'Api-Key': this.OS_API_KEY,
				'User-Agent': this.OS_USER_AGENT,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({ file_id: Number(fileId) }),
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`OpenSubtitles download request failed ${response.status}: ${body}`);
		}

		const json = (await response.json()) as any;
		const downloadUrl = json.link;
		const fileName = json.file_name || `subtitle_${fileId}.srt`;

		if (!downloadUrl) {
			throw new Error('No download link returned from OpenSubtitles');
		}

		// Step 2: Fetch the actual subtitle file
		const fileResponse = await fetch(downloadUrl);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download subtitle file: ${fileResponse.status}`);
		}

		const data = Buffer.from(await fileResponse.arrayBuffer());
		const format = path.extname(fileName).replace('.', '') || 'srt';

		return { data, fileName, format };
	}
}

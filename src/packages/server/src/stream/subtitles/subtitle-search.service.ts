import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { SubtitleSearchResult } from '@mu/shared';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';

// ── OpenSubtitles hash algorithm ──

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
		hash = hash & 0xffffffffffffffffn;
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

	private readonly SUBDL_API_BASE = 'https://api.subdl.com/api/v1/subtitles';

	constructor(private readonly config: ConfigService) {
		this.OS_API_KEY = this.config.get<string>('thirdParty.opensubtitles.apiKey', '');
	}

	/**
	 * Search for subtitles using available providers.
	 * Combines results from OpenSubtitles and Subdl.
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

		// Search all providers in parallel
		const searches: Promise<SubtitleSearchResult[]>[] = [];

		if (this.OS_API_KEY) {
			searches.push(
				this.searchOpenSubtitles(params).catch((err) => {
					this.logger.warn(`OpenSubtitles search failed: ${err}`);
					return [];
				}),
			);
		}

		// Subdl — no API key required
		searches.push(
			this.searchSubdl(params).catch((err) => {
				this.logger.warn(`Subdl search failed: ${err}`);
				return [];
			}),
		);

		const allResults = await Promise.all(searches);
		const results = allResults.flat();

		// Deduplicate by release name + language
		const seen = new Set<string>();
		const deduped = results.filter((r) => {
			const key = `${r.provider}:${r.fileId}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		// Cache results
		this.cache.set(cacheKey, {
			data: deduped,
			expiresAt: Date.now() + this.CACHE_TTL_MS,
		});

		// Evict old cache entries periodically
		if (this.cache.size > 200) {
			const now = Date.now();
			for (const [key, entry] of this.cache) {
				if (entry.expiresAt < now) this.cache.delete(key);
			}
		}

		return deduped;
	}

	/**
	 * Download a subtitle file from a provider and return the content as a Buffer.
	 */
	async downloadFromProvider(
		provider: string,
		fileId: string,
	): Promise<{ data: Buffer; fileName: string; format: string }> {
		if (provider === 'opensubtitles') {
			return this.downloadFromOpenSubtitles(fileId);
		}
		if (provider === 'subdl') {
			return this.downloadFromSubdl(fileId);
		}
		throw new BadRequestException(`Unknown subtitle provider: ${provider}`);
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

			for (const file of attrs.files || []) {
				results.push({
					fileId: String(file.file_id),
					provider: 'opensubtitles',
					language: attrs.language || 'en',
					label: this.buildLabel(attrs, 'OS'),
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

	private async downloadFromOpenSubtitles(
		fileId: string,
	): Promise<{ data: Buffer; fileName: string; format: string }> {
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
			try {
				const err = JSON.parse(body);
				if (response.status === 406 && err.message) {
					throw new BadRequestException(err.message);
				}
			} catch (e) {
				if (e instanceof BadRequestException) throw e;
			}
			throw new BadRequestException(
				`OpenSubtitles error (${response.status}): ${body.slice(0, 200)}`,
			);
		}

		const json = (await response.json()) as any;
		const downloadUrl = json.link;
		const fileName = json.file_name || `subtitle_${fileId}.srt`;

		if (!downloadUrl) {
			throw new Error('No download link returned from OpenSubtitles');
		}

		const fileResponse = await fetch(downloadUrl);
		if (!fileResponse.ok) {
			throw new Error(`Failed to download subtitle file: ${fileResponse.status}`);
		}

		const data = Buffer.from(await fileResponse.arrayBuffer());
		const format = path.extname(fileName).replace('.', '') || 'srt';

		return { data, fileName, format };
	}

	// ── Subdl implementation ──

	private async searchSubdl(params: {
		title: string;
		imdbId?: string;
		tmdbId?: number;
		year?: number;
		language?: string;
	}): Promise<SubtitleSearchResult[]> {
		const queryParams = new URLSearchParams();

		if (params.imdbId) {
			queryParams.set('imdb_id', params.imdbId);
		} else if (params.tmdbId) {
			queryParams.set('tmdb_id', String(params.tmdbId));
		} else {
			queryParams.set('film_name', params.title);
			if (params.year) queryParams.set('year', String(params.year));
		}

		// Subdl uses full language names or ISO 639-1 codes
		const langMap: Record<string, string> = {
			en: 'english',
			es: 'spanish',
			fr: 'french',
			de: 'german',
			it: 'italian',
			pt: 'portuguese',
			ru: 'russian',
			ja: 'japanese',
			ko: 'korean',
			zh: 'chinese',
			ar: 'arabic',
			nl: 'dutch',
			pl: 'polish',
			sv: 'swedish',
			tr: 'turkish',
		};
		const lang = params.language || 'en';
		queryParams.set('languages', langMap[lang] || lang);
		queryParams.set('type', 'movie');

		const url = `${this.SUBDL_API_BASE}?${queryParams.toString()}`;

		const response = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'User-Agent': this.OS_USER_AGENT,
			},
		});

		if (!response.ok) {
			throw new Error(`Subdl API error ${response.status}`);
		}

		const json = (await response.json()) as any;
		const results: SubtitleSearchResult[] = [];

		// Subdl returns { status: true, subtitles: [...] }
		for (const item of json.subtitles || []) {
			results.push({
				fileId: item.url || item.id || '',
				provider: 'subdl',
				language: lang,
				label: this.buildLabel(
					{
						language: lang,
						release: item.release_name || item.name,
						hearing_impaired: item.hi,
					},
					'Subdl',
				),
				downloads: item.download_count ?? 0,
				hearingImpaired: item.hi ?? false,
				hashMatch: false,
				releaseName: item.release_name || item.name,
				format: 'srt',
			});
		}

		this.logger.debug(`Subdl returned ${results.length} results for "${params.title}"`);
		return results;
	}

	private async downloadFromSubdl(
		fileUrl: string,
	): Promise<{ data: Buffer; fileName: string; format: string }> {
		// Subdl fileId is the download URL path
		const downloadUrl = fileUrl.startsWith('http') ? fileUrl : `https://dl.subdl.com${fileUrl}`;

		const response = await fetch(downloadUrl, {
			headers: { 'User-Agent': this.OS_USER_AGENT },
		});

		if (!response.ok) {
			throw new BadRequestException(`Subdl download failed: ${response.status}`);
		}

		const contentType = response.headers.get('content-type') || '';
		const data = Buffer.from(await response.arrayBuffer());

		// Subdl returns zip files — extract the subtitle
		if (contentType.includes('zip') || downloadUrl.endsWith('.zip')) {
			return this.extractSubtitleFromZip(data, fileUrl);
		}

		const fileName = `subtitle.srt`;
		return { data, fileName, format: 'srt' };
	}

	/**
	 * Extract a subtitle file from a zip archive.
	 * Uses Node's built-in zip support or falls back to manual extraction.
	 */
	private async extractSubtitleFromZip(
		zipData: Buffer,
		sourceId: string,
	): Promise<{ data: Buffer; fileName: string; format: string }> {
		// Simple zip extraction — find the first .srt/.vtt/.ass file
		// ZIP local file header signature: PK\x03\x04
		const SUB_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
		let offset = 0;

		while (offset < zipData.length - 4) {
			// Look for local file header
			if (
				zipData[offset] === 0x50 &&
				zipData[offset + 1] === 0x4b &&
				zipData[offset + 2] === 0x03 &&
				zipData[offset + 3] === 0x04
			) {
				const compMethod = zipData.readUInt16LE(offset + 8);
				const compSize = zipData.readUInt32LE(offset + 18);
				const uncompSize = zipData.readUInt32LE(offset + 22);
				const nameLen = zipData.readUInt16LE(offset + 26);
				const extraLen = zipData.readUInt16LE(offset + 28);
				const fileName = zipData.toString('utf-8', offset + 30, offset + 30 + nameLen);
				const dataStart = offset + 30 + nameLen + extraLen;

				const ext = path.extname(fileName).toLowerCase();
				if (SUB_EXTENSIONS.includes(ext) && compMethod === 0) {
					// Stored (no compression) — extract directly
					const fileData = zipData.subarray(dataStart, dataStart + uncompSize);
					const format = ext.replace('.', '');
					return { data: Buffer.from(fileData), fileName, format };
				}

				if (SUB_EXTENSIONS.includes(ext) && compMethod === 8) {
					// Deflate compression — use zlib
					const { inflateRawSync } = await import('node:zlib');
					const compressed = zipData.subarray(dataStart, dataStart + compSize);
					const fileData = inflateRawSync(compressed);
					const format = ext.replace('.', '');
					return { data: fileData, fileName, format };
				}

				offset = dataStart + compSize;
			} else {
				offset++;
			}
		}

		throw new BadRequestException('No subtitle file found in downloaded archive');
	}

	private buildLabel(attrs: any, source?: string): string {
		const lang = (attrs.language || 'en').toUpperCase();
		const release = attrs.release || '';
		const hi = attrs.hearing_impaired ? ' [HI]' : '';
		const src = source ? ` [${source}]` : '';
		return release ? `${lang} - ${release}${hi}${src}` : `${lang}${hi}${src}`;
	}
}

import type { AlbumFilmLink } from '@mu/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { albumReleases, albums } from '../../database/schema/index.js';

const SOUNDTRACK_HINT =
	/\b(soundtrack|motion picture|original score|music from|songs from|ost|film score)\b/i;

/**
 * Strip soundtrack decorations from an album title to recover the film title:
 * "The Matrix: Original Motion Picture Soundtrack" → "the matrix",
 * "Drive (Original Motion Picture Soundtrack)" → "drive",
 * "Music From the Motion Picture Pulp Fiction" → "pulp fiction".
 */
export function soundtrackBaseTitle(albumTitle: string): string {
	let t = albumTitle.trim();
	t = t.replace(
		/^(original\s+)?(music|songs)\s+from\s+(the\s+)?(original\s+)?(motion\s+picture|film|movie)\s+/i,
		'',
	);
	t = t.replace(/\s*[([].*?(soundtrack|motion picture|score|music from|ost).*?[)\]]\s*$/i, '');
	t = t.replace(
		/\s*[:\-–—]\s*(the\s+)?(original|music|songs|score|ost|soundtrack|motion picture).*$/i,
		'',
	);
	t = t.replace(/\s+(original\s+)?(motion\s+picture\s+)?(soundtrack|score|ost)$/i, '');
	return t.trim().toLowerCase();
}

export function looksLikeSoundtrack(title: string, secondaryTypes: string[]): boolean {
	return (
		secondaryTypes.some((s) => s.toLowerCase() === 'soundtrack') || SOUNDTRACK_HINT.test(title)
	);
}

/**
 * Album → film cross-links. Two cheap matches:
 *  1. `soundtrack_cache` rows whose MusicBrainz release MBID is one of the
 *     album's releases (exact — the movie page already resolved this album).
 *  2. Soundtrack-looking albums (MB secondary type or title hint): film title
 *     (decorations stripped) equals a library movie title, year within ±1.
 */
@Injectable()
export class AlbumFilmsService {
	constructor(private readonly database: DatabaseService) {}

	filmsForAlbum(albumId: string): AlbumFilmLink[] {
		const db = this.database.db;
		const album = db
			.select({
				title: albums.title,
				year: albums.year,
				originalYear: albums.originalYear,
				secondaryTypes: albums.secondaryTypes,
			})
			.from(albums)
			.where(eq(albums.id, albumId))
			.get();
		if (!album) throw new NotFoundException('Album not found');

		const out = new Map<string, AlbumFilmLink>();
		const releaseMbids = db
			.select({ mbid: albumReleases.mbidRelease })
			.from(albumReleases)
			.where(eq(albumReleases.albumId, albumId))
			.all()
			.map((r) => r.mbid)
			.filter((m): m is string => !!m);
		if (releaseMbids.length) {
			const rows = db.all<{
				id: string;
				title: string;
				year: number | null;
				poster: string | null;
			}>(sql`
				SELECT m.id AS id, m.title AS title, m.year AS year, m.poster_url AS poster
				FROM soundtrack_cache sc JOIN movies m ON m.id = sc.movie_id
				WHERE sc.found = 1 AND m.source = 'library' AND json_extract(sc.payload, '$.release.mbid') IN (${sql.join(
					releaseMbids.map((m) => sql`${m}`),
					sql`, `,
				)})`);
			for (const r of rows) {
				out.set(r.id, {
					movieId: r.id,
					title: r.title,
					year: r.year,
					posterUrl: r.poster,
					via: 'soundtrack-cache',
				});
			}
		}

		let secondary: string[] = [];
		try {
			secondary = JSON.parse(album.secondaryTypes ?? '[]');
		} catch {}
		if (out.size === 0 && looksLikeSoundtrack(album.title, secondary)) {
			const base = soundtrackBaseTitle(album.title);
			const year = album.originalYear ?? album.year;
			if (base.length >= 2) {
				const rows = db.all<{
					id: string;
					title: string;
					year: number | null;
					poster: string | null;
				}>(sql`
					SELECT id, title, year, poster_url AS poster FROM movies
					WHERE source = 'library' AND lower(title) = ${base} LIMIT 5`);
				for (const r of rows) {
					if (year != null && r.year != null && Math.abs(r.year - year) > 1) continue;
					out.set(r.id, {
						movieId: r.id,
						title: r.title,
						year: r.year,
						posterUrl: r.poster,
						via: 'title-year',
					});
				}
			}
		}
		return [...out.values()];
	}
}

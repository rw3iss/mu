import { basename, dirname, extname } from 'node:path';
import { parseFile } from 'music-metadata';
import { splitCredit } from './normalize.js';

/** Normalised view of one audio file — everything the catalogue needs. */
export interface TrackTags {
	title: string;
	/** Track artist display credit. */
	artistCredit: string | null;
	/** Ordered track artists (from multi-value ARTISTS, else split credit). */
	artists: string[];
	featured: string[];
	albumArtistCredit: string | null;
	albumArtists: string[];
	album: string | null;
	discNo: number;
	discTotal: number | null;
	trackNo: number | null;
	trackTotal: number | null;
	year: number | null;
	originalYear: number | null;
	genres: string[];
	compilation: boolean;
	isrc: string | null;
	mbid: {
		recording: string | null;
		release: string | null;
		releaseGroup: string | null;
		artists: string[];
		albumArtists: string[];
	};
	composer: string[];
	replaygainTrack: number | null;
	replaygainAlbum: number | null;
	durationSeconds: number | null;
	container: string | null;
	codec: string | null;
	bitrate: number | null;
	sampleRate: number | null;
	bitDepth: number | null;
	channels: number | null;
	lossless: boolean;
	picture: { data: Uint8Array; mime: string } | null;
	/** True when title/artist/album came from the filename, not tags. */
	fromFilename: boolean;
}

function first<T>(v: T | T[] | undefined | null): T | null {
	if (v == null) return null;
	return Array.isArray(v) ? (v[0] ?? null) : v;
}

function yearOf(v: string | number | undefined | null): number | null {
	if (v == null) return null;
	const m = String(v).match(/\d{4}/);
	return m ? Number(m[0]) : null;
}

/**
 * Filename/folder fallback for untagged files. Handles the common layouts:
 *   Artist/Album (Year)/01 - Title.flac
 *   Artist - Album/01 Artist - Title.mp3
 */
export function parsePathFallback(filePath: string): {
	title: string;
	artist: string | null;
	album: string | null;
	trackNo: number | null;
	discNo: number | null;
	year: number | null;
} {
	const file = basename(filePath, extname(filePath));
	const albumDir = basename(dirname(filePath));
	const artistDir = basename(dirname(dirname(filePath)));

	let rest = file;
	let trackNo: number | null = null;
	let discNo: number | null = null;
	const num = rest.match(/^(?:(\d)[-.])?(\d{1,3})[\s._-]+/);
	if (num) {
		if (num[1]) discNo = Number(num[1]);
		trackNo = Number(num[2]);
		rest = rest.slice(num[0].length);
	}
	let artist: string | null = null;
	const dash = rest.split(/\s+-\s+/);
	if (dash.length >= 2) {
		artist = dash[0]!.trim();
		rest = dash.slice(1).join(' - ');
	}

	let album: string | null = albumDir || null;
	let year: number | null = null;
	if (album) {
		const y = album.match(/[([]((?:19|20)\d{2})[)\]]/) ?? album.match(/^((?:19|20)\d{2})\s*-\s*/);
		if (y) {
			year = Number(y[1]);
			album = album.replace(y[0], '').trim();
		}
		const ad = album.split(/\s+-\s+/);
		if (ad.length === 2 && !artist) {
			artist = ad[0]!.trim();
			album = ad[1]!.trim();
		}
	}
	if (!artist && artistDir && artistDir !== '.' && artistDir !== '/') artist = artistDir;

	return {
		title: rest.replace(/_/g, ' ').trim() || file,
		artist,
		album,
		trackNo,
		discNo,
		year,
	};
}

/** Read tags + stream facts from one file. Never throws on tag noise. */
export async function readTrackTags(filePath: string): Promise<TrackTags> {
	const meta = await parseFile(filePath, { duration: true, skipCovers: false });
	const c = meta.common;
	const f = meta.format;
	const fallback = parsePathFallback(filePath);

	const artistCredit = c.artist?.trim() || null;
	const multiArtists = (c.artists ?? []).map((a) => a.trim()).filter(Boolean);
	const split = artistCredit ? splitCredit(artistCredit) : { primary: [], featured: [] };
	// music-metadata mirrors a single ARTIST tag into `artists`, so a one-item
	// list equal to the credit carries no extra information — split the credit
	// instead, or "A feat. B" would be catalogued as one artist.
	const realMulti = multiArtists.length > 1 || (multiArtists.length === 1 && multiArtists[0] !== artistCredit);
	const artists = realMulti ? multiArtists : split.primary;
	const albumArtistCredit = c.albumartist?.trim() || null;
	const albumArtists = albumArtistCredit ? splitCredit(albumArtistCredit).primary : [];

	const fromFilename = !c.title && !artistCredit && !c.album;
	const pic = first(c.picture);

	const anyC = c as unknown as Record<string, unknown>;
	const rg = (k: string): number | null => {
		const v = anyC[k] as { dB?: number } | undefined;
		return typeof v?.dB === 'number' ? v.dB : null;
	};

	return {
		title: c.title?.trim() || fallback.title,
		artistCredit: artistCredit ?? fallback.artist,
		artists: artists.length > 0 ? artists : fallback.artist ? [fallback.artist] : [],
		featured: split.featured,
		albumArtistCredit,
		albumArtists,
		album: c.album?.trim() || fallback.album,
		discNo: c.disk?.no ?? fallback.discNo ?? 1,
		discTotal: c.disk?.of ?? null,
		trackNo: c.track?.no ?? fallback.trackNo,
		trackTotal: c.track?.of ?? null,
		year: c.year ?? yearOf(c.date) ?? fallback.year,
		originalYear: yearOf(c.originaldate) ?? yearOf(c.originalyear as unknown as string),
		genres: (c.genre ?? []).flatMap((g) => g.split(/\s*[;/]\s*/)).map((g) => g.trim()).filter(Boolean),
		compilation: c.compilation === true,
		isrc: first(c.isrc),
		mbid: {
			recording: c.musicbrainz_recordingid ?? null,
			release: c.musicbrainz_albumid ?? null,
			releaseGroup: c.musicbrainz_releasegroupid ?? null,
			artists: c.musicbrainz_artistid ?? [],
			albumArtists: c.musicbrainz_albumartistid ?? [],
		},
		composer: c.composer ?? [],
		replaygainTrack: rg('replaygain_track_gain'),
		replaygainAlbum: rg('replaygain_album_gain'),
		durationSeconds: typeof f.duration === 'number' ? f.duration : null,
		container: f.container ?? null,
		codec: f.codec ?? null,
		bitrate: typeof f.bitrate === 'number' ? Math.round(f.bitrate) : null,
		sampleRate: f.sampleRate ?? null,
		bitDepth: f.bitsPerSample ?? null,
		channels: f.numberOfChannels ?? null,
		lossless: f.lossless === true,
		picture: pic ? { data: pic.data, mime: pic.format || 'image/jpeg' } : null,
		fromFilename,
	};
}

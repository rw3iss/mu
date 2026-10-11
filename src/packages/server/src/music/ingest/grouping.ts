import { dirname } from 'node:path';
import type { MusicSettings } from '@mu/shared';
import { normKey } from './normalize.js';
import type { TrackTags } from './tags.js';

/**
 * Which album a file belongs to.
 *
 * - MusicBrainz release-group id wins when tagged (exact).
 * - Otherwise (album artist | "various", album title), optionally scoped to
 *   the containing folder. The folder scope splits same-titled albums by
 *   different artists ("Greatest Hits") and keeps untagged rips together; the
 *   album-artist part keeps a compilation's tracks (each with its own track
 *   artist) on one album.
 */
export function albumGroupKey(
	tags: TrackTags,
	filePath: string,
	mode: MusicSettings['grouping'],
): string {
	if (tags.mbid.releaseGroup && mode !== 'folder') return `rg:${tags.mbid.releaseGroup}`;
	const folder = normKey(dirname(filePath));
	if (mode === 'folder') return `dir:${folder}`;
	const album = normKey(tags.album ?? '(unknown album)');
	if (mode === 'tags') {
		const albumArtist = tags.compilation
			? 'various'
			: normKey(tags.albumArtistCredit ?? tags.artists[0] ?? tags.artistCredit ?? '');
		return `tag:${albumArtist}|${album}`;
	}
	// tags+folder: the folder already separates same-titled albums, so the
	// key is just (album title, folder). The album-artist tag is deliberately
	// NOT part of it: rips where only some files carry ALBUMARTIST used to
	// split one folder into two albums with the same name.
	return `tf:${album}|${folder}`;
}

/** Display credit for the album: album-artist tag, "Various Artists", or the track artist. */
export function albumArtistCredit(tags: TrackTags): {
	credit: string;
	names: string[];
	various: boolean;
} {
	if (tags.compilation && !tags.albumArtistCredit) {
		return { credit: 'Various Artists', names: [], various: true };
	}
	if (tags.albumArtistCredit) {
		const various = /^various( artists)?$/i.test(tags.albumArtistCredit);
		return {
			credit: tags.albumArtistCredit,
			names: various
				? []
				: tags.albumArtists.length
					? tags.albumArtists
					: [tags.albumArtistCredit],
			various,
		};
	}
	const name = tags.artists[0] ?? tags.artistCredit ?? 'Unknown Artist';
	return { credit: tags.artistCredit ?? name, names: [name], various: false };
}

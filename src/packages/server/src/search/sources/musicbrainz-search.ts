import type { MusicSearchHit } from '@mu/shared';
import {
	creditName,
	escapeLucene,
	type MbArtistCredit,
	type MusicBrainzClient,
} from '../../providers/sources/musicbrainz/musicbrainz.client.js';
import { scoreMusic } from '../dedup.js';

/** Lucene relevance floor — MB returns fuzzy junk below this. */
const MIN_MB_SCORE = 55;
const LIMIT = 8;

export const caaReleaseGroupFront = (rgMbid: string, size: 250 | 500 = 250) =>
	`https://coverartarchive.org/release-group/${rgMbid}/front-${size}`;

const yearOf = (date?: string): number | undefined => {
	const y = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
	return Number.isFinite(y) ? y : undefined;
};

interface MbArtistHit {
	id: string;
	name: string;
	score?: number;
	type?: string;
	country?: string;
	disambiguation?: string;
}
interface MbReleaseGroupHit {
	id: string;
	title: string;
	score?: number;
	'primary-type'?: string;
	'secondary-types'?: string[];
	'first-release-date'?: string;
	'artist-credit'?: MbArtistCredit[];
}
interface MbRecordingHit {
	id: string;
	title: string;
	score?: number;
	length?: number | null;
	'first-release-date'?: string;
	'artist-credit'?: MbArtistCredit[];
	releases?: Array<{
		id: string;
		title?: string;
		'release-group'?: { id: string; 'primary-type'?: string };
	}>;
}

type MbGet = Pick<MusicBrainzClient, 'get'>;

function q(query: string): string {
	return encodeURIComponent(escapeLucene(query));
}

export async function mbSearchArtists(mb: MbGet, query: string): Promise<MusicSearchHit[] | null> {
	const res = await mb.get<{ artists?: MbArtistHit[] }>(
		`/artist/?query=${q(query)}&limit=${LIMIT}`,
	);
	if (!res) throw new Error('MusicBrainz unavailable');
	return (res.artists ?? [])
		.filter((a) => (a.score ?? 100) >= MIN_MB_SCORE)
		.map((a) => {
			const hit: MusicSearchHit = {
				kind: 'artist',
				mbid: a.id,
				title: a.name,
				detail:
					[a.disambiguation, a.type, a.country].filter(Boolean).join(' · ') || undefined,
				sources: ['musicbrainz'],
				isOwned: false,
				matchScore: 0,
			};
			hit.matchScore = scoreMusic(query, hit);
			return hit;
		});
}

export async function mbSearchReleaseGroups(
	mb: MbGet,
	query: string,
): Promise<MusicSearchHit[] | null> {
	const res = await mb.get<{ 'release-groups'?: MbReleaseGroupHit[] }>(
		`/release-group/?query=${q(query)}&limit=${LIMIT}`,
	);
	if (!res) throw new Error('MusicBrainz unavailable');
	return (res['release-groups'] ?? [])
		.filter((r) => (r.score ?? 100) >= MIN_MB_SCORE)
		.map((r) => {
			const hit: MusicSearchHit = {
				kind: 'album',
				mbid: r.id,
				title: r.title,
				artist: creditName(r['artist-credit']) ?? undefined,
				year: yearOf(r['first-release-date']),
				primaryType:
					[r['primary-type'], ...(r['secondary-types'] ?? [])]
						.filter(Boolean)
						.join(' · ') || undefined,
				artUrl: caaReleaseGroupFront(r.id),
				sources: ['musicbrainz'],
				isOwned: false,
				matchScore: 0,
			};
			hit.matchScore = scoreMusic(query, hit);
			return hit;
		});
}

export async function mbSearchRecordings(
	mb: MbGet,
	query: string,
): Promise<MusicSearchHit[] | null> {
	const res = await mb.get<{ recordings?: MbRecordingHit[] }>(
		`/recording/?query=${q(query)}&limit=${LIMIT}`,
	);
	if (!res) throw new Error('MusicBrainz unavailable');
	return (res.recordings ?? [])
		.filter((r) => (r.score ?? 100) >= MIN_MB_SCORE)
		.map((r) => {
			// Prefer an Album release group over singles/compilations for the link.
			const rel =
				r.releases?.find((x) => x['release-group']?.['primary-type'] === 'Album') ??
				r.releases?.[0];
			const rg = rel?.['release-group']?.id;
			const hit: MusicSearchHit = {
				kind: 'track',
				mbid: r.id,
				title: r.title,
				artist: creditName(r['artist-credit']) ?? undefined,
				album: rel?.title,
				albumMbid: rg,
				year: yearOf(r['first-release-date']),
				durationSeconds: r.length ? Math.round(r.length / 1000) : undefined,
				artUrl: rg ? caaReleaseGroupFront(rg) : undefined,
				sources: ['musicbrainz'],
				isOwned: false,
				matchScore: 0,
			};
			hit.matchScore = scoreMusic(query, hit);
			return hit;
		});
}

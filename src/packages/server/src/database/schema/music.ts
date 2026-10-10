import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { mediaSources } from './media-sources.ts';

/**
 * Music catalogue. Owned by MusicModule; nothing in the movie code reads these.
 * See docs/music-support-plan.md §4.1.
 */

export const artwork = sqliteTable(
	'artwork',
	{
		id: text('id').primaryKey(),
		/** 'album' | 'artist' */
		kind: text('kind').notNull(),
		/** 'embedded' | 'folder' | 'coverartarchive' | 'lastfm' | 'wikidata' | 'upload' */
		source: text('source').notNull(),
		/** Path of the stored original under <dataDir>/artwork/. */
		originalPath: text('original_path').notNull(),
		hash: text('hash').notNull(),
		width: integer('width'),
		height: integer('height'),
		createdAt: text('created_at').notNull(),
	},
	(t) => ({ hashIdx: uniqueIndex('artwork_hash_idx').on(t.hash) }),
);

export const artists = sqliteTable(
	'artists',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		sortName: text('sort_name').notNull(),
		/** Normalised name used for find-or-create when there is no MBID. */
		normName: text('norm_name').notNull(),
		mbid: text('mbid'),
		/** person | group | orchestra | choir | character | other */
		type: text('type'),
		country: text('country'),
		beginYear: integer('begin_year'),
		endYear: integer('end_year'),
		disambiguation: text('disambiguation'),
		bio: text('bio'),
		imageId: text('image_id'),
		metadataFetchedAt: text('metadata_fetched_at'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		mbidIdx: uniqueIndex('artists_mbid_idx').on(t.mbid),
		normIdx: index('artists_norm_idx').on(t.normName),
		sortIdx: index('artists_sort_idx').on(t.sortName),
	}),
);

export const albums = sqliteTable(
	'albums',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		sortTitle: text('sort_title').notNull(),
		normTitle: text('norm_title').notNull(),
		/** MusicBrainz release-group id. */
		mbidReleaseGroup: text('mbid_release_group'),
		/** album | ep | single | compilation | live | soundtrack | other */
		primaryType: text('primary_type').default('album'),
		secondaryTypes: text('secondary_types').default('[]'),
		isCompilation: integer('is_compilation', { mode: 'boolean' }).default(false),
		year: integer('year'),
		originalYear: integer('original_year'),
		/** Display string of the album artist credit ("A & B"). */
		artistCredit: text('artist_credit'),
		artId: text('art_id'),
		/** Directory the album was grouped from. */
		folderPath: text('folder_path'),
		/** albumGroupKey() result — how the importer finds this album again. */
		groupKey: text('group_key'),
		trackCount: integer('track_count').default(0),
		totalSeconds: integer('total_seconds').default(0),
		ratingAvg: real('rating_avg'),
		ratingCount: integer('rating_count').default(0),
		metadataFetchedAt: text('metadata_fetched_at'),
		addedAt: text('added_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		rgIdx: index('albums_rg_idx').on(t.mbidReleaseGroup),
		groupIdx: index('albums_group_idx').on(t.groupKey),
		normIdx: index('albums_norm_idx').on(t.normTitle),
		addedIdx: index('albums_added_idx').on(t.addedAt),
		yearIdx: index('albums_year_idx').on(t.year),
	}),
);

export const albumReleases = sqliteTable(
	'album_releases',
	{
		id: text('id').primaryKey(),
		albumId: text('album_id')
			.notNull()
			.references(() => albums.id, { onDelete: 'cascade' }),
		mbidRelease: text('mbid_release'),
		label: text('label'),
		catalogNo: text('catalog_no'),
		country: text('country'),
		mediaFormat: text('media_format'),
		discCount: integer('disc_count').default(1),
		releaseDate: text('release_date'),
	},
	(t) => ({ albumIdx: index('album_releases_album_idx').on(t.albumId) }),
);

export const albumArtists = sqliteTable(
	'album_artists',
	{
		albumId: text('album_id')
			.notNull()
			.references(() => albums.id, { onDelete: 'cascade' }),
		artistId: text('artist_id')
			.notNull()
			.references(() => artists.id, { onDelete: 'cascade' }),
		role: text('role').notNull().default('primary'),
		position: integer('position').notNull().default(0),
	},
	(t) => ({
		pk: uniqueIndex('album_artists_pk').on(t.albumId, t.artistId, t.role),
		artistIdx: index('album_artists_artist_idx').on(t.artistId),
	}),
);

export const tracks = sqliteTable(
	'tracks',
	{
		id: text('id').primaryKey(),
		albumId: text('album_id')
			.notNull()
			.references(() => albums.id, { onDelete: 'cascade' }),
		releaseId: text('release_id'),
		title: text('title').notNull(),
		normTitle: text('norm_title').notNull(),
		discNo: integer('disc_no').default(1),
		trackNo: integer('track_no'),
		durationSeconds: real('duration_seconds'),
		/** Display string of the track artist credit. */
		artistCredit: text('artist_credit'),
		mbidRecording: text('mbid_recording'),
		isrc: text('isrc'),
		explicit: integer('explicit', { mode: 'boolean' }).default(false),
		bpm: real('bpm'),
		musicalKey: text('musical_key'),
		ratingAvg: real('rating_avg'),
		ratingCount: integer('rating_count').default(0),
		playCount: integer('play_count').default(0),
		addedAt: text('added_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => ({
		albumOrderIdx: index('tracks_album_order_idx').on(t.albumId, t.discNo, t.trackNo),
		recordingIdx: index('tracks_recording_idx').on(t.mbidRecording),
		normIdx: index('tracks_norm_idx').on(t.normTitle),
	}),
);

export const trackArtists = sqliteTable(
	'track_artists',
	{
		trackId: text('track_id')
			.notNull()
			.references(() => tracks.id, { onDelete: 'cascade' }),
		artistId: text('artist_id')
			.notNull()
			.references(() => artists.id, { onDelete: 'cascade' }),
		/** primary | featured | composer | producer | remixer | performer | … */
		role: text('role').notNull().default('primary'),
		position: integer('position').notNull().default(0),
	},
	(t) => ({
		pk: uniqueIndex('track_artists_pk').on(t.trackId, t.artistId, t.role),
		artistIdx: index('track_artists_artist_idx').on(t.artistId),
	}),
);

export const trackFiles = sqliteTable(
	'track_files',
	{
		id: text('id').primaryKey(),
		trackId: text('track_id')
			.notNull()
			.references(() => tracks.id, { onDelete: 'cascade' }),
		sourceId: text('source_id').references(() => mediaSources.id),
		filePath: text('file_path').notNull().unique(),
		fileName: text('file_name').notNull(),
		fileSize: integer('file_size'),
		fileModifiedAt: text('file_modified_at'),
		container: text('container'),
		codec: text('codec'),
		bitrate: integer('bitrate'),
		sampleRate: integer('sample_rate'),
		bitDepth: integer('bit_depth'),
		channels: integer('channels'),
		lossless: integer('lossless', { mode: 'boolean' }).default(false),
		durationSeconds: real('duration_seconds'),
		replaygainTrack: real('replaygain_track'),
		replaygainAlbum: real('replaygain_album'),
		fingerprint: text('fingerprint'),
		/** Path of the generated peaks file (JSON), see WaveformService. */
		waveformPath: text('waveform_path'),
		uploadedBy: text('uploaded_by'),
		available: integer('available', { mode: 'boolean' }).default(true),
		addedAt: text('added_at').notNull(),
	},
	(t) => ({
		trackIdx: index('track_files_track_idx').on(t.trackId),
		sourceIdx: index('track_files_source_idx').on(t.sourceId),
	}),
);

export const musicGenres = sqliteTable(
	'music_genres',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		normName: text('norm_name').notNull(),
	},
	(t) => ({ normIdx: uniqueIndex('music_genres_norm_idx').on(t.normName) }),
);

export const albumGenres = sqliteTable(
	'album_genres',
	{
		albumId: text('album_id')
			.notNull()
			.references(() => albums.id, { onDelete: 'cascade' }),
		genreId: text('genre_id')
			.notNull()
			.references(() => musicGenres.id, { onDelete: 'cascade' }),
	},
	(t) => ({
		pk: uniqueIndex('album_genres_pk').on(t.albumId, t.genreId),
		genreIdx: index('album_genres_genre_idx').on(t.genreId),
	}),
);

export const artistGenres = sqliteTable(
	'artist_genres',
	{
		artistId: text('artist_id')
			.notNull()
			.references(() => artists.id, { onDelete: 'cascade' }),
		genreId: text('genre_id')
			.notNull()
			.references(() => musicGenres.id, { onDelete: 'cascade' }),
	},
	(t) => ({
		pk: uniqueIndex('artist_genres_pk').on(t.artistId, t.genreId),
		genreIdx: index('artist_genres_genre_idx').on(t.genreId),
	}),
);

export const lyrics = sqliteTable('lyrics', {
	trackId: text('track_id')
		.primaryKey()
		.references(() => tracks.id, { onDelete: 'cascade' }),
	plain: text('plain'),
	syncedLrc: text('synced_lrc'),
	source: text('source'),
	language: text('language'),
	editedBy: text('edited_by'),
	fetchedAt: text('fetched_at'),
	updatedAt: text('updated_at').notNull(),
});

/**
 * Last MusicBrainz match search per album: the scored candidates (JSON
 * MusicMatchCandidate[]) shown when auto-match wasn't confident enough.
 */
export const albumMatchCandidates = sqliteTable('album_match_candidates', {
	albumId: text('album_id')
		.primaryKey()
		.references(() => albums.id, { onDelete: 'cascade' }),
	candidates: text('candidates').notNull().default('[]'),
	/** 'auto' | 'manual' once a match is applied; null while unmatched. */
	matchedBy: text('matched_by'),
	searchedAt: text('searched_at').notNull(),
});

/** Grouping keys of merged-away albums → the album that absorbed them. */
export const albumAliases = sqliteTable('album_aliases', {
	groupKey: text('group_key').primaryKey(),
	albumId: text('album_id')
		.notNull()
		.references(() => albums.id, { onDelete: 'cascade' }),
});

export const musicIdentities = sqliteTable(
	'music_identities',
	{
		id: text('id').primaryKey(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		source: text('source').notNull(),
		externalId: text('external_id').notNull(),
	},
	(t) => ({
		uniq: uniqueIndex('music_identities_uniq').on(t.source, t.externalId, t.entityType),
		entityIdx: index('music_identities_entity_idx').on(t.entityType, t.entityId),
	}),
);

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type TrackFile = typeof trackFiles.$inferSelect;
export type NewTrackFile = typeof trackFiles.$inferInsert;
export type Artwork = typeof artwork.$inferSelect;
export type Lyrics = typeof lyrics.$inferSelect;

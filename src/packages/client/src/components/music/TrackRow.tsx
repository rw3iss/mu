import type { TrackSummary } from '@mu/shared';
import { EntityOptionsMenu } from '@/components/common/EntityOptionsMenu';
import { EntityRating } from '@/components/common/EntityRating';
import { MediaRow } from '@/components/common/MediaRow';
import { formatDuration, trackQueueItem } from '@/utils/music';
import { ArtistLinks, InlineLink } from './InlineLink';
import styles from './TrackRow.module.scss';

interface TrackRowProps {
	track: TrackSummary;
	/** Leading number (track no. on album pages, rank on "popular"). */
	index?: number | null;
	/** Show album art thumbnail (lists that span albums). */
	showArt?: boolean;
	/** Show "album" link in the subtitle. */
	showAlbum?: boolean;
	/**
	 * Hide artists that equal the album artist (album pages show only
	 * featured artists per track).
	 */
	albumArtistIds?: string[];
	/** Show an editable per-track rating. */
	showRating?: boolean;
	onPlay: () => void;
	active?: boolean;
}

/** One track line: #, title + artists, duration, rating, ⋯ menu. Click plays. */
export function TrackRow({
	track,
	index,
	showArt,
	showAlbum,
	albumArtistIds,
	showRating,
	onPlay,
	active,
}: TrackRowProps) {
	const artists = albumArtistIds
		? track.artists.filter((a) => !albumArtistIds.includes(a.id))
		: track.artists;
	const primaryArtist = track.artists[0]?.id ?? null;

	const subtitle = (
		<span class={styles.sub}>
			{artists.length > 0 && (
				<span class={styles.artists}>
					{albumArtistIds && 'feat. '}
					<ArtistLinks artists={artists} class={styles.link} />
				</span>
			)}
			{artists.length === 0 && !albumArtistIds && track.artistCredit && (
				<span class={styles.artists}>{track.artistCredit}</span>
			)}
			{showAlbum && track.albumId && (
				<>
					{(artists.length > 0 || track.artistCredit) && (
						<span class={styles.dot}>·</span>
					)}
					<InlineLink href={`/album/${track.albumId}`} class={styles.link}>
						{track.albumTitle}
					</InlineLink>
				</>
			)}
		</span>
	);

	return (
		<MediaRow
			compact
			class={`${styles.row} ${active ? styles.active : ''}`}
			thumbUrl={showArt ? (track.artUrl ?? '') : undefined}
			thumbAlt={track.albumTitle}
			thumbFallbackLabel={track.title}
			thumbShape={showArt ? 'square' : 'none'}
			leading={
				index != null ? (
					<span class={styles.num} aria-hidden="true">
						{index}
					</span>
				) : null
			}
			title={track.title}
			subtitle={artists.length > 0 || track.artistCredit || showAlbum ? subtitle : undefined}
			onClick={onPlay}
			aria-label={`Play ${track.title}`}
			actions={
				<div class={styles.actions} onClick={(e: Event) => e.stopPropagation()}>
					{showRating && (
						<span class={styles.rating}>
							<EntityRating
								entity={{ type: 'track', id: track.id }}
								size="sm"
								hideSummary
								initialUserRating={track.userRating ?? null}
							/>
						</span>
					)}
					<span class={styles.duration}>{formatDuration(track.durationSeconds)}</span>
					<EntityOptionsMenu
						compact
						entity={{ type: 'track', id: track.id }}
						item={trackQueueItem(track)}
						albumId={track.albumId}
						artistId={primaryArtist}
					/>
				</div>
			}
		/>
	);
}

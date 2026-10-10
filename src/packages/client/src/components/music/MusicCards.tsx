import type { AlbumSummary, ArtistSummary } from '@mu/shared';
import type { ComponentChildren } from 'preact';
import { route } from 'preact-router';
import { EntityOptionsMenu } from '@/components/common/EntityOptionsMenu';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { MediaCard } from '@/components/common/MediaCard';
import { albumQueueItem, artistQueueItem, playMusic, releaseTypeLabel } from '@/utils/music';
import styles from './MusicCards.module.scss';

function PlayOverlay({ onPlay, label }: { onPlay: () => void; label: string }) {
	return (
		<button
			type="button"
			class={styles.playBtn}
			aria-label={label}
			title={label}
			onClick={(e: Event) => {
				e.stopPropagation();
				e.preventDefault();
				onPlay();
			}}
		>
			<Icon name="play" size={20} />
		</button>
	);
}

interface AlbumCardProps {
	album: AlbumSummary;
	/** Replace the default "artist · year" subtitle. */
	subtitle?: ComponentChildren;
	/** Show the release type (EP / Single) instead of the artist. */
	showType?: boolean;
}

/** Square album tile: art, title, artist · year, hover Play, ⋯ menu. */
export function AlbumCard({ album, subtitle, showType }: AlbumCardProps) {
	const href = `/album/${album.id}`;
	const primaryArtist = album.artists[0]?.id ?? null;
	const sub =
		subtitle ??
		[showType ? releaseTypeLabel(album.primaryType) : album.artistCredit, album.year]
			.filter(Boolean)
			.join(' · ');
	return (
		<MediaCard
			posterUrl={album.artUrl}
			alt={album.title}
			fallbackLabel={album.title}
			posterShape="square"
			href={href}
			onClick={() => route(href)}
			title={album.title}
			subtitle={sub}
			class={styles.card}
			hoverOverlay={
				<PlayOverlay
					label={`Play ${album.title}`}
					onPlay={() => playMusic({ type: 'album', id: album.id })}
				/>
			}
			topRight={
				<FavoriteButton
					entityType="album"
					entityId={album.id}
					size="mini"
					stopPropagation
					revealOnHover
				/>
			}
			extra={
				<div class={styles.menuSlot}>
					<EntityOptionsMenu
						compact
						entity={{ type: 'album', id: album.id }}
						item={albumQueueItem(album)}
						artistId={primaryArtist}
					/>
				</div>
			}
		/>
	);
}

/** Circular artist tile. */
export function ArtistCard({ artist }: { artist: ArtistSummary }) {
	const href = `/artist/${artist.id}`;
	const counts = [
		artist.albumCount != null
			? `${artist.albumCount} ${artist.albumCount === 1 ? 'album' : 'albums'}`
			: null,
		artist.trackCount != null
			? `${artist.trackCount} ${artist.trackCount === 1 ? 'track' : 'tracks'}`
			: null,
	]
		.filter(Boolean)
		.join(' · ');
	return (
		<MediaCard
			posterUrl={artist.imageUrl}
			alt={artist.name}
			fallbackLabel={artist.name}
			posterShape="circle"
			href={href}
			onClick={() => route(href)}
			title={artist.name}
			subtitle={counts || undefined}
			class={styles.card}
			hoverOverlay={
				<PlayOverlay
					label={`Play ${artist.name}`}
					onPlay={() => playMusic({ type: 'artist', id: artist.id })}
				/>
			}
			extra={
				<div class={styles.menuSlot}>
					<EntityOptionsMenu
						compact
						entity={{ type: 'artist', id: artist.id }}
						item={artistQueueItem(artist)}
					/>
				</div>
			}
		/>
	);
}

/** Responsive card grid used by library tabs and detail pages. */
export function CardGrid({ children, circle }: { children: ComponentChildren; circle?: boolean }) {
	return <div class={`${styles.grid} ${circle ? styles.gridCircle : ''}`}>{children}</div>;
}

/** Titled horizontal rail of cards (home page, discography). */
export function MusicRail({
	title,
	action,
	children,
}: {
	title: ComponentChildren;
	action?: ComponentChildren;
	children: ComponentChildren;
}) {
	return (
		<section class={styles.rail}>
			<div class={styles.railHeader}>
				<h2 class={styles.railTitle}>{title}</h2>
				{action}
			</div>
			<div class={styles.railScroller}>{children}</div>
		</section>
	);
}

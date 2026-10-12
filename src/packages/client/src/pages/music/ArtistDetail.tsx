import type { AlbumSummary, ArtistDetail as ArtistDetailDto } from '@mu/shared';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CommentsPanel } from '@/components/comments/CommentsPanel';
import { Button } from '@/components/common/Button';
import { Collapse } from '@/components/common/Collapse';
import { EntityRating } from '@/components/common/EntityRating';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { AlbumCard, MusicRail } from '@/components/music/MusicCards';
import { TrackRow } from '@/components/music/TrackRow';
import { useSeo } from '@/hooks/useSeo';
import { musicService } from '@/services/music.service';
import { ensureFavoritesLoaded } from '@/state/favorites.state';
import { musicChange } from '@/state/musicLibraryEvents.state';
import { playMusic, playTracksFrom, queueTracks } from '@/utils/music';
import styles from './MusicDetail.module.scss';

interface ArtistDetailProps {
	path?: string;
	id?: string;
}

const BIO_PREVIEW = 400;

/** Discography sections, in display order. */
const DISCOGRAPHY: { key: string; title: string }[] = [
	{ key: 'album', title: 'Albums' },
	{ key: 'ep', title: 'EPs' },
	{ key: 'single', title: 'Singles' },
	{ key: 'compilation', title: 'Compilations' },
	{ key: 'other', title: 'Other' },
];

function sectionKey(a: AlbumSummary): string {
	const t = (a.primaryType ?? 'album').toLowerCase();
	return t === 'album' || t === 'ep' || t === 'single' || t === 'compilation' ? t : 'other';
}

function byYearDesc(a: AlbumSummary, b: AlbumSummary): number {
	return (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title);
}

export function ArtistDetail({ id }: ArtistDetailProps) {
	const [artist, setArtist] = useState<ArtistDetailDto | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [bioOpen, setBioOpen] = useState(false);

	useSeo(
		artist
			? {
					title: artist.name,
					description: artist.bio?.slice(0, 160) ?? undefined,
					image: artist.imageUrl ?? undefined,
					type: 'profile',
				}
			: null,
	);

	useEffect(() => {
		void ensureFavoritesLoaded();
	}, []);

	useEffect(() => {
		if (!id) {
			setIsLoading(false);
			setError('Missing artist id');
			return;
		}
		let cancelled = false;
		setIsLoading(true);
		setError(null);
		setArtist(null);
		setBioOpen(false);
		musicService
			.artist(id)
			.then((a) => !cancelled && setArtist(a))
			.catch((err) => !cancelled && setError(err?.message ?? 'Failed to load artist'))
			.finally(() => !cancelled && setIsLoading(false));
		return () => {
			cancelled = true;
		};
	}, [id]);

	// Live refresh on any catalogue change: a new upload's album isn't in the
	// artist's list yet, so ids can't tell whether it belongs here.
	const version = musicChange.value.version;
	useEffect(() => {
		if (version === 0 || !id) return;
		musicService
			.artist(id)
			.then(setArtist)
			.catch(() => {});
	}, [version]);

	const sections = useMemo(() => {
		if (!artist) return [];
		const groups = new Map<string, AlbumSummary[]>();
		for (const a of artist.albums) {
			const k = sectionKey(a);
			const list = groups.get(k) ?? [];
			list.push(a);
			groups.set(k, list);
		}
		return DISCOGRAPHY.filter((s) => groups.has(s.key)).map((s) => ({
			...s,
			albums: [...groups.get(s.key)!].sort(byYearDesc),
		}));
	}, [artist]);

	if (isLoading) return <ArtistSkeleton />;

	if (error || !artist) {
		return (
			<div class={styles.notFound}>
				<h2>Artist not found</h2>
				{error && <p>{error}</p>}
			</div>
		);
	}

	const years =
		artist.beginYear || artist.endYear
			? `${artist.beginYear ?? '?'}–${artist.endYear ?? 'present'}`
			: null;
	const facts = [artist.type, artist.country, years, artist.disambiguation].filter(Boolean);
	const bio = artist.bio ?? '';
	const bioLong = bio.length > BIO_PREVIEW;
	const popular = artist.popularTracks.slice(0, 10);

	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={`${styles.artWrap} ${styles.artWrapCircle}`}>
						{artist.imageUrl ? (
							<SmartImage
								src={artist.imageUrl}
								alt={artist.name}
								class={styles.art}
								imgClass={styles.art}
								fallbackLabel={artist.name}
							/>
						) : (
							<div class={styles.artFallback}>
								{artist.name.charAt(0).toUpperCase()}
							</div>
						)}
					</div>
					<div class={styles.heroInfo}>
						<span class={styles.kicker}>Artist</span>
						<h1 class={styles.title}>{artist.name}</h1>
						{facts.length > 0 && (
							<div class={styles.facts}>
								{facts.map((f) => (
									<span key={f}>{f}</span>
								))}
							</div>
						)}
						{artist.genres.length > 0 && (
							<div class={styles.chips}>
								{artist.genres.map((g) => (
									<span key={g} class={styles.chip}>
										{g}
									</span>
								))}
							</div>
						)}
						<div class={styles.ratingRow}>
							<EntityRating
								entity={{ type: 'artist', id: artist.id }}
								initialUserRating={artist.userRating ?? null}
							/>
							<FavoriteButton entityType="artist" entityId={artist.id} size="large" />
						</div>
						<div class={styles.actions}>
							<Button onClick={() => playMusic({ type: 'artist', id: artist.id })}>
								<span class={styles.btnIcon}>
									<Icon name="play" size={16} /> Play
								</span>
							</Button>
							<Button
								variant="secondary"
								disabled={popular.length === 0}
								onClick={() => queueTracks(popular)}
							>
								<span class={styles.btnIcon}>
									<Icon name="list-plus" size={16} /> Add to queue
								</span>
							</Button>
						</div>
					</div>
				</header>

				{bio && (
					<section class={styles.section}>
						<h2 class={styles.sectionTitle}>Biography</h2>
						{!bioOpen && (
							<p class={styles.bio}>
								{bioLong ? `${bio.slice(0, BIO_PREVIEW).trim()}…` : bio}
							</p>
						)}
						<Collapse open={bioOpen}>
							<p class={styles.bio}>{bio}</p>
						</Collapse>
						{bioLong && (
							<button
								type="button"
								class={styles.textToggle}
								onClick={() => setBioOpen(!bioOpen)}
							>
								{bioOpen ? 'Show less' : 'Read more'}
							</button>
						)}
					</section>
				)}

				{popular.length > 0 && (
					<section class={styles.section}>
						<h2 class={styles.sectionTitle}>Popular tracks</h2>
						<div class={styles.trackList}>
							{popular.map((t, i) => (
								<TrackRow
									key={t.id}
									track={t}
									index={i + 1}
									showArt
									showAlbum
									onPlay={() =>
										playTracksFrom(popular, i, {
											type: 'artist',
											id: artist.id,
											title: artist.name,
										})
									}
								/>
							))}
						</div>
					</section>
				)}

				{sections.map((s) => (
					<MusicRail key={s.key} title={s.title}>
						{s.albums.map((a) => (
							<AlbumCard key={a.id} album={a} subtitle={a.year ?? undefined} />
						))}
					</MusicRail>
				))}

				{artist.appearsOn.length > 0 && (
					<MusicRail title="Appears on">
						{[...artist.appearsOn].sort(byYearDesc).map((a) => (
							<AlbumCard key={a.id} album={a} />
						))}
					</MusicRail>
				)}

				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Comments</h2>
					<CommentsPanel entity={{ type: 'artist', id: artist.id }} />
				</section>
			</div>
		</div>
	);
}

function ArtistSkeleton() {
	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div
						class={`${styles.artWrap} ${styles.artWrapCircle} ${styles.skeletonBlock}`}
					/>
					<div class={styles.heroInfo}>
						<div class={`${styles.skeletonLine} ${styles.skeletonLineLarge}`} />
						<div class={styles.skeletonLine} />
						<div class={styles.skeletonLine} />
					</div>
				</header>
				<section class={styles.section}>
					{[...Array(5)].map((_, i) => (
						<div key={i} class={styles.skeletonLine} style={{ width: '100%' }} />
					))}
				</section>
			</div>
		</div>
	);
}

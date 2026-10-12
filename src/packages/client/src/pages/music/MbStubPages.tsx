import type { MbArtistPreview, MbReleaseGroupPreview } from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { MediaCard } from '@/components/common/MediaCard';
import { SmartImage } from '@/components/common/SmartImage';
import { CardGrid } from '@/components/music/MusicCards';
import { useSeo } from '@/hooks/useSeo';
import { musicService } from '@/services/music.service';
import { isMbId, MB_ID_PREFIX } from '@/utils/music-links';
import { AlbumDetail } from './AlbumDetail';
import { ArtistDetail } from './ArtistDetail';
import stub from './MbStubPages.module.scss';
import styles from './MusicDetail.module.scss';

interface RouteProps {
	path?: string;
	id?: string;
}

/** `/album/:id` — library album, or a MusicBrainz release-group stub for `mb:<mbid>`. */
export function AlbumRoute(props: RouteProps) {
	return isMbId(props.id) ? (
		<MbAlbumStub mbid={props.id.slice(MB_ID_PREFIX.length)} />
	) : (
		<AlbumDetail {...props} />
	);
}

/** `/artist/:id` — library artist, or a MusicBrainz artist stub for `mb:<mbid>`. */
export function ArtistRoute(props: RouteProps) {
	return isMbId(props.id) ? (
		<MbArtistStub mbid={props.id.slice(MB_ID_PREFIX.length)} />
	) : (
		<ArtistDetail {...props} />
	);
}

function formatLength(ms: number | null): string {
	if (!ms) return '';
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function useLoad<T>(load: () => Promise<T>, key: string) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		setData(null);
		setError(null);
		load()
			.then((d) => !cancelled && setData(d))
			.catch((e) => !cancelled && setError(e?.message ?? 'Failed to load from MusicBrainz'));
		return () => {
			cancelled = true;
		};
	}, [key]);
	return { data, error };
}

function StubLoading({ label }: { label: string }) {
	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={`${styles.artWrap} ${styles.skeletonBlock}`} />
					<div class={styles.heroInfo}>
						<div class={`${styles.skeletonLine} ${styles.skeletonLineLarge}`} />
						<div class={styles.skeletonLine} />
						<p class={styles.muted}>{label}</p>
					</div>
				</header>
			</div>
		</div>
	);
}

function MbLink({ url }: { url: string }) {
	return (
		<a class={stub.mbLink} href={url} target="_blank" rel="noopener noreferrer">
			<Icon name="arrow-up-right" size={14} /> View on MusicBrainz
		</a>
	);
}

function MbAlbumStub({ mbid }: { mbid: string }) {
	const { data: rg, error } = useLoad<MbReleaseGroupPreview>(
		() => musicService.mbReleaseGroup(mbid),
		mbid,
	);
	useSeo(rg ? { title: rg.artist ? `${rg.title} — ${rg.artist}` : rg.title } : null);

	if (error) {
		return (
			<div class={styles.notFound}>
				<h2>Album not found</h2>
				<p>{error}</p>
			</div>
		);
	}
	if (!rg) return <StubLoading label="Loading from MusicBrainz…" />;

	const types = [rg.primaryType, ...rg.secondaryTypes].filter(Boolean).join(' · ');
	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={styles.artWrap}>
						<SmartImage
							src={rg.coverUrl}
							alt={rg.title}
							class={styles.art}
							imgClass={styles.art}
							fallbackLabel={rg.title}
						/>
					</div>
					<div class={styles.heroInfo}>
						<span class={styles.kicker}>{types || 'Album'} · Not in your library</span>
						<h1 class={styles.title}>{rg.title}</h1>
						<div class={styles.byline}>
							{rg.artistMbid ? (
								<a
									class={styles.link}
									href={`/artist/mb:${rg.artistMbid}`}
									onClick={(e) => {
										e.preventDefault();
										route(`/artist/mb:${rg.artistMbid}`);
									}}
								>
									{rg.artist}
								</a>
							) : (
								rg.artist
							)}
						</div>
						<div class={styles.facts}>
							{rg.year && <span>{rg.year}</span>}
							{rg.tracks.length > 0 && <span>{rg.tracks.length} tracks</span>}
						</div>
						{rg.genres.length > 0 && (
							<div class={styles.chips}>
								{rg.genres.map((g) => (
									<span key={g} class={styles.chip}>
										{g}
									</span>
								))}
							</div>
						)}
						<div class={styles.actions}>
							{rg.localAlbumId && (
								<Button onClick={() => route(`/album/${rg.localAlbumId}`)}>
									Open in library
								</Button>
							)}
							<MbLink url={rg.url} />
						</div>
					</div>
				</header>
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Tracks</h2>
					{rg.tracks.length === 0 ? (
						<p class={styles.muted}>No tracklist available.</p>
					) : (
						<ol class={stub.tracks}>
							{rg.tracks.map((t, i) => (
								<li key={`${i}-${t.title}`} class={stub.track}>
									<span class={stub.num}>{t.position ?? i + 1}</span>
									<span class={stub.trackTitle}>
										{t.title}
										{t.artist && t.artist !== rg.artist && (
											<span class={stub.trackArtist}> · {t.artist}</span>
										)}
									</span>
									<span class={stub.len}>{formatLength(t.lengthMs)}</span>
								</li>
							))}
						</ol>
					)}
				</section>
			</div>
		</div>
	);
}

function MbArtistStub({ mbid }: { mbid: string }) {
	const { data: a, error } = useLoad<MbArtistPreview>(() => musicService.mbArtist(mbid), mbid);
	useSeo(a ? { title: a.name, type: 'profile' } : null);

	if (error) {
		return (
			<div class={styles.notFound}>
				<h2>Artist not found</h2>
				<p>{error}</p>
			</div>
		);
	}
	if (!a) return <StubLoading label="Loading from MusicBrainz…" />;

	const life =
		a.beginYear || a.endYear ? `${a.beginYear ?? '?'}–${a.endYear ?? 'present'}` : null;
	return (
		<div class={styles.page}>
			<div class={styles.inner}>
				<header class={styles.hero}>
					<div class={`${styles.artWrap} ${styles.artWrapCircle}`}>
						<SmartImage
							src={a.releaseGroups[0]?.coverUrl ?? null}
							alt={a.name}
							class={styles.art}
							imgClass={styles.art}
							fallbackLabel={a.name}
						/>
					</div>
					<div class={styles.heroInfo}>
						<span class={styles.kicker}>
							{a.type ?? 'Artist'} · Not in your library
						</span>
						<h1 class={styles.title}>{a.name}</h1>
						<div class={styles.facts}>
							{a.disambiguation && <span>{a.disambiguation}</span>}
							{a.country && <span>{a.country}</span>}
							{life && <span>{life}</span>}
						</div>
						{a.genres.length > 0 && (
							<div class={styles.chips}>
								{a.genres.map((g) => (
									<span key={g} class={styles.chip}>
										{g}
									</span>
								))}
							</div>
						)}
						<div class={styles.actions}>
							{a.localArtistId && (
								<Button onClick={() => route(`/artist/${a.localArtistId}`)}>
									Open in library
								</Button>
							)}
							<MbLink url={a.url} />
						</div>
					</div>
				</header>
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Discography</h2>
					{a.releaseGroups.length === 0 ? (
						<p class={styles.muted}>No albums listed on MusicBrainz.</p>
					) : (
						<CardGrid>
							{a.releaseGroups.map((g) => {
								const href = g.localAlbumId
									? `/album/${g.localAlbumId}`
									: `/album/mb:${g.mbid}`;
								return (
									<MediaCard
										key={g.mbid}
										posterUrl={g.coverUrl}
										alt={g.title}
										fallbackLabel={g.title}
										posterShape="square"
										href={href}
										onClick={() => route(href)}
										title={g.title}
										subtitle={[
											g.primaryType,
											g.year,
											g.localAlbumId ? 'In library' : null,
										]
											.filter(Boolean)
											.join(' · ')}
									/>
								);
							})}
						</CardGrid>
					)}
				</section>
			</div>
		</div>
	);
}

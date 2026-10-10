import type {
	MusicDiscoverFilters,
	MusicDiscoverItem,
	MusicDiscoverResponse,
	MusicDiscoverSeed,
	MusicDiscoverSeedSuggestion,
	MusicSearchHit,
	SearchHit,
} from '@mu/shared';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { EmptyState } from '@/components/common/EmptyState';
import { MusicSearchInput } from '@/components/common/EntitySearchInput';
import { Icon } from '@/components/common/Icon';
import { MediaCard } from '@/components/common/MediaCard';
import { SmartImage } from '@/components/common/SmartImage';
import { CardGrid } from '@/components/music/MusicCards';
import { useUiSetting } from '@/hooks/useUiSetting';
import { musicService } from '@/services/music.service';
import { playMusic } from '@/utils/music';
import { discoverItemHref } from '@/utils/music-links';
import styles from './MusicDiscover.module.scss';
import homeStyles from './MusicHome.module.scss';

interface MusicDiscoverProps {
	path?: string;
}

const KIND_LABEL: Record<MusicDiscoverSeed['type'], string> = {
	artist: 'Artist',
	album: 'Album',
	track: 'Track',
};

/** Seed from a federated search hit: library id when owned, else `mb:<mbid>`. */
function seedFromHit(hit: MusicSearchHit): MusicDiscoverSeed | null {
	const id = hit.localId ?? (hit.mbid ? `mb:${hit.mbid}` : null);
	if (!id) return null;
	return {
		type: hit.kind,
		id,
		label: hit.artist && hit.kind !== 'artist' ? `${hit.title} — ${hit.artist}` : hit.title,
	};
}

const sameSeed = (a: MusicDiscoverSeed, b: MusicDiscoverSeed) => a.type === b.type && a.id === b.id;

/**
 * Music Discover: pick seeds (search or favourites / history), get artists,
 * albums and tracks from the local content vector + ListenBrainz similar
 * artists. Non-library results link to MusicBrainz stub pages.
 */
export function MusicDiscover(_props: MusicDiscoverProps) {
	const [seeds, setSeeds] = useUiSetting<MusicDiscoverSeed[]>('musicDiscoverSeeds', []);
	const [filters, setFilters] = useUiSetting<MusicDiscoverFilters>('musicDiscoverFilters', {});
	const [suggestions, setSuggestions] = useState<MusicDiscoverSeedSuggestion[]>([]);
	const [genres, setGenres] = useState<string[]>([]);
	const [result, setResult] = useState<MusicDiscoverResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		musicService
			.discoverSeeds()
			.then(setSuggestions)
			.catch(() => {});
		musicService
			.genres()
			.then((g) => setGenres(g.map((x) => x.name)))
			.catch(() => {});
	}, []);

	const seedKey = JSON.stringify([seeds.map((s) => `${s.type}:${s.id}`), filters]);
	useEffect(() => {
		if (!seeds.length) {
			setResult(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		const t = setTimeout(() => {
			musicService
				.discover({ seeds, filters })
				.then((r) => !cancelled && setResult(r))
				.catch((e) => !cancelled && setError(e?.message ?? 'Discovery failed'))
				.finally(() => !cancelled && setLoading(false));
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [seedKey]);

	const addSeed = (seed: MusicDiscoverSeed | null) => {
		if (!seed || seeds.some((s) => sameSeed(s, seed))) return;
		setSeeds([...seeds, seed].slice(-10));
	};
	const removeSeed = (seed: MusicDiscoverSeed) =>
		setSeeds(seeds.filter((s) => !sameSeed(s, seed)));
	const setFilter = (patch: Partial<MusicDiscoverFilters>) =>
		setFilters({ ...filters, ...patch });

	const unusedSuggestions = suggestions.filter((s) => !seeds.some((x) => sameSeed(x, s)));
	const empty =
		result && !result.artists.length && !result.albums.length && !result.tracks.length;

	return (
		<div class={homeStyles.page}>
			<header class={homeStyles.header}>
				<h1 class={homeStyles.title}>Discover</h1>
			</header>

			<section class={styles.panel}>
				<MusicSearchInput
					class={styles.search}
					placeholder="Add a seed: artist, album or track…"
					onSelect={(hit: SearchHit) => addSeed(seedFromHit(hit as MusicSearchHit))}
				/>
				{seeds.length > 0 && (
					<div class={styles.chips}>
						{seeds.map((s) => (
							<span key={`${s.type}:${s.id}`} class={styles.seed}>
								<span class={styles.seedKind}>{KIND_LABEL[s.type]}</span>
								{s.label ?? s.id}
								<button
									type="button"
									class={styles.seedRemove}
									aria-label={`Remove ${s.label ?? s.id}`}
									onClick={() => removeSeed(s)}
								>
									<Icon name="x" size={12} />
								</button>
							</span>
						))}
						<button type="button" class={styles.clear} onClick={() => setSeeds([])}>
							Clear
						</button>
					</div>
				)}
				{unusedSuggestions.length > 0 && (
					<div class={styles.suggest}>
						<span class={styles.suggestLabel}>From your favourites and history:</span>
						{unusedSuggestions.slice(0, 12).map((s) => (
							<button
								type="button"
								key={`${s.type}:${s.id}`}
								class={styles.suggestion}
								title={s.subtitle ? `${s.label} — ${s.subtitle}` : s.label}
								onClick={() =>
									addSeed({
										type: s.type,
										id: s.id,
										label: s.subtitle ? `${s.label} — ${s.subtitle}` : s.label,
									})
								}
							>
								<SmartImage
									src={s.artUrl ?? null}
									alt=""
									iconOnly
									class={`${styles.suggestThumb} ${s.type === 'artist' ? styles.round : ''}`}
								/>
								{s.label}
							</button>
						))}
					</div>
				)}
				<div class={styles.filters}>
					<label>
						Genre
						<select
							value={filters.genre ?? ''}
							onChange={(e) =>
								setFilter({
									genre: (e.target as HTMLSelectElement).value || undefined,
								})
							}
						>
							<option value="">Any</option>
							{genres.map((g) => (
								<option key={g} value={g}>
									{g}
								</option>
							))}
						</select>
					</label>
					<label>
						From
						<input
							type="number"
							min={1900}
							max={2100}
							placeholder="Year"
							value={filters.yearFrom ?? ''}
							onChange={(e) =>
								setFilter({
									yearFrom:
										Number((e.target as HTMLInputElement).value) || undefined,
								})
							}
						/>
					</label>
					<label>
						To
						<input
							type="number"
							min={1900}
							max={2100}
							placeholder="Year"
							value={filters.yearTo ?? ''}
							onChange={(e) =>
								setFilter({
									yearTo:
										Number((e.target as HTMLInputElement).value) || undefined,
								})
							}
						/>
					</label>
					<label class={styles.check}>
						<input
							type="checkbox"
							checked={!!filters.inLibraryOnly}
							onChange={(e) =>
								setFilter({ inLibraryOnly: (e.target as HTMLInputElement).checked })
							}
						/>
						In library only
					</label>
				</div>
			</section>

			{!seeds.length && (
				<EmptyState
					variant="dashed"
					icon="music"
					title="Pick something you like"
					message="Add an artist, album or track above — or pick one of your favourites — to find similar music in your library and beyond."
				/>
			)}
			{error && <p class={styles.error}>{error}</p>}
			{loading && !result && <p class={styles.status}>Finding recommendations…</p>}
			{empty && !loading && (
				<EmptyState
					variant="dashed"
					icon="music"
					title="No recommendations"
					message="Try other seeds or loosen the filters. Library albums need genre tags for local matching."
				/>
			)}
			{result && (
				<div class={loading ? styles.stale : undefined}>
					<ItemSection title="Artists" items={result.artists} circle />
					<ItemSection title="Albums" items={result.albums} />
					<TrackSection items={result.tracks} />
					<p class={styles.status}>
						{result.strategies
							.map(
								(s) =>
									`${s.name}: ${s.ok ? s.count : `off${s.error ? ` (${s.error})` : ''}`}`,
							)
							.join(' · ')}
					</p>
				</div>
			)}
		</div>
	);
}

function subtitle(i: MusicDiscoverItem): string {
	return [i.kind === 'artist' ? null : i.artist, i.year, i.inLibrary ? null : 'MusicBrainz']
		.filter(Boolean)
		.join(' · ');
}

function ItemSection({
	title,
	items,
	circle,
}: {
	title: string;
	items: MusicDiscoverItem[];
	circle?: boolean;
}) {
	if (!items.length) return null;
	return (
		<section class={homeStyles.section}>
			<h2 class={homeStyles.sectionTitle}>{title}</h2>
			<CardGrid circle={circle}>
				{items.map((i) => {
					const href = discoverItemHref(i);
					return (
						<div key={`${i.localId ?? i.mbid}`} title={i.reasons.join('\n')}>
							<MediaCard
								posterUrl={i.artUrl ?? null}
								alt={i.title}
								fallbackLabel={i.title}
								posterShape={circle ? 'circle' : 'square'}
								href={href ?? undefined}
								onClick={() => href && route(href)}
								title={i.title}
								subtitle={subtitle(i)}
								caption={i.reasons[0]}
							/>
						</div>
					);
				})}
			</CardGrid>
		</section>
	);
}

function TrackSection({ items }: { items: MusicDiscoverItem[] }) {
	if (!items.length) return null;
	return (
		<section class={homeStyles.section}>
			<h2 class={homeStyles.sectionTitle}>Tracks</h2>
			<ul class={styles.tracks}>
				{items.map((t) => {
					const href = discoverItemHref(t);
					return (
						<li
							key={t.localId ?? t.mbid}
							class={styles.track}
							title={t.reasons.join('\n')}
						>
							<button
								type="button"
								class={styles.trackPlay}
								aria-label={`Play ${t.title}`}
								disabled={!t.localId}
								onClick={() =>
									t.localId && playMusic({ type: 'track', id: t.localId })
								}
							>
								<Icon name="play" size={14} />
							</button>
							<SmartImage
								src={t.artUrl ?? null}
								alt=""
								iconOnly
								class={styles.trackThumb}
							/>
							<a
								class={styles.trackText}
								href={href ?? undefined}
								onClick={(e) => {
									if (!href) return;
									e.preventDefault();
									route(href);
								}}
							>
								<span class={styles.trackTitle}>{t.title}</span>
								<span class={styles.trackSub}>
									{[t.artist, t.reasons[0]].filter(Boolean).join(' · ')}
								</span>
							</a>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

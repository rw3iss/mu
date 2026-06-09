import type { ProfileFavorite, ProfileFavoriteType } from '@mu/shared';
import { useMemo, useState } from 'preact/hooks';
import { MediaCard } from '@/components/common/MediaCard';
import { ToggleButton } from '@/components/common/ToggleButton';
import styles from './ProfileFavorites.module.scss';

interface ProfileFavoritesProps {
	favorites: ProfileFavorite[];
}

const FILTERS: { type: ProfileFavoriteType; label: string }[] = [
	{ type: 'movie', label: 'Movies' },
	{ type: 'cast', label: 'Cast' },
	{ type: 'director', label: 'Directors' },
];

/**
 * A user's favorites with per-type filter toggles (movies / cast / directors).
 * Order is preserved from the server (earliest-added first). Renders each
 * favorite as a poster/portrait MediaCard linking to the movie or person.
 */
export function ProfileFavorites({ favorites }: ProfileFavoritesProps) {
	// All types visible by default; toggling narrows the view.
	const [active, setActive] = useState<Set<ProfileFavoriteType>>(
		() => new Set<ProfileFavoriteType>(['movie', 'cast', 'director']),
	);

	const counts = useMemo(() => {
		const c: Record<ProfileFavoriteType, number> = { movie: 0, cast: 0, director: 0 };
		for (const f of favorites) c[f.type]++;
		return c;
	}, [favorites]);

	const visible = useMemo(() => favorites.filter((f) => active.has(f.type)), [favorites, active]);

	const toggle = (type: ProfileFavoriteType) => {
		setActive((prev) => {
			const next = new Set(prev);
			if (next.has(type)) {
				next.delete(type);
			} else {
				next.add(type);
			}
			// Never let the user hide everything — re-enabling keeps at least one.
			return next.size === 0 ? new Set<ProfileFavoriteType>([type]) : next;
		});
	};

	if (favorites.length === 0) {
		return <p class={styles.empty}>No favorites yet.</p>;
	}

	return (
		<div class={styles.root}>
			<div class={styles.filters}>
				{FILTERS.map(({ type, label }) => (
					<ToggleButton
						key={type}
						size="sm"
						pressed={active.has(type)}
						onClick={() => toggle(type)}
						disabled={counts[type] === 0}
					>
						{label}
						<span class={styles.count}>{counts[type]}</span>
					</ToggleButton>
				))}
			</div>

			{visible.length === 0 ? (
				<p class={styles.empty}>Nothing matches those filters.</p>
			) : (
				<div class={styles.grid}>
					{visible.map((f) => (
						<MediaCard
							key={f.id}
							posterUrl={f.imageUrl}
							alt={f.title}
							fallbackLabel={f.title}
							posterShape={f.type === 'movie' ? 'poster' : 'portrait'}
							title={f.title}
							subtitle={f.subtitle ?? undefined}
							href={
								f.type === 'movie' && f.movieId
									? `/movie/${f.movieId}`
									: f.personKey
										? `/person/${encodeURIComponent(f.personKey)}`
										: undefined
							}
							infoOverlay
						/>
					))}
				</div>
			)}
		</div>
	);
}

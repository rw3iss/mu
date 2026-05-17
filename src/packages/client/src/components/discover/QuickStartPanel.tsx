import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { type FavoriteEntry, favoritesService } from '@/services/favorites.service';
import { peopleService } from '@/services/people.service';
import { addSeed } from '@/state/discover.state';
import { ensureFavoritesLoaded, favoritePersonKeys } from '@/state/favorites.state';
import { notifyError, notifyInfo } from '@/state/notifications.state';
import styles from './QuickStartPanel.module.scss';

const MAX_PERSON_SEEDS = 4;

/**
 * Discover-page quick-start panel: surfaces the user's favorites
 * directly into the seed flow so building a "tailored to me"
 * recommendation set is one click.
 *
 *   - Favorite MOVIES → one-click add as a seed.
 *   - Favorite PEOPLE → link to /person/:key, where the user can
 *     pick a known-for credit to seed from (people aren't direct
 *     seeds in the current recommender — credit choice acts as the
 *     bridge).
 */
export function QuickStartPanel() {
	const [favorites, setFavorites] = useState<FavoriteEntry[] | null>(null);

	useEffect(() => {
		void ensureFavoritesLoaded();
		favoritesService
			.list()
			.then((res) => setFavorites(res.favorites))
			.catch(() => setFavorites([]));
	}, [favoritePersonKeys.value]);

	if (favorites === null) {
		return null;
	}

	const favMovies = favorites.filter((f) => f.entityType === 'movie' && f.movie);
	const favPeople = favorites.filter((f) => f.entityType === 'person' && f.person);

	if (favMovies.length === 0 && favPeople.length === 0) {
		return null;
	}

	const seedAll = () => {
		// Take up to 5 favorite movies as the multi-seed set so the
		// recommender derives a taste centroid from them. Hitting
		// 5+ is plenty — more seeds dilutes the signal.
		const ids = favMovies.slice(0, 5).map((f) => f.movie!.id);
		if (ids.length === 0) return;
		for (const id of ids) {
			const f = favMovies.find((x) => x.movie!.id === id);
			addSeed(id, f?.movie?.title);
		}
	};

	return (
		<div class={styles.panel}>
			<div class={styles.header}>
				<h3 class={styles.title}>From your favorites</h3>
				{favMovies.length > 1 && (
					<button type="button" class={styles.allBtn} onClick={seedAll}>
						Seed all
					</button>
				)}
			</div>

			{favMovies.length > 0 && (
				<div class={styles.section}>
					<span class={styles.sectionLabel}>Movies</span>
					<div class={styles.row}>
						{favMovies.slice(0, 8).map((f) => (
							<button
								key={f.id}
								type="button"
								class={styles.chip}
								onClick={() => addSeed(f.movie!.id, f.movie!.title)}
								title={`Seed Discover with "${f.movie!.title}"`}
							>
								<span class={styles.chipThumb}>
									{f.movie!.posterUrl ? (
										<SmartImage src={f.movie!.posterUrl} alt="" />
									) : (
										<Icon name="film" size={12} />
									)}
								</span>
								<span class={styles.chipLabel}>{f.movie!.title}</span>
							</button>
						))}
					</div>
				</div>
			)}

			{favPeople.length > 0 && (
				<div class={styles.section}>
					<span class={styles.sectionLabel}>People</span>
					<div class={styles.row}>
						{favPeople.slice(0, 8).map((f) => (
							<PersonChip key={f.id} entry={f} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function PersonChip({ entry }: { entry: FavoriteEntry }) {
	const [seeding, setSeeding] = useState(false);

	const seedFromPerson = async () => {
		if (seeding) return;
		setSeeding(true);
		try {
			const { person } = await peopleService.get(entry.key);
			const ownedCredits = (person.knownForMovies ?? []).filter(
				(c) => c.movieId && c.mediaType === 'movie',
			);
			if (ownedCredits.length === 0) {
				notifyInfo(
					`${person.name} has no movies in your library yet — open their page to see all credits.`,
				);
				route(`/person/${entry.key}`);
				return;
			}
			const picked = ownedCredits.slice(0, MAX_PERSON_SEEDS);
			for (const c of picked) {
				if (c.movieId) addSeed(c.movieId, c.title);
			}
			notifyInfo(
				`Seeded Discover with ${picked.length} of ${person.name}'s ${picked.length === 1 ? 'film' : 'films'}.`,
			);
		} catch (err: any) {
			notifyError(err?.message ?? 'Could not load person details');
		} finally {
			setSeeding(false);
		}
	};

	return (
		<div class={styles.personChipWrap}>
			<button
				type="button"
				class={styles.chip}
				onClick={seedFromPerson}
				disabled={seeding}
				title={`Seed Discover with ${entry.person!.name}'s films`}
			>
				<span class={styles.chipThumb}>
					{entry.person!.profileUrl ? (
						<SmartImage src={entry.person!.profileUrl} alt="" />
					) : (
						<Icon name="star" size={12} />
					)}
				</span>
				<span class={styles.chipLabel}>{entry.person!.name}</span>
			</button>
			<button
				type="button"
				class={styles.personDrillBtn}
				onClick={() => route(`/person/${entry.key}`)}
				aria-label={`Open ${entry.person!.name}'s page`}
				title={`Open ${entry.person!.name}'s page`}
			>
				<Icon name="arrow-up-right" size={11} />
			</button>
		</div>
	);
}

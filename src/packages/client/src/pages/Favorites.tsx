import { useEffect } from 'preact/hooks';
import {
	ensureFavoritesLoaded,
	favoriteMovieIds,
	favoritePersonKeys,
} from '@/state/favorites.state';
import styles from './Favorites.module.scss';

interface FavoritesProps {
	path?: string;
}

export function Favorites(_props: FavoritesProps) {
	useEffect(() => {
		void ensureFavoritesLoaded();
	}, []);

	const personCount = favoritePersonKeys.value?.size ?? 0;
	const movieCount = favoriteMovieIds.value?.size ?? 0;

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<h1>Favorites</h1>
				<span class={styles.count}>
					{personCount} people · {movieCount} movies
				</span>
			</header>
			<div class={styles.empty}>
				<p>Full Favorites browser coming next.</p>
			</div>
		</div>
	);
}

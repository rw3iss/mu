import { useCallback } from 'preact/hooks';
import {
	addFavorite,
	favoriteMovieIds,
	favoritePersonKeys,
	personKeyFor,
	removeFavorite,
} from '@/state/favorites.state';
import styles from './FavoriteButton.module.scss';

type ButtonSize = 'mini' | 'normal' | 'large';

type PersonProps = {
	entityType: 'person';
	tmdbId?: number | null;
	name: string;
	profileUrl?: string | null;
	personRole?: string | null;
};

type MovieProps = {
	entityType: 'movie';
	movieId: string;
};

export type FavoriteButtonProps = (PersonProps | MovieProps) & {
	size?: ButtonSize;
	class?: string;
	title?: string;
	/** Stop click propagation — useful on clickable parent rows. */
	stopPropagation?: boolean;
};

const SIZE_DIMENSIONS: Record<ButtonSize, number> = {
	mini: 18,
	normal: 28,
	large: 40,
};

const SIZE_ICON_PADDING: Record<ButtonSize, number> = {
	mini: 4,
	normal: 6,
	large: 9,
};

export function FavoriteButton(props: FavoriteButtonProps) {
	const size: ButtonSize = props.size ?? 'normal';

	const isFavorited =
		props.entityType === 'person'
			? (favoritePersonKeys.value?.has(
					personKeyFor({ tmdbId: props.tmdbId, name: props.name }),
				) ?? false)
			: (favoriteMovieIds.value?.has(props.movieId) ?? false);

	const handleClick = useCallback(
		(e: MouseEvent) => {
			if (props.stopPropagation) {
				e.stopPropagation();
				e.preventDefault();
			}
			if (props.entityType === 'person') {
				if (isFavorited) {
					void removeFavorite({
						entityType: 'person',
						tmdbId: props.tmdbId,
						name: props.name,
					});
				} else {
					void addFavorite({
						entityType: 'person',
						tmdbId: props.tmdbId,
						name: props.name,
						profileUrl: props.profileUrl ?? null,
						role: props.personRole ?? null,
					});
				}
			} else {
				if (isFavorited) {
					void removeFavorite({ entityType: 'movie', movieId: props.movieId });
				} else {
					void addFavorite({ entityType: 'movie', movieId: props.movieId });
				}
			}
		},
		[isFavorited, props],
	);

	const px = SIZE_DIMENSIONS[size];
	const padding = SIZE_ICON_PADDING[size];
	const iconSize = px - padding * 2;
	const ariaLabel = isFavorited ? 'Remove from favorites' : 'Add to favorites';

	return (
		<button
			type="button"
			class={`${styles.btn} ${styles[`size_${size}`]} ${isFavorited ? styles.active : ''} ${props.class ?? ''}`}
			onClick={handleClick}
			aria-pressed={isFavorited}
			aria-label={ariaLabel}
			title={props.title ?? ariaLabel}
			style={{ width: `${px}px`, height: `${px}px` }}
		>
			<svg
				class={styles.star}
				width={iconSize}
				height={iconSize}
				viewBox="0 0 24 24"
				fill={isFavorited ? 'currentColor' : 'none'}
				stroke="currentColor"
				stroke-width={1.75}
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
			</svg>
		</button>
	);
}

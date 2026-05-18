import { useEffect, useMemo, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { EmptyState } from '@/components/common/EmptyState';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import { SmartImage } from '@/components/common/SmartImage';
import { type FavoriteEntry, favoritesService } from '@/services/favorites.service';
import {
	ensureFavoritesLoaded,
	favoriteMovieIds,
	favoritePersonKeys,
} from '@/state/favorites.state';
import styles from './Favorites.module.scss';

interface FavoritesProps {
	path?: string;
}

type SortBy = 'recent' | 'name' | 'role' | 'year';
type FilterType = 'all' | 'person' | 'movie' | 'actor' | 'director' | 'writer';
type ViewMode = 'cards' | 'list';

const SORT_OPTIONS = [
	{ value: 'recent', label: 'Recently favorited' },
	{ value: 'name', label: 'Name' },
	{ value: 'role', label: 'Role / Department' },
	{ value: 'year', label: 'Year' },
];

const FILTER_OPTIONS = [
	{ value: 'all', label: 'All' },
	{ value: 'person', label: 'People' },
	{ value: 'movie', label: 'Movies' },
	{ value: 'actor', label: 'Actors' },
	{ value: 'director', label: 'Directors' },
	{ value: 'writer', label: 'Writers' },
];

export function Favorites(_props: FavoritesProps) {
	const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [query, setQuery] = useState('');
	const [sortBy, setSortBy] = useState<SortBy>('recent');
	const [filter, setFilter] = useState<FilterType>('all');
	const [viewMode, setViewMode] = useState<ViewMode>(() => {
		return (localStorage.getItem('mu_favorites_view') as ViewMode | null) ?? 'cards';
	});

	useEffect(() => {
		void ensureFavoritesLoaded();
	}, []);

	useEffect(() => {
		setIsLoading(true);
		favoritesService
			.list()
			.then((res) => setFavorites(res.favorites))
			.finally(() => setIsLoading(false));
	}, [favoritePersonKeys.value, favoriteMovieIds.value]);

	useEffect(() => {
		localStorage.setItem('mu_favorites_view', viewMode);
	}, [viewMode]);

	const visible = useMemo(() => {
		const q = query.trim().toLowerCase();
		const filtered = favorites.filter((f) => {
			if (filter === 'person' && f.entityType !== 'person') return false;
			if (filter === 'movie' && f.entityType !== 'movie') return false;
			if (filter === 'actor' && (f.entityType !== 'person' || f.role !== 'actor')) {
				return false;
			}
			if (filter === 'director' && (f.entityType !== 'person' || f.role !== 'director')) {
				return false;
			}
			if (filter === 'writer' && (f.entityType !== 'person' || f.role !== 'writer')) {
				return false;
			}
			if (!q) return true;
			const name = f.person?.name ?? f.movie?.title ?? '';
			return name.toLowerCase().includes(q);
		});
		const sorted = [...filtered];
		sorted.sort((a, b) => {
			switch (sortBy) {
				case 'name': {
					const an = a.person?.name ?? a.movie?.title ?? '';
					const bn = b.person?.name ?? b.movie?.title ?? '';
					return an.localeCompare(bn);
				}
				case 'role': {
					const ar = a.role ?? a.person?.knownForDepartment ?? '';
					const br = b.role ?? b.person?.knownForDepartment ?? '';
					return ar.localeCompare(br);
				}
				case 'year': {
					const ay =
						a.movie?.year ??
						(a.person?.birthday ? parseInt(a.person.birthday.slice(0, 4), 10) : 0);
					const by =
						b.movie?.year ??
						(b.person?.birthday ? parseInt(b.person.birthday.slice(0, 4), 10) : 0);
					return (by ?? 0) - (ay ?? 0);
				}
				default:
					return b.createdAt.localeCompare(a.createdAt);
			}
		});
		return sorted;
	}, [favorites, query, sortBy, filter]);

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<div class={styles.headerLeft}>
					<h1>Favorites</h1>
					<span class={styles.count}>
						{favorites.length} {favorites.length === 1 ? 'item' : 'items'}
					</span>
				</div>
				<div class={styles.viewToggle}>
					<button
						type="button"
						class={`${styles.viewBtn} ${viewMode === 'cards' ? styles.viewBtnActive : ''}`}
						onClick={() => setViewMode('cards')}
						title="Cards"
						aria-label="Card view"
					>
						<Icon name="view-grid" size={16} />
					</button>
					<button
						type="button"
						class={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`}
						onClick={() => setViewMode('list')}
						title="List"
						aria-label="List view"
					>
						<Icon name="view-list" size={16} />
					</button>
				</div>
			</header>

			<div class={styles.toolbar}>
				<div class={styles.searchBar}>
					<span class={styles.searchIcon}>
						<Icon name="search" size={16} />
					</span>
					<input
						type="text"
						placeholder="Search favorites..."
						value={query}
						onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
						class={styles.searchInput}
					/>
					{query && (
						<button
							type="button"
							class={styles.searchClear}
							onClick={() => setQuery('')}
							aria-label="Clear search"
						>
							<Icon name="x" size={14} />
						</button>
					)}
				</div>
				<Select
					value={filter}
					onChange={(v) => setFilter(v as FilterType)}
					options={FILTER_OPTIONS}
				/>
				<Select
					value={sortBy}
					onChange={(v) => setSortBy(v as SortBy)}
					options={SORT_OPTIONS}
				/>
			</div>

			{isLoading ? (
				<div class={viewMode === 'cards' ? styles.cardsGrid : styles.list}>
					{Array.from({ length: viewMode === 'cards' ? 8 : 5 }).map((_, i) =>
						viewMode === 'cards' ? (
							<FavoriteCardSkeleton key={i} />
						) : (
							<FavoriteRowSkeleton key={i} />
						),
					)}
				</div>
			) : visible.length === 0 ? (
				favorites.length === 0 ? (
					<EmptyState
						variant="dashed"
						icon="star"
						title="No favorites yet"
						message="Star a cast member, director, or movie to add it here."
					/>
				) : (
					<EmptyState
						variant="dashed"
						icon="search"
						title="No matches"
						message={`Nothing matches "${query}". Try a different search or filter.`}
					/>
				)
			) : viewMode === 'cards' ? (
				<div class={styles.cardsGrid}>
					{visible.map((f) => (
						<FavoriteCard key={f.id} entry={f} />
					))}
				</div>
			) : (
				<div class={styles.list}>
					{visible.map((f) => (
						<FavoriteRow key={f.id} entry={f} />
					))}
				</div>
			)}
		</div>
	);
}

function personHref(entry: FavoriteEntry): string {
	return `/person/${entry.key}`;
}

function FavoriteCard({ entry }: { entry: FavoriteEntry }) {
	const isPerson = entry.entityType === 'person';
	const onClick = () => {
		if (isPerson) route(personHref(entry));
		else if (entry.movie) route(`/movie/${entry.movie.id}`);
	};
	return (
		<div class={styles.card} onClick={onClick} role="button" tabIndex={0}>
			<div class={`${styles.cardImage} ${isPerson ? styles.cardImagePerson : ''}`}>
				{(isPerson ? entry.person?.profileUrl : entry.movie?.posterUrl) ? (
					<SmartImage
						src={
							(isPerson ? entry.person!.profileUrl : entry.movie!.posterUrl) as string
						}
						alt={isPerson ? entry.person!.name : entry.movie!.title}
					/>
				) : (
					<div class={styles.cardImageFallback}>
						<Icon name={isPerson ? 'star' : 'film'} size={32} />
					</div>
				)}
				<div class={styles.cardFav}>
					{isPerson ? (
						<FavoriteButton
							entityType="person"
							tmdbId={entry.person?.tmdbId}
							name={entry.person?.name ?? entry.key}
							profileUrl={entry.person?.profileUrl}
							personRole={entry.role}
							size="normal"
							stopPropagation
						/>
					) : (
						<FavoriteButton
							entityType="movie"
							movieId={entry.entityId}
							size="normal"
							stopPropagation
						/>
					)}
				</div>
			</div>
			<div class={styles.cardInfo}>
				<span class={styles.cardTitle}>
					{isPerson ? entry.person?.name : entry.movie?.title}
				</span>
				<span class={styles.cardMeta}>
					{isPerson
						? (entry.role ?? entry.person?.knownForDepartment ?? 'Person')
						: (entry.movie?.year ?? '')}
				</span>
			</div>
		</div>
	);
}

function FavoriteCardSkeleton() {
	return (
		<div class={styles.card} aria-hidden="true">
			<div class={`${styles.cardImage} skeleton`} />
			<div class={styles.cardInfo}>
				<span
					class={`${styles.cardTitle} skeleton`}
					style={{ height: '14px', width: '70%' }}
				/>
				<span
					class={`${styles.cardMeta} skeleton`}
					style={{ height: '12px', width: '40%' }}
				/>
			</div>
		</div>
	);
}

function FavoriteRowSkeleton() {
	return (
		<div class={styles.row} aria-hidden="true">
			<div class={`${styles.rowThumb} skeleton`} />
			<div class={styles.rowInfo}>
				<span
					class={`${styles.rowTitle} skeleton`}
					style={{ height: '14px', width: '60%' }}
				/>
				<span
					class={`${styles.rowMeta} skeleton`}
					style={{ height: '12px', width: '30%' }}
				/>
			</div>
		</div>
	);
}

function FavoriteRow({ entry }: { entry: FavoriteEntry }) {
	const isPerson = entry.entityType === 'person';
	const onClick = () => {
		if (isPerson) route(personHref(entry));
		else if (entry.movie) route(`/movie/${entry.movie.id}`);
	};
	return (
		<div class={styles.row} onClick={onClick} role="button" tabIndex={0}>
			<div class={`${styles.rowThumb} ${isPerson ? styles.rowThumbPerson : ''}`}>
				{(isPerson ? entry.person?.profileUrl : entry.movie?.posterUrl) ? (
					<SmartImage
						src={
							(isPerson ? entry.person!.profileUrl : entry.movie!.posterUrl) as string
						}
						alt={isPerson ? entry.person!.name : entry.movie!.title}
					/>
				) : (
					<div class={styles.rowThumbFallback}>
						<Icon name={isPerson ? 'star' : 'film'} size={20} />
					</div>
				)}
			</div>
			<div class={styles.rowInfo}>
				<span class={styles.rowTitle}>
					{isPerson ? entry.person?.name : entry.movie?.title}
				</span>
				<span class={styles.rowMeta}>
					{isPerson
						? (entry.role ?? entry.person?.knownForDepartment ?? 'Person')
						: (entry.movie?.year ?? '')}
				</span>
			</div>
			<div class={styles.rowActions}>
				{isPerson ? (
					<FavoriteButton
						entityType="person"
						tmdbId={entry.person?.tmdbId}
						name={entry.person?.name ?? entry.key}
						profileUrl={entry.person?.profileUrl}
						personRole={entry.role}
						size="normal"
						stopPropagation
					/>
				) : (
					<FavoriteButton
						entityType="movie"
						movieId={entry.entityId}
						size="normal"
						stopPropagation
					/>
				)}
			</div>
		</div>
	);
}

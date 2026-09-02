import { useEffect, useMemo, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { ResultFilterBar } from '@/components/common/ResultFilterBar';
import { Select } from '@/components/common/Select';
import { SmartImage } from '@/components/common/SmartImage';
import { ResultCard } from '@/components/movie/ResultCard';
import { useMovieSearchDefaults } from '@/hooks/useMovieSearchDefaults';
import { useSeo } from '@/hooks/useSeo';
import { type PersonView, peopleService } from '@/services/people.service';
import { ensureFavoritesLoaded, slugifyName } from '@/state/favorites.state';
import {
	defaultsToFilters,
	filtersToDefaults,
	type ResultFilterState,
} from '@/utils/result-filters';
import styles from './PersonDetail.module.scss';

interface PersonDetailProps {
	path?: string;
	id?: string;
}

/**
 * Resolve a URL parameter (which might be a namespaced key, a TMDB id,
 * or a legacy URL-encoded name) into a canonical person key the
 * backend understands.
 */
function resolveKey(idParam: string): string {
	const decoded = decodeURIComponent(idParam);
	if (/^tmdb:\d+$/.test(decoded) || /^name:[a-z0-9-]+$/.test(decoded)) return decoded;
	if (/^\d+$/.test(decoded)) return `tmdb:${decoded}`;
	return `name:${slugifyName(decoded)}`;
}

function formatAge(birthday: string | null, deathday: string | null): string | null {
	if (!birthday) return null;
	const b = new Date(birthday);
	if (Number.isNaN(b.getTime())) return null;
	const end = deathday ? new Date(deathday) : new Date();
	if (Number.isNaN(end.getTime())) return null;
	let age = end.getFullYear() - b.getFullYear();
	const m = end.getMonth() - b.getMonth();
	if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
	return deathday ? `Died at ${age}` : `${age} years old`;
}

type CreditSort = 'year' | 'title' | 'rating' | 'votes';
const CREDIT_SORTS: readonly CreditSort[] = ['year', 'title', 'rating', 'votes'];

// TMDB's combined-credits endpoint only distinguishes movie vs TV at the
// title level (there's no "short"/"documentary" *type* — those are genres),
// so the Type filter reflects that media_type.
type CreditType = 'all' | 'movie' | 'tv';
const CREDIT_TYPES: readonly CreditType[] = ['all', 'movie', 'tv'];

// A credit counts as "in library" exactly when the server resolved it to a real
// local movie row (`movieId`) — the same signal `CreditCard` uses to decide
// whether to show its "Not in library" badge, so filter and badge can't disagree.
type CreditLibrary = 'all' | 'in' | 'out';
const CREDIT_LIBRARY: readonly CreditLibrary[] = ['all', 'in', 'out'];

interface CreditParams {
	sort: CreditSort;
	minYear: string;
	minRating: string;
	minVotes: string;
	type: CreditType;
	library: CreditLibrary;
}

/** Read the "Known for" sort/filter state from the current URL query. */
function readCreditParams(): CreditParams {
	const search = typeof window !== 'undefined' ? window.location.search : '';
	const p = new URLSearchParams(search);
	const sort = p.get('sort');
	const type = p.get('type');
	const library = p.get('library');
	return {
		sort: CREDIT_SORTS.includes(sort as CreditSort) ? (sort as CreditSort) : 'year',
		minYear: p.get('minYear') ?? '',
		minRating: p.get('minRating') ?? '',
		minVotes: p.get('minVotes') ?? '',
		type: CREDIT_TYPES.includes(type as CreditType) ? (type as CreditType) : 'all',
		library: CREDIT_LIBRARY.includes(library as CreditLibrary)
			? (library as CreditLibrary)
			: 'all',
	};
}

export function PersonDetail({ id }: PersonDetailProps) {
	const [person, setPerson] = useState<PersonView | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [creditSort, setCreditSort] = useState<CreditSort>(() => readCreditParams().sort);
	const [creditMinYear, setCreditMinYear] = useState(() => readCreditParams().minYear);
	const [creditMinRating, setCreditMinRating] = useState(() => readCreditParams().minRating);
	const [creditMinVotes, setCreditMinVotes] = useState(() => readCreditParams().minVotes);
	const [creditType, setCreditType] = useState<CreditType>(() => readCreditParams().type);
	const [creditLibrary, setCreditLibrary] = useState<CreditLibrary>(
		() => readCreditParams().library,
	);
	const [error, setError] = useState<string | null>(null);
	const [showFullBio, setShowFullBio] = useState(false);

	// Mirror the sort/filter state into the URL (replace — don't spam
	// history), so it restores on refresh and when returning via Back
	// after visiting one of the credit results.
	const writeCreditParams = (p: CreditParams) => {
		const q = new URLSearchParams();
		if (p.sort !== 'year') q.set('sort', p.sort);
		if (p.minYear) q.set('minYear', p.minYear);
		if (p.minRating) q.set('minRating', p.minRating);
		if (p.minVotes) q.set('minVotes', p.minVotes);
		if (p.type !== 'all') q.set('type', p.type);
		if (p.library !== 'all') q.set('library', p.library);
		const qs = q.toString();
		const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
		if (next !== window.location.pathname + window.location.search) route(next, true);
	};

	// One entry point for the shared filter bar: fan its combined state back out
	// to the individual signals and mirror it into the URL in a single write.
	const applyCreditFilters = (next: ResultFilterState, type: CreditType) => {
		setCreditSort(next.sort as CreditSort);
		setCreditLibrary(next.library as CreditLibrary);
		setCreditMinYear(next.minYear);
		setCreditMinRating(next.minRating);
		setCreditMinVotes(next.minVotes);
		setCreditType(type);
		writeCreditParams({
			sort: next.sort as CreditSort,
			minYear: next.minYear,
			minRating: next.minRating,
			minVotes: next.minVotes,
			type,
			library: next.library as CreditLibrary,
		});
	};

	// Seed from the user's saved defaults — but never override explicit URL
	// params, so a shared/bookmarked link keeps the filters it encodes.
	const { save: saveDefaults } = useMovieSearchDefaults({
		skip: typeof window !== 'undefined' && window.location.search.length > 1,
		apply: (d) => {
			const f = defaultsToFilters(d);
			applyCreditFilters(
				f,
				CREDIT_TYPES.includes(d.type as CreditType) ? (d.type as CreditType) : 'all',
			);
		},
	});

	useSeo(
		person
			? {
					title: person.name,
					description: person.biography
						? person.biography
						: person.knownForDepartment
							? `${person.knownForDepartment}${person.placeOfBirth ? ` · ${person.placeOfBirth}` : ''}`
							: undefined,
					image: person.profileUrl ?? undefined,
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
			setError('Missing person id');
			return;
		}
		const key = resolveKey(id);
		setIsLoading(true);
		setError(null);
		setPerson(null);
		peopleService
			.get(key)
			.then((res) => setPerson(res.person))
			.catch((err) => setError(err?.message ?? 'Failed to load person'))
			.finally(() => setIsLoading(false));
	}, [id]);

	// The router reuses this component across /person/:id changes, so
	// re-read the sort/filter state from the (new) URL when the person
	// changes — otherwise the previous person's filters would carry over.
	useEffect(() => {
		const p = readCreditParams();
		setCreditSort(p.sort);
		setCreditMinYear(p.minYear);
		setCreditMinRating(p.minRating);
		setCreditMinVotes(p.minVotes);
		setCreditType(p.type);
		setCreditLibrary(p.library);
	}, [id]);

	if (isLoading) return <PersonSkeleton />;

	if (error || !person) {
		return (
			<div class={styles.notFound}>
				<h2>Person not found</h2>
				{error && <p>{error}</p>}
			</div>
		);
	}

	const ageLine = formatAge(person.birthday, person.deathday);
	const bio = person.biography ?? '';
	const bioLong = bio.length > 480;
	const bioShown = bioLong && !showFullBio ? `${bio.slice(0, 480).trim()}…` : bio;

	// Rating used for sort + filter: prefer IMDB (owned), else TMDB.
	const ratingOf = (c: PersonView['knownForMovies'][number]) => c.imdbRating ?? c.tmdbRating ?? 0;

	const visibleCredits = useMemo(() => {
		const minYear = parseInt(creditMinYear, 10);
		const minRating = parseFloat(creditMinRating);
		const minVotes = parseInt(creditMinVotes, 10);
		let list = person.knownForMovies;
		if (creditType !== 'all') {
			list = list.filter((c) => c.mediaType === creditType);
		}
		if (Number.isFinite(minYear) && minYear > 0) {
			list = list.filter((c) => (c.year ?? 0) >= minYear);
		}
		if (Number.isFinite(minRating) && minRating > 0) {
			list = list.filter((c) => ratingOf(c) >= minRating);
		}
		if (Number.isFinite(minVotes) && minVotes > 0) {
			list = list.filter((c) => (c.tmdbVotes ?? 0) >= minVotes);
		}
		if (creditLibrary !== 'all') {
			const owned = creditLibrary === 'in';
			list = list.filter((c) => !!c.movieId === owned);
		}
		const sorted = [...list];
		sorted.sort((a, b) => {
			switch (creditSort) {
				case 'title':
					return (a.title ?? '').localeCompare(b.title ?? '');
				case 'rating':
					return ratingOf(b) - ratingOf(a);
				case 'votes':
					return (b.tmdbVotes ?? 0) - (a.tmdbVotes ?? 0);
				default:
					return (b.year ?? 0) - (a.year ?? 0);
			}
		});
		return sorted;
	}, [
		person.knownForMovies,
		creditSort,
		creditMinYear,
		creditMinRating,
		creditMinVotes,
		creditType,
		creditLibrary,
	]);

	return (
		<div class={styles.personDetail}>
			<header class={styles.header}>
				<div class={styles.profileWrap}>
					{person.profileUrl ? (
						<SmartImage
							src={person.profileUrl}
							alt={person.name}
							class={styles.profile}
						/>
					) : (
						<div class={styles.profileFallback}>
							<span>{person.name.charAt(0).toUpperCase()}</span>
						</div>
					)}
				</div>
				<div class={styles.headerInfo}>
					<div class={styles.titleRow}>
						<h1 class={styles.title}>{person.name}</h1>
						<FavoriteButton
							entityType="person"
							tmdbId={person.tmdbId}
							name={person.name}
							profileUrl={person.profileUrl}
							personRole={person.knownForDepartment?.toLowerCase() ?? null}
							size="large"
						/>
					</div>
					{person.knownForDepartment && (
						<span class={styles.dept}>{person.knownForDepartment}</span>
					)}
					<div class={styles.facts}>
						{person.birthday && (
							<span>
								Born {person.birthday}
								{ageLine ? ` · ${ageLine}` : ''}
							</span>
						)}
						{person.placeOfBirth && <span>{person.placeOfBirth}</span>}
						{person.deathday && <span>Died {person.deathday}</span>}
					</div>
				</div>
			</header>

			{bio && (
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Biography</h2>
					<p class={styles.bio}>{bioShown}</p>
					{bioLong && (
						<button
							type="button"
							class={styles.bioToggle}
							onClick={() => setShowFullBio(!showFullBio)}
						>
							{showFullBio ? 'Show less' : 'Read more'}
						</button>
					)}
				</section>
			)}

			{person.knownForMovies.length > 0 && (
				<section class={styles.section}>
					<div class={styles.creditsHeader}>
						<h2 class={styles.sectionTitle}>Known for</h2>
						<ResultFilterBar
							value={{
								sort: creditSort,
								library: creditLibrary,
								minYear: creditMinYear,
								minRating: creditMinRating,
								minVotes: creditMinVotes,
							}}
							onChange={(next) => applyCreditFilters(next, creditType)}
							count={visibleCredits.length}
							onSaveDefaults={() =>
								saveDefaults(
									filtersToDefaults(
										{
											sort: creditSort,
											library: creditLibrary,
											minYear: creditMinYear,
											minRating: creditMinRating,
											minVotes: creditMinVotes,
										},
										creditType,
									),
								)
							}
						>
							{/* Type is Known For-only (TMDB splits movie vs TV), so it
							    rides in the shared bar's extra-controls slot. */}
							<span class={styles.controlGroup}>
								<span class={styles.controlLabelText}>Type</span>
								<Select
									value={creditType}
									onChange={(v) => {
										const t = v as CreditType;
										setCreditType(t);
										writeCreditParams({
											sort: creditSort,
											minYear: creditMinYear,
											minRating: creditMinRating,
											minVotes: creditMinVotes,
											type: t,
											library: creditLibrary,
										});
									}}
									options={[
										{ value: 'all', label: 'All Types' },
										{ value: 'movie', label: 'Movies' },
										{ value: 'tv', label: 'TV' },
									]}
									aria-label="Filter credits by type"
								/>
							</span>
						</ResultFilterBar>
					</div>
					<div class={styles.creditsGrid}>
						{visibleCredits.map((credit) => (
							<CreditCard
								key={`${credit.tmdbId}-${credit.mediaType}`}
								credit={credit}
							/>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

function CreditCard({ credit }: { credit: PersonView['knownForMovies'][number] }) {
	// Library hit → local detail page. Otherwise, if it's a movie with a TMDB
	// id, route to the virtual-row preview at /movie/tmdb:<id> (server creates a
	// 'bookmark' stub on first visit). TV credits stay non-clickable until
	// /tv/tmdb:<id> exists.
	const href = credit.movieId
		? `/movie/${credit.movieId}`
		: credit.mediaType === 'movie' && credit.tmdbId
			? `/movie/tmdb:${credit.tmdbId}`
			: null;
	// Discover accepts either a local movie id or a `tmdb:` key as its seed.
	const seedId = credit.movieId
		? credit.movieId
		: credit.mediaType === 'movie' && credit.tmdbId
			? `tmdb:${credit.tmdbId}`
			: null;

	// TV credits have nowhere to go yet — keep the old inert tile for them.
	if (!href) {
		return (
			<div class={`${styles.creditCard} ${styles.notOwned}`}>
				<div class={styles.creditPoster}>
					{credit.posterUrl ? (
						<SmartImage src={credit.posterUrl} alt={credit.title} />
					) : (
						<div class={styles.creditPosterPlaceholder}>
							<Icon name="film" size={28} />
						</div>
					)}
				</div>
				<div class={styles.creditInfo}>
					<span class={styles.creditTitle}>{credit.title}</span>
					<span class={styles.creditMeta}>{credit.year ?? '—'}</span>
				</div>
			</div>
		);
	}

	// Shared with the movie page's "Similar" section so both rails present the
	// same information in the same layout.
	return (
		<ResultCard
			href={href}
			title={credit.title}
			year={credit.year}
			posterUrl={credit.posterUrl}
			inLibrary={!!credit.movieId}
			imdbRating={credit.imdbRating}
			tmdbRating={credit.tmdbRating}
			tmdbVotes={credit.tmdbVotes}
			role={credit.character ? `as ${credit.character}` : (credit.job ?? null)}
			seedId={seedId}
		/>
	);
}

function PersonSkeleton() {
	return (
		<div class={styles.personDetail}>
			<header class={styles.header}>
				<div class={`${styles.profileWrap} ${styles.skeleton}`} />
				<div class={styles.headerInfo}>
					<div class={`${styles.skeletonLine} ${styles.skeletonLineLarge}`} />
					<div class={styles.skeletonLine} />
					<div class={styles.skeletonLine} />
				</div>
			</header>
			<section class={styles.section}>
				<div class={`${styles.skeletonLine} ${styles.skeletonLineLarge}`} />
				<div class={styles.skeletonLine} />
				<div class={styles.skeletonLine} />
			</section>
			<section class={styles.section}>
				<div class={styles.creditsGrid}>
					{[...Array(6)].map((_, i) => (
						<div key={i} class={`${styles.creditCard} ${styles.skeleton}`} />
					))}
				</div>
			</section>
		</div>
	);
}

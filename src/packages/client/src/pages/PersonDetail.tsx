import { useEffect, useMemo, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import { SmartImage } from '@/components/common/SmartImage';
import { useSeo } from '@/hooks/useSeo';
import { type PersonView, peopleService } from '@/services/people.service';
import { ensureFavoritesLoaded, slugifyName } from '@/state/favorites.state';
import { newTabNav } from '@/utils/navigation';
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
		if (p.minRating) q.set('minRating', p.minRating);
		if (p.minVotes) q.set('minVotes', p.minVotes);
		if (p.type !== 'all') q.set('type', p.type);
		if (p.library !== 'all') q.set('library', p.library);
		const qs = q.toString();
		const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
		if (next !== window.location.pathname + window.location.search) route(next, true);
	};

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
		const minRating = parseFloat(creditMinRating);
		const minVotes = parseInt(creditMinVotes, 10);
		let list = person.knownForMovies;
		if (creditType !== 'all') {
			list = list.filter((c) => c.mediaType === creditType);
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
						<div class={styles.creditsControls}>
							<span class={styles.controlGroup}>
								<span class={styles.controlLabelText}>Sort</span>
								<Select
									value={creditSort}
									onChange={(v) => {
										const s = v as CreditSort;
										setCreditSort(s);
										writeCreditParams({
											sort: s,
											minRating: creditMinRating,
											minVotes: creditMinVotes,
											type: creditType,
											library: creditLibrary,
										});
									}}
									options={[
										{ value: 'year', label: 'Year' },
										{ value: 'title', label: 'Title' },
										{ value: 'rating', label: 'Rating' },
										{ value: 'votes', label: 'Votes' },
									]}
									aria-label="Sort credits by"
								/>
							</span>
							<span class={styles.controlGroup}>
								<span class={styles.controlLabelText}>Type</span>
								<Select
									value={creditType}
									onChange={(v) => {
										const t = v as CreditType;
										setCreditType(t);
										writeCreditParams({
											sort: creditSort,
											minRating: creditMinRating,
											minVotes: creditMinVotes,
											type: t,
											library: creditLibrary,
										});
									}}
									options={[
										{ value: 'all', label: 'All Types' },
										{ value: 'movie', label: 'Movies' },
										{ value: 'tv', label: 'TV Shows' },
									]}
									aria-label="Filter credits by type"
								/>
							</span>
							<span class={styles.controlGroup}>
								<span class={styles.controlLabelText}>In Library?</span>
								<Select
									value={creditLibrary}
									onChange={(v) => {
										const l = v as CreditLibrary;
										setCreditLibrary(l);
										writeCreditParams({
											sort: creditSort,
											minRating: creditMinRating,
											minVotes: creditMinVotes,
											type: creditType,
											library: l,
										});
									}}
									options={[
										{ value: 'all', label: 'All' },
										{ value: 'in', label: 'In Library' },
										{ value: 'out', label: 'Not in Library' },
									]}
									aria-label="Filter credits by library status"
								/>
							</span>
							<input
								type="number"
								class={styles.minRatingInput}
								min="0"
								max="10"
								step="0.1"
								placeholder="Min ★"
								value={creditMinRating}
								aria-label="Minimum rating"
								onInput={(e) => {
									const val = (e.target as HTMLInputElement).value;
									setCreditMinRating(val);
									writeCreditParams({
										sort: creditSort,
										minRating: val,
										minVotes: creditMinVotes,
										type: creditType,
										library: creditLibrary,
									});
								}}
							/>
							<input
								type="number"
								class={styles.minVotesInput}
								min="0"
								step="100"
								placeholder="Min votes"
								value={creditMinVotes}
								aria-label="Minimum votes"
								onInput={(e) => {
									const val = (e.target as HTMLInputElement).value;
									setCreditMinVotes(val);
									writeCreditParams({
										sort: creditSort,
										minRating: creditMinRating,
										minVotes: val,
										type: creditType,
										library: creditLibrary,
									});
								}}
							/>
							<span class={styles.resultCount}>
								{visibleCredits.length}{' '}
								{visibleCredits.length === 1 ? 'title' : 'titles'} found.
							</span>
						</div>
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
	// Library hit → local detail page. Otherwise, if it's a movie with
	// a TMDB id, route to the virtual-row preview at /movie/tmdb:<id>
	// (server creates a 'bookmark' stub on first visit). TV credits stay
	// non-clickable until /tv/tmdb:<id> exists.
	const href = credit.movieId
		? `/movie/${credit.movieId}`
		: credit.mediaType === 'movie' && credit.tmdbId
			? `/movie/tmdb:${credit.tmdbId}`
			: null;
	const clickable = href != null;
	// newTabNav adds middle-click / ctrl+click open-in-new-tab handling.
	const navHandlers = href ? newTabNav(href, () => route(href)) : {};
	const onKeyDown = href
		? (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					route(href);
				}
			}
		: undefined;
	return (
		<div
			class={`${styles.creditCard} ${clickable ? styles.clickable : ''} ${
				!credit.movieId ? styles.notOwned : ''
			}`}
			{...navHandlers}
			onKeyDown={onKeyDown as any}
			role={clickable ? 'button' : undefined}
			tabIndex={clickable ? 0 : undefined}
		>
			<div class={styles.creditPoster}>
				{credit.posterUrl ? (
					<SmartImage src={credit.posterUrl} alt={credit.title} />
				) : (
					<div class={styles.creditPosterPlaceholder}>
						<Icon name="film" size={28} />
					</div>
				)}
				{!credit.movieId && <span class={styles.notOwnedBadge}>Not in library</span>}
			</div>
			<div class={styles.creditInfo}>
				<span class={styles.creditTitle}>{credit.title}</span>
				<span class={styles.creditMeta}>
					{credit.year ?? '—'}
					{credit.character ? ` · as ${credit.character}` : ''}
					{credit.job ? ` · ${credit.job}` : ''}
				</span>
				<CreditRatings credit={credit} />
			</div>
		</div>
	);
}

function formatVotes(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
	return String(n);
}

function CreditRatings({ credit }: { credit: PersonView['knownForMovies'][number] }) {
	const imdb = credit.imdbRating != null && credit.imdbRating > 0 ? credit.imdbRating : null;
	const tmdb = credit.tmdbRating != null && credit.tmdbRating > 0 ? credit.tmdbRating : null;
	if (imdb == null && tmdb == null) return null;
	const votes =
		credit.tmdbVotes != null && credit.tmdbVotes > 0 ? formatVotes(credit.tmdbVotes) : null;
	return (
		<span
			class={styles.creditRatings}
			title={[
				imdb != null ? `IMDB ${imdb.toFixed(1)}` : null,
				tmdb != null ? `TMDB ${tmdb.toFixed(1)}` : null,
				votes ? `${votes} votes` : null,
			]
				.filter(Boolean)
				.join(' · ')}
		>
			{imdb != null && (
				<span class={styles.creditRatingPill}>
					<strong>IMDB</strong> {imdb.toFixed(1)}
				</span>
			)}
			{tmdb != null && (
				<span class={styles.creditRatingPill}>
					<strong>TMDB</strong> {tmdb.toFixed(1)}
				</span>
			)}
			{votes && <span class={styles.creditVotes}>{votes} votes</span>}
		</span>
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

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { FavoriteButton } from '@/components/common/FavoriteButton';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { type PersonView, peopleService } from '@/services/people.service';
import { ensureFavoritesLoaded, slugifyName } from '@/state/favorites.state';
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

export function PersonDetail({ id }: PersonDetailProps) {
	const [person, setPerson] = useState<PersonView | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showFullBio, setShowFullBio] = useState(false);

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
					<h2 class={styles.sectionTitle}>Known for</h2>
					<div class={styles.creditsGrid}>
						{person.knownForMovies.map((credit) => (
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
	const clickable = !!credit.movieId;
	const onClick =
		clickable && credit.movieId ? () => route(`/movie/${credit.movieId}`) : undefined;
	return (
		<div
			class={`${styles.creditCard} ${clickable ? styles.clickable : ''} ${
				!credit.movieId ? styles.notOwned : ''
			}`}
			onClick={onClick}
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
			</div>
		</div>
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

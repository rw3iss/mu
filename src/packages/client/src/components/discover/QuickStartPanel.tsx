import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';

import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import { SmartImage } from '@/components/common/SmartImage';
import { type FavoriteEntry, favoritesService } from '@/services/favorites.service';
import { type Playlist, playlistsService } from '@/services/playlists.service';
import {
	addPersonSeed,
	addSeed,
	personSeedKeys,
	removePersonSeed,
	removeSeed,
	seedMovieIds,
} from '@/state/discover.state';
import { ensureFavoritesLoaded, favoritePersonKeys } from '@/state/favorites.state';
import styles from './QuickStartPanel.module.scss';

interface QuickStartPanelProps {
	/**
	 * When true, the panel is dimmed and chips are non-interactive —
	 * indicates the user has disabled "Use My Profile" and their
	 * favorites won't influence the current recommendations.
	 */
	disabled?: boolean;
}

/**
 * Discover-page seed sources, split into three independent groups:
 *
 *   - **Use my favorite actors** → all favorited people become person seeds.
 *   - **Use my favorite movies** → all favorited movies become movie seeds.
 *   - **Use a playlist**        → every movie in the chosen playlist.
 *
 * Each group has a master switch that seeds/unseeds the whole group at once,
 * plus individual chips for picking one at a time. Groups are independently
 * collapsible and their bodies scroll, so a long favorites list can't push the
 * filters off screen. Enabling several combines them — the server merges movie
 * seeds and person seeds into one taste centroid.
 */
export function QuickStartPanel({ disabled = false }: QuickStartPanelProps) {
	const [favorites, setFavorites] = useState<FavoriteEntry[] | null>(null);
	const [playlists, setPlaylists] = useState<Playlist[]>([]);
	const [playlistId, setPlaylistId] = useState('');
	const [playlistMovies, setPlaylistMovies] = useState<
		{ id: string; title: string; posterUrl?: string }[]
	>([]);
	const [playlistLoading, setPlaylistLoading] = useState(false);

	useEffect(() => {
		void ensureFavoritesLoaded();
		favoritesService
			.list()
			.then((res) => setFavorites(res.favorites))
			.catch(() => setFavorites([]));
	}, [favoritePersonKeys.value]);

	useEffect(() => {
		playlistsService
			.list()
			.then(setPlaylists)
			.catch(() => setPlaylists([]));
	}, []);

	// Load the chosen playlist's movies so they can be seeded (individually or
	// all at once). Selecting a different playlist un-seeds the previous one's
	// movies, so the two can't silently stack up.
	useEffect(() => {
		const previous = playlistMovies;
		if (!playlistId) {
			for (const m of previous) removeSeed(m.id);
			setPlaylistMovies([]);
			return;
		}
		let cancelled = false;
		setPlaylistLoading(true);
		playlistsService
			.get(playlistId)
			.then((detail) => {
				if (cancelled) return;
				for (const m of previous) removeSeed(m.id);
				setPlaylistMovies(
					(detail.movies ?? []).map((m) => ({
						id: m.id,
						title: m.title,
						posterUrl: m.posterUrl,
					})),
				);
			})
			.catch(() => {
				if (!cancelled) setPlaylistMovies([]);
			})
			.finally(() => {
				if (!cancelled) setPlaylistLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [playlistId]);

	if (favorites === null) return null;

	const favMovies = favorites.filter((f) => f.entityType === 'movie' && f.movie);
	const favPeople = favorites.filter((f) => f.entityType === 'person' && f.person);

	// Nothing to offer at all — no favorites and no playlists.
	if (favMovies.length === 0 && favPeople.length === 0 && playlists.length === 0) {
		return null;
	}

	const seededMovies = seedMovieIds.value;
	const seededPeople = personSeedKeys.value;

	// A group is "on" when every one of its items is currently seeded.
	const allPeopleOn =
		favPeople.length > 0 && favPeople.every((f) => seededPeople.includes(f.key));
	const allMoviesOn =
		favMovies.length > 0 && favMovies.every((f) => seededMovies.includes(f.movie!.id));
	const allPlaylistOn =
		playlistMovies.length > 0 && playlistMovies.every((m) => seededMovies.includes(m.id));

	const togglePeople = () => {
		if (disabled) return;
		for (const f of favPeople) {
			if (allPeopleOn) removePersonSeed(f.key);
			else addPersonSeed(f.key, f.person!.name);
		}
	};

	const toggleMovies = () => {
		if (disabled) return;
		for (const f of favMovies) {
			if (allMoviesOn) removeSeed(f.movie!.id);
			else addSeed(f.movie!.id, f.movie!.title);
		}
	};

	const togglePlaylist = () => {
		if (disabled) return;
		for (const m of playlistMovies) {
			if (allPlaylistOn) removeSeed(m.id);
			else addSeed(m.id, m.title);
		}
	};

	return (
		<div
			class={`${styles.panel} ${disabled ? styles.disabled : ''}`}
			aria-disabled={disabled || undefined}
		>
			{favPeople.length > 0 && (
				<SeedGroup
					title="Use my favorite actors"
					count={favPeople.length}
					on={allPeopleOn}
					onToggle={togglePeople}
					disabled={disabled}
				>
					{favPeople.map((f) => (
						<PersonChip key={f.id} entry={f} disabled={disabled} />
					))}
				</SeedGroup>
			)}

			{favMovies.length > 0 && (
				<SeedGroup
					title="Use my favorite movies"
					count={favMovies.length}
					on={allMoviesOn}
					onToggle={toggleMovies}
					disabled={disabled}
				>
					{favMovies.map((f) => (
						<MovieChip
							key={f.id}
							id={f.movie!.id}
							title={f.movie!.title}
							posterUrl={f.movie!.posterUrl ?? undefined}
							disabled={disabled}
						/>
					))}
				</SeedGroup>
			)}

			{playlists.length > 0 && (
				<SeedGroup
					title="Use a playlist"
					count={playlistMovies.length || undefined}
					on={allPlaylistOn}
					onToggle={togglePlaylist}
					toggleDisabled={playlistMovies.length === 0}
					disabled={disabled}
				>
					<div class={styles.playlistPicker}>
						<Select
							value={playlistId}
							onChange={(v) => setPlaylistId(String(v))}
							options={[
								{ value: '', label: 'Select a playlist…' },
								...playlists.map((p) => ({
									value: p.id,
									label: `${p.name}${p.movieCount != null ? ` (${p.movieCount})` : ''}`,
								})),
							]}
							fullWidth
							size="sm"
							aria-label="Playlist to seed from"
						/>
					</div>
					{playlistLoading ? (
						<span class={styles.groupHint}>Loading…</span>
					) : playlistId && playlistMovies.length === 0 ? (
						<span class={styles.groupHint}>That playlist is empty.</span>
					) : (
						playlistMovies.map((m) => (
							<MovieChip
								key={m.id}
								id={m.id}
								title={m.title}
								posterUrl={m.posterUrl}
								disabled={disabled}
							/>
						))
					)}
				</SeedGroup>
			)}
		</div>
	);
}

/**
 * One collapsible seed group: a master on/off switch, an expand/collapse
 * chevron, and a scrollable body of chips.
 */
function SeedGroup({
	title,
	count,
	on,
	onToggle,
	toggleDisabled,
	disabled,
	children,
}: {
	title: string;
	count?: number;
	on: boolean;
	onToggle: () => void;
	toggleDisabled?: boolean;
	disabled?: boolean;
	children: ComponentChildren;
}) {
	const [collapsed, setCollapsed] = useState(false);

	return (
		<section class={styles.group}>
			<div class={styles.groupHeader}>
				{/* Master switch — seeds or clears every item in this group. */}
				<button
					type="button"
					role="switch"
					aria-checked={on}
					class={`${styles.switch} ${on ? styles.switchOn : ''}`}
					onClick={onToggle}
					disabled={disabled || toggleDisabled}
					title={
						disabled
							? '"Use My Profile" is off — favorites are not influencing recommendations'
							: on
								? `Stop using all ${title.replace(/^Use (my )?/i, '')}`
								: `Use all ${title.replace(/^Use (my )?/i, '')}`
					}
				>
					<span class={styles.switchDot} aria-hidden="true" />
				</button>

				<button
					type="button"
					class={styles.groupTitleBtn}
					onClick={() => setCollapsed((v) => !v)}
					aria-expanded={!collapsed}
				>
					<span class={styles.groupTitle}>{title}</span>
					{count != null && count > 0 && <span class={styles.groupCount}>{count}</span>}
					<span class={`${styles.chevron} ${collapsed ? styles.chevronCollapsed : ''}`}>
						<Icon name="chevron-down" size={14} />
					</span>
				</button>
			</div>

			{!collapsed && <div class={styles.groupBody}>{children}</div>}
		</section>
	);
}

function MovieChip({
	id,
	title,
	posterUrl,
	disabled,
}: {
	id: string;
	title: string;
	posterUrl?: string;
	disabled?: boolean;
}) {
	const seeded = seedMovieIds.value.includes(id);
	return (
		<button
			type="button"
			class={`${styles.chip} ${seeded ? styles.chipActive : ''}`}
			onClick={() => (seeded ? removeSeed(id) : addSeed(id, title))}
			disabled={disabled}
			title={
				disabled
					? '"Use My Profile" is off — favorites are not influencing recommendations'
					: seeded
						? `Remove "${title}" from the seeds`
						: `Seed Discover with "${title}"`
			}
		>
			<span class={styles.chipThumb}>
				{posterUrl ? <SmartImage src={posterUrl} alt="" /> : <Icon name="film" size={12} />}
			</span>
			<span class={styles.chipLabel}>{title}</span>
		</button>
	);
}

function PersonChip({ entry, disabled }: { entry: FavoriteEntry; disabled?: boolean }) {
	const seeded = personSeedKeys.value.includes(entry.key);

	return (
		<div class={styles.personChipWrap}>
			<button
				type="button"
				class={`${styles.chip} ${seeded ? styles.chipActive : ''}`}
				onClick={() =>
					seeded
						? removePersonSeed(entry.key)
						: addPersonSeed(entry.key, entry.person!.name)
				}
				disabled={disabled}
				title={
					disabled
						? '"Use My Profile" is off — favorites are not influencing recommendations'
						: seeded
							? `Remove ${entry.person!.name} from the seeds`
							: `Seed Discover with ${entry.person!.name}'s films`
				}
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

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import { MovieListItem } from '@/components/movie/MovieListItem';
import { type GroupDetailResponse, groupsService, type MovieGroup } from '@/services/groups.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './GroupDetail.module.scss';

interface GroupDetailProps {
	path?: string;
	id?: string;
}

/**
 * Renders either:
 *  - A parent group: header + list of season subgroups, with an
 *    expandable episode list per season.
 *  - A subgroup directly: header + flat list of episodes.
 *
 * Shows confirmation banners for `unsure` groups with a "Mu thinks this
 * belongs under <other>" prompt and Move / Keep / Reject affordances.
 */
export function GroupDetail({ id }: GroupDetailProps) {
	const [data, setData] = useState<GroupDetailResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Per-subgroup episode lists, lazy-loaded on expand.
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [childMovies, setChildMovies] = useState<Record<string, GroupDetailResponse['movies']>>({});

	useEffect(() => {
		if (!id) return;
		setLoading(true);
		groupsService
			.get(id)
			.then((d) => {
				setData(d);
				setError(null);
			})
			.catch((err: { message?: string }) => {
				setError(err?.message ?? 'Failed to load group');
			})
			.finally(() => setLoading(false));
	}, [id]);

	async function expandChild(child: MovieGroup) {
		if (expanded[child.id]) {
			setExpanded((p) => ({ ...p, [child.id]: false }));
			return;
		}
		setExpanded((p) => ({ ...p, [child.id]: true }));
		if (!childMovies[child.id]) {
			try {
				const { movies } = await groupsService.listMovies(child.id);
				setChildMovies((p) => ({ ...p, [child.id]: movies }));
			} catch {
				notifyError(`Couldn't load episodes for ${child.name}`);
			}
		}
	}

	async function handleConfirm(target: MovieGroup) {
		setBusy(true);
		try {
			await groupsService.confirm(target.id);
			notifySuccess(`${target.name} confirmed`);
			// Re-fetch so banners disappear.
			const fresh = await groupsService.get(id!);
			setData(fresh);
		} catch {
			notifyError('Failed to confirm group');
		} finally {
			setBusy(false);
		}
	}

	async function handleReject(target: MovieGroup) {
		if (!confirm(`Ungroup "${target.name}"? Its movies will return to the flat library.`)) return;
		setBusy(true);
		try {
			await groupsService.reject(target.id);
			notifySuccess(`${target.name} ungrouped`);
			// If we rejected the page's own group, bail to the library.
			if (target.id === id) {
				route('/library');
				return;
			}
			const fresh = await groupsService.get(id!);
			setData(fresh);
		} catch {
			notifyError('Failed to ungroup');
		} finally {
			setBusy(false);
		}
	}

	if (loading) {
		return (
			<div class={styles.loadingWrap}>
				<Spinner size="lg" />
			</div>
		);
	}
	if (error || !data) {
		return (
			<div class={styles.errorWrap}>
				<h2>Group not found</h2>
				<p>{error}</p>
				<Button variant="ghost" onClick={() => route('/library')}>
					<Icon name="arrow-left" size={14} /> Back to library
				</Button>
			</div>
		);
	}

	const isParent = data.group.type === 'parent';
	const isUnsure = data.group.status === 'unsure';
	const totalEpisodes = isParent
		? data.children.reduce((acc) => acc + 0, 0) // child count populated on expand
		: data.movies.length;

	return (
		<div class={styles.page}>
			<div class={styles.header}>
				<button class={styles.backLink} onClick={() => route('/library')}>
					<Icon name="arrow-left" size={14} /> Library
				</button>

				<div class={styles.heroRow}>
					<div class={styles.posterColumn}>
						<div class={styles.poster}>
							<SmartImage
								src={data.group.posterUrl ?? undefined}
								alt={`${data.group.name} poster`}
								imgClass={styles.posterImg}
								fallbackLabel={data.group.name}
							/>
						</div>
					</div>

					<div class={styles.infoColumn}>
						<div class={styles.titleRow}>
							<h1 class={styles.title}>{data.group.name}</h1>
							<span class={styles.groupTypeBadge}>{data.group.groupType}</span>
							{data.group.status === 'confirmed' && (
								<span class={styles.confirmedBadge}>Confirmed</span>
							)}
							{data.group.status === 'auto' && (
								<span class={styles.autoBadge}>Auto-grouped</span>
							)}
						</div>
						<div class={styles.meta}>
							{isParent ? (
								<span>
									{data.children.length}{' '}
									{data.children.length === 1 ? 'season' : 'seasons'}
								</span>
							) : (
								<span>
									{totalEpisodes}{' '}
									{totalEpisodes === 1 ? 'episode' : 'episodes'}
								</span>
							)}
							{data.group.confidence != null && (
								<span>
									{Math.round(data.group.confidence * 100)}% confidence
								</span>
							)}
							{data.group.detectionSource && (
								<span class={styles.metaMuted}>
									via {data.group.detectionSource}
								</span>
							)}
						</div>

						{data.group.overview && (
							<p class={styles.overview}>{data.group.overview}</p>
						)}

						<div class={styles.actions}>
							{isUnsure && (
								<Button
									variant="primary"
									onClick={() => handleConfirm(data.group)}
									disabled={busy}
								>
									<Icon name="check" size={14} /> Confirm grouping
								</Button>
							)}
							<Button
								variant="ghost"
								onClick={() => handleReject(data.group)}
								disabled={busy}
							>
								<Icon name="x" size={14} /> Ungroup
							</Button>
						</div>
					</div>
				</div>

				{isUnsure && data.altParents.length > 0 && (
					<div class={styles.unsureBanner}>
						<strong>Mu isn't sure this grouping is right.</strong> Possible
						alternatives:{' '}
						{data.altParents.slice(0, 3).map((a, i) => (
							<span key={a.parentGroupId} class={styles.altPill}>
								{i > 0 ? ', ' : ''}
								<a href={`/group/${a.parentGroupId}`}>{a.parentGroupId}</a>{' '}
								<span class={styles.altScore}>
									({Math.round(a.confidence * 100)}%)
								</span>
							</span>
						))}
					</div>
				)}
			</div>

			{/* Body — seasons / episodes */}
			{isParent ? (
				<div class={styles.seasonsList}>
					{data.children.length === 0 ? (
						<div class={styles.empty}>
							No subgroups yet. Episodes get attached when files are scanned.
						</div>
					) : (
						data.children
							.slice()
							.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
							.map((child) => (
								<div key={child.id} class={styles.seasonCard}>
									<button
										class={styles.seasonHeader}
										onClick={() => expandChild(child)}
									>
										<Icon
											name={
												expanded[child.id] ? 'chevron-down' : 'chevron-right'
											}
											size={14}
										/>
										<span class={styles.seasonName}>{child.name}</span>
										{child.status === 'unsure' && (
											<span class={styles.unsurePill} title="Mu isn't sure about this">
												<Icon name="warning" size={12} /> unsure
											</span>
										)}
										{child.confidence != null && (
											<span class={styles.seasonConfidence}>
												{Math.round(child.confidence * 100)}%
											</span>
										)}
									</button>

									{expanded[child.id] && (
										<div class={styles.episodes}>
											{(childMovies[child.id] ?? []).length === 0 ? (
												<div class={styles.empty}>(loading…)</div>
											) : (
												(childMovies[child.id] ?? [])
													.slice()
													.sort(
														(a, b) =>
															(a.groupEpisodeOrdinal ?? 0) -
															(b.groupEpisodeOrdinal ?? 0),
													)
													.map((m) => (
														<MovieListItem
															key={m.id}
															movie={m}
														/>
													))
											)}
											{child.status === 'unsure' && (
												<div class={styles.subgroupActions}>
													<Button
														variant="primary"
														size="sm"
														onClick={() => handleConfirm(child)}
														disabled={busy}
													>
														<Icon name="check" size={12} /> Confirm
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleReject(child)}
														disabled={busy}
													>
														<Icon name="x" size={12} /> Reject
													</Button>
												</div>
											)}
										</div>
									)}
								</div>
							))
					)}
				</div>
			) : (
				<div class={styles.episodesFlat}>
					{data.movies
						.slice()
						.sort(
							(a, b) =>
								(a.groupEpisodeOrdinal ?? 0) - (b.groupEpisodeOrdinal ?? 0),
						)
						.map((m) => (
							<MovieListItem key={m.id} movie={m} />
						))}
				</div>
			)}
		</div>
	);
}

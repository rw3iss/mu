import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { moviesService } from '@/services/movies.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './JobsPanel.module.scss';

/**
 * Self-contained admin jobs panel.
 *
 * Two tabs (Current / History) over the same job model, plus a
 * search box, a multi-select type filter, and a single-select
 * status filter. Used both in the Settings → Jobs sidebar tab and
 * on the legacy /admin/jobs route (now removed in favour of the
 * settings tab).
 *
 * Capabilities:
 *   - Live polling of running jobs (3s while Current tab is active).
 *   - Filter by search string (matches label, type, payload.filePath).
 *   - Filter by job type (multi-select dropdown).
 *   - Filter by job status (Select dropdown).
 *   - Bulk select on Current tab: prioritise / pause / cancel.
 *   - Retry a failed job (current OR history).
 *   - Expand row to see details + per-row action buttons.
 *   - Delete all history.
 *
 * SOLID notes:
 *   - SRP: this component owns ONLY the jobs UI. The legacy
 *     ServerSettings page now just renders other server panels.
 *   - DIP: depends on the API client + notifications signal — no
 *     reach into other Settings tabs.
 */

const KNOWN_JOB_TYPES = [
	'scan',
	'scan-all',
	'metadata',
	'thumbnail',
	'sprite-sheet',
	'pre-transcode',
	'cleanup',
	'external-enrichment',
	'source-backfill',
] as const;

const STATUS_OPTIONS = [
	{ value: '', label: 'All statuses' },
	{ value: 'running', label: 'Running' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'paused', label: 'Paused' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'failed', label: 'Failed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS: Record<string, string> = {
	running: '#22c55e',
	pending: '#f59e0b',
	completed: '#06b6d4',
	failed: '#ef4444',
	paused: '#8b5cf6',
	cancelled: '#6b7280',
};

/**
 * Per-tab cache of resolved movie titles. Keyed by movieId.
 * - undefined = never looked up
 * - string    = title (or empty string if 404)
 * - Promise   = in-flight fetch (shared across concurrent callers)
 *
 * Kept at module level so navigating away and back doesn't re-fetch.
 * Cleared automatically on a hard refresh (it's not persisted).
 */
const movieTitleCache = new Map<string, string | Promise<string>>();

/**
 * Fetch a movie's title and update the cache. Called lazily from
 * useMovieTitle; multiple concurrent callers share the same Promise
 * so we don't issue duplicate requests for the same id.
 */
function fetchMovieTitle(id: string): Promise<string> {
	const existing = movieTitleCache.get(id);
	if (typeof existing === 'string') return Promise.resolve(existing);
	if (existing instanceof Promise) return existing;
	const p = moviesService
		.get(id)
		.then((m) => {
			const title = m?.title ?? '';
			movieTitleCache.set(id, title);
			return title;
		})
		.catch(() => {
			// 404 / network — cache empty so we don't retry every render.
			movieTitleCache.set(id, '');
			return '';
		});
	movieTitleCache.set(id, p);
	return p;
}

/**
 * Strip a trailing 8-hex-char ID suffix from a job label so the
 * caller can append the movie title in its place. Returns the
 * original string when no suffix is detected.
 *
 * Patterns we handle (from the existing label producers):
 *   "Generate sprites: 6454b543"          → "Generate sprites:"
 *   "Enrich external movie 6454b543"      → "Enrich external movie"
 *   "Back-fill X for movie 6454b543"      → "Back-fill X for movie"
 */
function stripIdSuffix(label: string): string {
	return label.replace(/\s*:?\s*[0-9a-f]{8}\s*$/, '').replace(/\s+$/, '');
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remSec = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remSec}s`;
	const hours = Math.floor(minutes / 60);
	const remMin = minutes % 60;
	return `${hours}h ${remMin}m`;
}

export function JobsPanel() {
	const [tab, setTab] = useState<'current' | 'history'>('current');
	const [currentJobs, setCurrentJobs] = useState<any[]>([]);
	const [historyJobs, setHistoryJobs] = useState<any[]>([]);
	const [expandedJob, setExpandedJob] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [cancellingBulk, setCancellingBulk] = useState(false);
	const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
	const [clearingHistory, setClearingHistory] = useState(false);
	const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
	/** Types the user has explicitly deselected. Defaults empty = all on. */
	const [disabledTypes, setDisabledTypes] = useState<Set<string>>(new Set());
	const [filterOpen, setFilterOpen] = useState(false);
	const [statusFilter, setStatusFilter] = useState<string>('');
	const filterRef = useRef<HTMLDivElement>(null);
	const lastSelectedRef = useRef<string | null>(null);
	/** Resolved movie titles for visible jobs, keyed by movieId.
	 *  Empty string = looked up and missing. Undefined = not fetched yet.
	 *  Hydrated by the effect below; renders fall back to short id slice. */
	const [movieTitles, setMovieTitles] = useState<Record<string, string>>({});

	// Outside-click closes the type-filter dropdown.
	useEffect(() => {
		if (!filterOpen) return;
		const onMouseDown = (e: MouseEvent) => {
			if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
				setFilterOpen(false);
			}
		};
		document.addEventListener('mousedown', onMouseDown);
		return () => document.removeEventListener('mousedown', onMouseDown);
	}, [filterOpen]);

	useEffect(() => {
		let cancelled = false;
		const loadCurrent = async () => {
			try {
				const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
				if (!cancelled) setCurrentJobs(data.jobs);
			} catch {}
		};
		const loadHistory = async () => {
			try {
				const data = await api.get<{ jobs: any[] }>('/admin/server/jobs/history?limit=200');
				if (!cancelled) setHistoryJobs(data.jobs);
			} catch {}
		};
		// Load BOTH up front (and keep both polling) so the tab counts are
		// accurate immediately and stay live. Previously history was lazy-
		// loaded only while its tab was active, so "History (N)" showed 0 the
		// whole time you watched jobs on the Current tab — and never updated
		// as jobs completed.
		loadCurrent();
		loadHistory();
		const interval = setInterval(() => {
			loadCurrent();
			loadHistory();
		}, 3000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	// Clear selection when switching tabs.
	useEffect(() => setSelected(new Set()), [tab]);

	// Resolve movie titles for any job referencing a movieId. Pulls
	// from / populates the module-level movieTitleCache so navigating
	// back to this panel doesn't refetch. Cancellable so unmount /
	// fast tab switches don't trample later results.
	useEffect(() => {
		const idsInView = new Set<string>();
		for (const list of [currentJobs, historyJobs]) {
			for (const j of list) {
				const mid = j?.payload?.movieId;
				if (typeof mid === 'string' && mid) idsInView.add(mid);
			}
		}
		const needed: string[] = [];
		const initialUpdates: Record<string, string> = {};
		for (const id of idsInView) {
			const cached = movieTitleCache.get(id);
			if (typeof cached === 'string') {
				if (!(id in movieTitles)) initialUpdates[id] = cached;
			} else if (cached === undefined) {
				needed.push(id);
			}
		}
		if (Object.keys(initialUpdates).length > 0) {
			setMovieTitles((prev) => ({ ...prev, ...initialUpdates }));
		}
		if (needed.length === 0) return;

		let cancelled = false;
		void Promise.all(
			needed.map((id) =>
				fetchMovieTitle(id).then((title) => {
					if (cancelled) return;
					setMovieTitles((prev) =>
						prev[id] === title ? prev : { ...prev, [id]: title },
					);
				}),
			),
		);
		return () => {
			cancelled = true;
		};
	}, [currentJobs, historyJobs]);

	const handleAction = useCallback(async (id: string, action: string) => {
		try {
			await api.post(`/admin/server/jobs/${id}/${action}`);
			const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
			setCurrentJobs(data.jobs);
		} catch {
			notifyError(`Failed to ${action} job`);
		}
	}, []);

	const handleRetry = useCallback(async (id: string) => {
		setRetryingIds((s) => {
			const next = new Set(s);
			next.add(id);
			return next;
		});
		try {
			const result = await api.post<{
				success: boolean;
				newJobId: string | null;
				reason?: string;
			}>(`/admin/server/jobs/${id}/retry`);
			if (result.success && result.newJobId) {
				notifySuccess('Job re-queued');
				try {
					const [current, history] = await Promise.all([
						api.get<{ jobs: any[] }>('/admin/server/jobs'),
						api.get<{ jobs: any[] }>('/admin/server/jobs/history?limit=200'),
					]);
					setCurrentJobs(current.jobs);
					setHistoryJobs(history.jobs);
				} catch {
					/* next poll tick recovers */
				}
			} else {
				notifyError(`Retry failed: ${result.reason ?? 'unknown reason'}`);
			}
		} catch (err: unknown) {
			notifyError(
				`Retry failed: ${(err as { message?: string })?.message ?? 'request error'}`,
			);
		} finally {
			setRetryingIds((s) => {
				const next = new Set(s);
				next.delete(id);
				return next;
			});
		}
	}, []);

	const handleBulkAction = useCallback(
		async (action: 'cancel' | 'pause' | 'prioritize') => {
			if (selected.size === 0) return;
			setCancellingBulk(true);
			try {
				await Promise.allSettled(
					[...selected].map((id) => api.post(`/admin/server/jobs/${id}/${action}`)),
				);
				const count = selected.size;
				setSelected(new Set());
				const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
				setCurrentJobs(data.jobs);
				const labels: Record<string, string> = {
					cancel: 'Cancelled',
					pause: 'Paused',
					prioritize: 'Prioritized',
				};
				notifySuccess(`${labels[action]} ${count} job(s)`);
			} catch {
				notifyError(`Failed to ${action} some jobs`);
			} finally {
				setCancellingBulk(false);
			}
		},
		[selected],
	);

	const handleClearHistory = useCallback(async () => {
		setClearingHistory(true);
		try {
			const result = await api.delete<{ deleted: number }>('/admin/server/jobs/history');
			setHistoryJobs([]);
			setShowClearHistoryConfirm(false);
			notifySuccess(`Cleared ${result.deleted} job${result.deleted !== 1 ? 's' : ''}`);
		} catch {
			notifyError('Failed to clear job history');
		} finally {
			setClearingHistory(false);
		}
	}, []);

	// Union of all job types: hard-coded canonical list + anything
	// we've seen come back from the server. Sorted for stable order.
	const allTypes = useMemo(() => {
		const types = new Set<string>(KNOWN_JOB_TYPES);
		for (const j of currentJobs) if (j.type) types.add(j.type);
		for (const j of historyJobs) if (j.type) types.add(j.type);
		return [...types].sort();
	}, [currentJobs, historyJobs]);

	const allDeselected = disabledTypes.size > 0 && allTypes.every((t) => disabledTypes.has(t));
	const noneDeselected = disabledTypes.size === 0;

	const toggleType = useCallback((type: string) => {
		setDisabledTypes((prev) => {
			const next = new Set(prev);
			if (next.has(type)) next.delete(type);
			else next.add(type);
			return next;
		});
	}, []);

	// Filter pipeline: tab → type → status → search.
	const jobs = tab === 'current' ? currentJobs : historyJobs;
	const q = searchQuery.toLowerCase().trim();
	const filtered = jobs
		.filter((j: any) => !disabledTypes.has(j.type))
		.filter((j: any) => (statusFilter ? j.status === statusFilter : true))
		.filter((j: any) =>
			!q
				? true
				: (j.label || '').toLowerCase().includes(q) ||
					(j.type || '').toLowerCase().includes(q) ||
					(j.id || '').toLowerCase().includes(q) ||
					(j.payload?.filePath || '').toLowerCase().includes(q),
		);

	return (
		<div class={styles.container}>
			{/* Sticky toolbar: tabs + filters + bulk actions */}
			<div class={styles.toolbar}>
				<div class={styles.toolbarTop}>
					<div class={styles.tabs}>
						<button
							class={`${styles.tab} ${tab === 'current' ? styles.tabActive : ''}`}
							onClick={() => setTab('current')}
						>
							Current ({currentJobs.length})
						</button>
						<button
							class={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
							onClick={() => setTab('history')}
						>
							History ({historyJobs.length})
						</button>
					</div>
					<div class={styles.toolbarRight}>
						{tab === 'current' && selected.size > 0 && (
							<div class={styles.bulkActions}>
								<span class={styles.bulkCount}>{selected.size} selected</span>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => handleBulkAction('prioritize')}
									loading={cancellingBulk}
								>
									Prioritize
								</Button>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => handleBulkAction('pause')}
									loading={cancellingBulk}
								>
									Pause
								</Button>
								<Button
									variant="danger"
									size="sm"
									onClick={() => handleBulkAction('cancel')}
									loading={cancellingBulk}
								>
									Cancel
								</Button>
							</div>
						)}
						{tab === 'history' && historyJobs.length > 0 && (
							<div class={styles.bulkActions}>
								<Button
									variant="danger"
									size="sm"
									onClick={() => setShowClearHistoryConfirm(true)}
									loading={clearingHistory}
								>
									Delete All
								</Button>
							</div>
						)}
						<div class={styles.statusFilter}>
							<Select
								value={statusFilter}
								onChange={(v) => setStatusFilter(v)}
								options={STATUS_OPTIONS}
							/>
						</div>
						<div class={styles.typeFilter} ref={filterRef}>
							<button
								class={`${styles.typeFilterTrigger} ${
									disabledTypes.size > 0 ? styles.typeFilterActive : ''
								}`}
								onClick={() => setFilterOpen((o) => !o)}
								aria-haspopup="menu"
								aria-expanded={filterOpen}
								title="Filter by job type"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								>
									<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
								</svg>
								<span>Types</span>
								{disabledTypes.size > 0 && (
									<span class={styles.typeFilterBadge}>
										{allTypes.length - disabledTypes.size}/{allTypes.length}
									</span>
								)}
								<span class={styles.typeFilterChevron} aria-hidden="true">
									▾
								</span>
							</button>
							{filterOpen && (
								<div class={styles.typeFilterMenu} role="menu">
									<button
										class={styles.typeFilterAction}
										onClick={() => setDisabledTypes(new Set())}
										disabled={noneDeselected}
									>
										Select all
									</button>
									<button
										class={styles.typeFilterAction}
										onClick={() => setDisabledTypes(new Set(allTypes))}
										disabled={allDeselected}
									>
										Deselect all
									</button>
									<div class={styles.typeFilterDivider} />
									{allTypes.map((type) => {
										const checked = !disabledTypes.has(type);
										return (
											<label key={type} class={styles.typeFilterItem}>
												<input
													type="checkbox"
													checked={checked}
													onChange={() => toggleType(type)}
												/>
												<span>{type}</span>
											</label>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>
				<div class={styles.searchRow}>
					<div class={styles.searchWrap}>
						<svg
							class={styles.searchIcon}
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<circle cx="11" cy="11" r="8" />
							<line x1="21" y1="21" x2="16.65" y2="16.65" />
						</svg>
						<input
							type="text"
							class={styles.searchInput}
							placeholder="Search by label, type, id, file path…"
							value={searchQuery}
							onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
						/>
						{searchQuery && (
							<button
								class={styles.searchClear}
								onClick={() => setSearchQuery('')}
								title="Clear search"
							>
								x
							</button>
						)}
					</div>
				</div>
			</div>

			<div class={styles.list}>
				{filtered.length === 0 ? (
					<div class={styles.emptyText}>
						{q || statusFilter || disabledTypes.size > 0
							? 'No jobs match the current filters.'
							: `No ${tab === 'current' ? 'active' : 'historical'} jobs.`}
					</div>
				) : (
					filtered.map((job: any) => {
						const isCancellable =
							job.status === 'running' ||
							job.status === 'pending' ||
							job.status === 'paused';
						const isSelected = selected.has(job.id);
						return (
							<div
								key={job.id}
								class={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
								onClick={(e: MouseEvent) => {
									if (tab !== 'current' || !isCancellable) return;
									const next = new Set(selected);
									if (e.shiftKey && lastSelectedRef.current) {
										const lastIdx = filtered.findIndex(
											(j: any) => j.id === lastSelectedRef.current,
										);
										const curIdx = filtered.findIndex(
											(j: any) => j.id === job.id,
										);
										if (lastIdx !== -1 && curIdx !== -1) {
											const [from, to] =
												lastIdx < curIdx
													? [lastIdx, curIdx]
													: [curIdx, lastIdx];
											for (let i = from; i <= to; i++) {
												const j = filtered[i];
												if (
													j.status === 'running' ||
													j.status === 'pending' ||
													j.status === 'paused'
												) {
													next.add(j.id);
												}
											}
										}
									} else {
										if (next.has(job.id)) next.delete(job.id);
										else next.add(job.id);
									}
									lastSelectedRef.current = job.id;
									setSelected(next);
								}}
							>
								<div class={styles.header}>
									<span class={styles.type}>{job.type}</span>
									<span
										class={styles.statusBadge}
										style={{
											background: STATUS_COLORS[job.status] || '#6b7280',
										}}
									>
										{job.status}
									</span>
									{(() => {
										const mid = job.payload?.movieId as string | undefined;
										const title = mid ? movieTitles[mid] : undefined;
										// Drop the trailing 8-char id from the label when
										// we have a real title to show in its place.
										const cleanLabel = title
											? stripIdSuffix(job.label || '')
											: job.label;
										return (
											<span class={styles.label}>
												{cleanLabel}
												{mid && title ? (
													<>
														{cleanLabel ? ' ' : ''}
														<a
															href={`/movie/${mid}`}
															class={styles.labelMovieLink}
															onClick={(e: Event) => {
																e.stopPropagation();
																e.preventDefault();
																route(`/movie/${mid}`);
															}}
														>
															{title}
														</a>
													</>
												) : null}
											</span>
										);
									})()}
									{job.progress > 0 && job.progress < 100 && (
										<span class={styles.progress}>
											{job.progress.toFixed(0)}%
										</span>
									)}
									{(job.startedAt || job.createdAt) && (
										<span class={styles.time}>
											{new Date(
												job.startedAt || job.createdAt,
											).toLocaleString(undefined, {
												month: 'short',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit',
											})}
										</span>
									)}
									{job.status === 'failed' && (
										<button
											class={styles.retryBtn}
											onClick={(e: Event) => {
												e.stopPropagation();
												handleRetry(job.id);
											}}
											title={retryingIds.has(job.id) ? 'Retrying…' : 'Retry'}
											disabled={retryingIds.has(job.id)}
										>
											{retryingIds.has(job.id) ? (
												<Spinner size="xs" />
											) : (
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
												>
													<polyline points="23 4 23 10 17 10" />
													<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
												</svg>
											)}
										</button>
									)}
									<button
										class={styles.detailsBtn}
										onClick={(e: Event) => {
											e.stopPropagation();
											setExpandedJob(expandedJob === job.id ? null : job.id);
										}}
										title="Details"
									>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
										>
											{expandedJob === job.id ? (
												<polyline points="18 15 12 9 6 15" />
											) : (
												<polyline points="6 9 12 15 18 9" />
											)}
										</svg>
									</button>
								</div>
								{job.progress > 0 && job.status === 'running' && (
									<div class={styles.progressBar}>
										<div
											class={styles.progressFill}
											style={{ width: `${job.progress}%` }}
										/>
									</div>
								)}
								{expandedJob === job.id && (
									<div class={styles.details}>
										{job.payload?.movieId &&
											(() => {
												const mid = job.payload.movieId as string;
												const title = movieTitles[mid];
												return (
													<div class={styles.infoRow}>
														<span class={styles.infoLabel}>Movie</span>
														<a
															class={`${styles.infoValue} ${styles.infoLink}`}
															href={`/movie/${mid}`}
															onClick={(e: Event) => {
																e.preventDefault();
																route(`/movie/${mid}`);
															}}
														>
															{title || `(loading…) ${mid.slice(0, 8)}`}
														</a>
													</div>
												);
											})()}
										<div class={styles.infoRow}>
											<span class={styles.infoLabel}>ID</span>
											<span class={styles.infoValue}>{job.id}</span>
										</div>
										{job.priority != null && (
											<div class={styles.infoRow}>
												<span class={styles.infoLabel}>Priority</span>
												<span class={styles.infoValue}>{job.priority}</span>
											</div>
										)}
										{job.payload?.filePath && (
											<div class={styles.infoRow}>
												<span class={styles.infoLabel}>File</span>
												<span class={styles.infoValue}>
													{job.payload.filePath}
												</span>
											</div>
										)}
										{job.payload?.quality && (
											<div class={styles.infoRow}>
												<span class={styles.infoLabel}>Quality</span>
												<span class={styles.infoValue}>
													{job.payload.quality}
												</span>
											</div>
										)}
										{job.startedAt && (
											<div class={styles.infoRow}>
												<span class={styles.infoLabel}>Started</span>
												<span class={styles.infoValue}>
													{new Date(job.startedAt).toLocaleString()}
												</span>
											</div>
										)}
										{job.durationMs != null && (
											<div class={styles.infoRow}>
												<span class={styles.infoLabel}>Duration</span>
												<span class={styles.infoValue}>
													{formatDuration(job.durationMs)}
												</span>
											</div>
										)}
										{job.error && (
											<div class={styles.infoRow}>
												<span class={styles.infoLabel}>Error</span>
												<span
													class={`${styles.infoValue} ${styles.errorText}`}
												>
													{job.error}
												</span>
											</div>
										)}
										{tab === 'current' && (
											<div class={styles.actions}>
												{job.status === 'pending' && job.priority !== 1 && (
													<Button
														variant="ghost"
														size="sm"
														onClick={(e: Event) => {
															e.stopPropagation();
															handleAction(job.id, 'prioritize');
														}}
													>
														Prioritize
													</Button>
												)}
												{job.status === 'running' && (
													<Button
														variant="ghost"
														size="sm"
														onClick={(e: Event) => {
															e.stopPropagation();
															handleAction(job.id, 'pause');
														}}
													>
														Pause
													</Button>
												)}
												{job.status === 'paused' && (
													<Button
														variant="ghost"
														size="sm"
														onClick={(e: Event) => {
															e.stopPropagation();
															handleAction(job.id, 'resume');
														}}
													>
														Resume
													</Button>
												)}
												{isCancellable && (
													<Button
														variant="ghost"
														size="sm"
														onClick={(e: Event) => {
															e.stopPropagation();
															handleAction(job.id, 'cancel');
														}}
													>
														Cancel
													</Button>
												)}
											</div>
										)}
									</div>
								)}
							</div>
						);
					})
				)}
			</div>

			<ConfirmDialog
				isOpen={showClearHistoryConfirm}
				onClose={() => setShowClearHistoryConfirm(false)}
				onConfirm={handleClearHistory}
				title="Delete all job history?"
				message={`This will permanently remove all ${historyJobs.length} job history record${
					historyJobs.length !== 1 ? 's' : ''
				}. Currently running and pending jobs are not affected. This cannot be undone.`}
				confirmLabel="Delete All"
				variant="danger"
				loading={clearingHistory}
			/>
		</div>
	);
}

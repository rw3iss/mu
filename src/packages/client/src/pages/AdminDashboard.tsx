import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { jobAction, jobListAction } from '@/components/admin/JobBadge';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { groupsService } from '@/services/groups.service';
import type { ActiveSession, SessionHistoryEntry } from '@/services/stream.service';
import { streamService } from '@/services/stream.service';
import { formatBytes } from '@/utils/format-bytes';
import { wsService } from '@/services/websocket.service';
import { fetchMovies } from '@/state/library.state';
import {
	notifyError,
	notifyInfo,
	notifySuccess,
	removeNotification,
} from '@/state/notifications.state';
import styles from './AdminDashboard.module.scss';

interface AdminDashboardProps {
	path?: string;
}

interface SystemInfo {
	version: string;
	uptime: number;
	totalMovies: number;
	totalUsers: number;
	diskUsage: { used: number; total: number };
}

export function AdminDashboard(_props: AdminDashboardProps) {
	const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
	const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [endingSessionId, setEndingSessionId] = useState<string | null>(null);
	const [endingAll, setEndingAll] = useState(false);
	const [generatingThumbnails, setGeneratingThumbnails] = useState(false);
	const [fixingThumbnails, setFixingThumbnails] = useState(false);
	const [showFixThumbnailsConfirm, setShowFixThumbnailsConfirm] = useState(false);
	const [generatingSprites, setGeneratingSprites] = useState(false);
	const [removingBroken, setRemovingBroken] = useState(false);
	const [groupingItems, setGroupingItems] = useState(false);
	const [sanitizingTitles, setSanitizingTitles] = useState(false);
	const [showSanitizeConfirm, setShowSanitizeConfirm] = useState(false);
	const [showRemoveBrokenConfirm, setShowRemoveBrokenConfirm] = useState(false);
	const [clearingWatched, setClearingWatched] = useState(false);
	const [showClearWatchedConfirm, setShowClearWatchedConfirm] = useState(false);
	const [watchedMovieCount, setWatchedMovieCount] = useState(0);
	const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
	const [clearingHistory, setClearingHistory] = useState(false);
	const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);

	useEffect(() => {
		loadData();
	}, []);

	async function loadData() {
		setIsLoading(true);
		try {
			const [info, sessions, history] = await Promise.allSettled([
				api.get<SystemInfo>('/admin/system'),
				streamService.getActiveSessions(),
				streamService.getSessionHistory(),
			]);

			if (info.status === 'fulfilled') setSystemInfo(info.value);
			if (sessions.status === 'fulfilled') setActiveSessions(sessions.value);
			if (history.status === 'fulfilled') setSessionHistory(history.value);

			api.get<{ count: number }>('/history/watched/count')
				.then((res) => setWatchedMovieCount(res.count))
				.catch(() => {});
		} catch (error) {
			console.error('Failed to load admin data:', error);
		} finally {
			setIsLoading(false);
		}
	}

	const handleScanLibrary = useCallback(async () => {
		const startedId = notifyInfo('Scanning library…', 0);
		try {
			const result = await api.post<{
				message: string;
				sourceCount: number;
				filesFound: number;
				filesAdded: number;
				filesUpdated: number;
				filesRemoved: number;
			}>('/sources/scan');
			removeNotification(startedId);
			const parts = [
				`${result.filesFound} file${result.filesFound === 1 ? '' : 's'} scanned`,
				`${result.filesAdded} added`,
			];
			if (result.filesUpdated > 0) parts.push(`${result.filesUpdated} updated`);
			if (result.filesRemoved > 0) parts.push(`${result.filesRemoved} removed`);
			notifySuccess(`Library scan complete: ${parts.join(', ')}.`);
			fetchMovies(1);
		} catch {
			removeNotification(startedId);
			notifyError('Failed to scan library');
		}
	}, []);

	const handleRefreshMetadata = useCallback(async () => {
		const startedId = notifyInfo('Starting metadata refresh…', 0);
		try {
			const result = await api.post<{ message: string; movieCount: number }>(
				'/movies/refresh-all',
			);
			removeNotification(startedId);
			if (result.movieCount === 0) {
				notifySuccess('All movies already have metadata — nothing to refresh.');
				return;
			}
			notifySuccess(
				`Refreshing metadata for ${result.movieCount} movie${
					result.movieCount === 1 ? '' : 's'
				} in the background.`,
				undefined,
				[jobListAction('metadata')],
			);
		} catch {
			removeNotification(startedId);
			notifyError('Failed to start metadata refresh');
		}
	}, []);

	const handleGenerateThumbnails = useCallback(async () => {
		setGeneratingThumbnails(true);
		const startedId = notifyInfo('Looking for movies without thumbnails…', 0);
		try {
			const result = await streamService.generateMissingThumbnails();
			removeNotification(startedId);
			if (result.movieCount === 0) {
				notifySuccess('All movies already have thumbnails.');
				return;
			}
			notifySuccess(
				`Enqueued thumbnail generation for ${result.movieCount} movie${
					result.movieCount === 1 ? '' : 's'
				}.`,
				undefined,
				[jobListAction('thumbnail')],
			);
		} catch {
			removeNotification(startedId);
			notifyError('Failed to start thumbnail generation');
		} finally {
			setGeneratingThumbnails(false);
		}
	}, []);

	const handleFixBrokenThumbnails = useCallback(async () => {
		setFixingThumbnails(true);
		const startedId = notifyInfo('Scanning for broken thumbnails…', 0);
		try {
			const result = await api.post<{ movieCount: number; message: string }>(
				'/admin/fix-broken-thumbnails',
			);
			removeNotification(startedId);
			if (result.movieCount === 0) {
				notifySuccess('No broken thumbnails found.');
				return;
			}
			notifySuccess(
				`Regenerating ${result.movieCount} broken thumbnail${
					result.movieCount === 1 ? '' : 's'
				}.`,
				undefined,
				[jobListAction('thumbnail')],
			);
		} catch {
			removeNotification(startedId);
			notifyError('Failed to fix broken thumbnails');
		} finally {
			setFixingThumbnails(false);
		}
	}, []);

	const handleGroupSimilarItems = useCallback(async () => {
		setGroupingItems(true);
		let progressToastId: string | null = null;
		let cleanup: (() => void) | null = null;
		try {
			const queued = await groupsService.rebuild();
			progressToastId = notifyInfo(
				`Grouping started: analysing ${queued.totalMovies} movies… 0%`,
				/* persistent until we dismiss */ 0,
				[jobAction(queued.jobId)],
			);

			// Subscribe to the existing JOB_PROGRESS / COMPLETED / FAILED
			// WS channel; gate on jobId so other jobs don't update us.
			let lastPct = 0;
			const onProgress = (data: unknown) => {
				const d = data as { id?: string; progress?: number };
				if (d?.id !== queued.jobId) return;
				const pct = Math.max(0, Math.min(100, Math.round(d.progress ?? 0)));
				if (pct === lastPct) return;
				lastPct = pct;
				if (progressToastId) {
					// Replace by removing + re-adding under the same id is
					// awkward; cheap path is to remove + add a new one.
					removeNotification(progressToastId);
					progressToastId = notifyInfo(
						`Grouping: ${pct}% (${queued.totalMovies} movies)`,
						0,
						[jobAction(queued.jobId)],
					);
				}
			};
			const onComplete = (data: unknown) => {
				const d = data as {
					id?: string;
					result?: { scanned?: number; grouped?: number; pruned?: number };
				};
				if (d?.id !== queued.jobId) return;
				if (progressToastId) {
					removeNotification(progressToastId);
					progressToastId = null;
				}
				const r = d.result ?? {};
				const pruned = r.pruned ?? 0;
				const prunedNote = pruned > 0 ? `, pruned ${pruned} single-member group(s)` : '';
				notifySuccess(
					`Grouped ${r.grouped ?? 0} of ${r.scanned ?? 0} movies${prunedNote}.`,
					undefined,
					[jobAction(queued.jobId)],
				);
				cleanup?.();
				setGroupingItems(false);
			};
			const onFailed = (data: unknown) => {
				const d = data as { id?: string; error?: string };
				if (d?.id !== queued.jobId) return;
				if (progressToastId) {
					removeNotification(progressToastId);
					progressToastId = null;
				}
				notifyError(`Grouping failed: ${d.error ?? 'unknown error'}`);
				cleanup?.();
				setGroupingItems(false);
			};
			wsService.on('job:progress', onProgress);
			wsService.on('job:completed', onComplete);
			wsService.on('job:failed', onFailed);
			cleanup = () => {
				wsService.off('job:progress', onProgress);
				wsService.off('job:completed', onComplete);
				wsService.off('job:failed', onFailed);
			};
		} catch {
			if (progressToastId) removeNotification(progressToastId);
			notifyError('Failed to start grouping');
			setGroupingItems(false);
		}
	}, []);

	const handleSanitizeTitles = useCallback(async () => {
		setSanitizingTitles(true);
		const startedId = notifyInfo('Sanitising unmatched titles…', 0);
		try {
			const result = await api.post<{
				scanned: number;
				updated: number;
				sample: Array<{ from: string; to: string }>;
			}>('/admin/sanitize-titles');
			removeNotification(startedId);
			if (result.updated > 0) {
				notifySuccess(
					`Cleaned ${result.updated} of ${result.scanned} unmatched titles. Sample: ${result.sample
						.slice(0, 2)
						.map((s) => `"${s.from}" → "${s.to}"`)
						.join(', ')}`,
				);
			} else {
				notifySuccess(`No dirty titles found among ${result.scanned} unmatched movies.`);
			}
		} catch {
			removeNotification(startedId);
			notifyError('Title sanitisation failed');
		} finally {
			setSanitizingTitles(false);
		}
	}, []);

	const handleGenerateSprites = useCallback(async () => {
		setGeneratingSprites(true);
		const startedId = notifyInfo('Looking for movies without seek sprites…', 0);
		try {
			const result = await api.post<{ movieCount: number; message: string }>(
				'/admin/generate-sprites',
			);
			removeNotification(startedId);
			if (result.movieCount === 0) {
				notifySuccess('All movies already have sprite sheets.');
				return;
			}
			notifySuccess(
				`Enqueued sprite generation for ${result.movieCount} movie${
					result.movieCount === 1 ? '' : 's'
				}.`,
				undefined,
				[jobListAction('sprite-sheet')],
			);
		} catch {
			removeNotification(startedId);
			notifyError('Failed to start sprite generation');
		} finally {
			setGeneratingSprites(false);
		}
	}, []);

	const handleRemoveBroken = useCallback(async () => {
		setRemovingBroken(true);
		const startedId = notifyInfo('Scanning for broken movies…', 0);
		try {
			const result = await api.post<{ removedCount: number; message: string }>(
				'/admin/remove-broken-movies',
			);
			removeNotification(startedId);
			if (result.removedCount > 0) {
				notifySuccess(
					`Removed ${result.removedCount} broken movie${
						result.removedCount === 1 ? '' : 's'
					}.`,
				);
				fetchMovies(1);
			} else {
				notifySuccess('No broken movies found.');
			}
		} catch {
			removeNotification(startedId);
			notifyError('Failed to remove broken movies');
		} finally {
			setRemovingBroken(false);
		}
	}, []);

	const handleClearWatched = useCallback(async () => {
		setClearingWatched(true);
		const startedId = notifyInfo('Clearing watched history…', 0);
		try {
			const result = await api.delete<{ clearedCount: number }>('/history/watched');
			removeNotification(startedId);
			notifySuccess(
				`Cleared watched status for ${result.clearedCount} movie${
					result.clearedCount === 1 ? '' : 's'
				}.`,
			);
			setWatchedMovieCount(0);
			fetchMovies(1);
		} catch {
			removeNotification(startedId);
			notifyError('Failed to clear watched history');
		} finally {
			setClearingWatched(false);
		}
	}, []);

	const handleEndSession = useCallback(async (sessionId: string) => {
		setEndingSessionId(sessionId);
		try {
			await streamService.endSession(sessionId);
			setActiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
			notifySuccess('Session ended');
		} catch {
			notifyError('Failed to end session');
		} finally {
			setEndingSessionId(null);
		}
	}, []);

	const handleEndAllSessions = useCallback(async () => {
		setEndingAll(true);
		try {
			const result = await streamService.endAllSessions();
			setActiveSessions([]);
			notifySuccess(`Ended ${result.endedCount} session(s)`);
		} catch {
			notifyError('Failed to end sessions');
		} finally {
			setEndingAll(false);
		}
	}, []);

	const handleClearSessionHistory = useCallback(async () => {
		setClearingHistory(true);
		try {
			const result = await streamService.clearSessionHistory();
			setSessionHistory((prev) => prev.filter((s) => s.isActive));
			notifySuccess(
				`Cleared ${result.clearedCount} history entries (${result.preservedCount} active preserved)`,
			);
			fetchMovies(1);
		} catch {
			notifyError('Failed to clear session history');
		} finally {
			setClearingHistory(false);
		}
	}, []);

	if (isLoading) {
		return (
			<div class={styles.loading}>
				<Spinner size="lg" />
			</div>
		);
	}

	function formatUptime(seconds: number): string {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		return `${days}d ${hours}h ${mins}m`;
	}

	return (
		<div class={styles.admin}>
			<h1 class={styles.title}>Admin Dashboard</h1>

			{/* Stats Grid */}
			{systemInfo && (
				<div class={styles.statsGrid}>
					<div class={styles.statCard}>
						<span class={styles.statLabel}>Total Movies</span>
						<span class={styles.statValue}>{systemInfo.totalMovies}</span>
					</div>
					<div class={styles.statCard}>
						<span class={styles.statLabel}>Total Users</span>
						<span class={styles.statValue}>{systemInfo.totalUsers}</span>
					</div>
					<div class={styles.statCard}>
						<span class={styles.statLabel}>Active Streams</span>
						<span class={styles.statValue}>{activeSessions.length}</span>
					</div>
					<div class={styles.statCard}>
						<span class={styles.statLabel}>Uptime</span>
						<span class={styles.statValue}>{formatUptime(systemInfo.uptime)}</span>
					</div>
					<div class={styles.statCard}>
						<span class={styles.statLabel}>Disk Usage</span>
						<span class={styles.statValue}>
							{formatBytes(systemInfo.diskUsage.used)} /{' '}
							{formatBytes(systemInfo.diskUsage.total)}
						</span>
					</div>
					<div class={styles.statCard}>
						<span class={styles.statLabel}>Version</span>
						<span class={styles.statValue}>{systemInfo.version}</span>
					</div>
				</div>
			)}

			{/* Quick Actions — collapsed by default. Native <details>
			    gives accessible disclosure without manual state. */}
			<details class={styles.collapsibleSection}>
				<summary class={styles.collapsibleSummary}>
					<h2 class={styles.sectionTitle}>Quick Actions</h2>
					<a
						class={styles.sectionLink}
						href="/admin/jobs"
						onClick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							route('/admin/jobs');
						}}
					>
						View all jobs →
					</a>
				</summary>
				<ul class={styles.actionList}>
					<ActionRow
						label="Scan Library"
						description="Index any new files in your configured media sources."
						onClick={handleScanLibrary}
					/>
					<ActionRow
						label="Refresh All Metadata"
						description="Re-fetch TMDB / OMDB metadata for every library movie."
						onClick={handleRefreshMetadata}
					/>
					<ActionRow
						label="Fetch Missing Thumbnails"
						description="Generate thumbnails for movies that don't have one yet."
						onClick={handleGenerateThumbnails}
						loading={generatingThumbnails}
					/>
					<ActionRow
						label="Fix Broken Thumbnails"
						description="Re-generate thumbnails whose file is missing on disk."
						onClick={() => setShowFixThumbnailsConfirm(true)}
						loading={fixingThumbnails}
					/>
					<ActionRow
						label="Generate Seek Sprites"
						description="Create seek-bar preview sprite sheets for movies missing them."
						onClick={handleGenerateSprites}
						loading={generatingSprites}
					/>
					<ActionRow
						label="Group Similar Items"
						description="Auto-group sequels, series, and TV episodes that share metadata."
						onClick={handleGroupSimilarItems}
						loading={groupingItems}
					/>
					<ActionRow
						label="Sanitize Title Names"
						description="Clean up filenames for movies without remote metadata (strip codec / release-group / quality tags)."
						onClick={() => setShowSanitizeConfirm(true)}
						loading={sanitizingTitles}
					/>
					<ActionRow
						label="Remove Broken Movies"
						description="Delete library rows whose source file is missing on disk."
						onClick={() => setShowRemoveBrokenConfirm(true)}
						loading={removingBroken}
						danger
					/>
					<ActionRow
						label="Clear Watched History"
						description='Reset the "watched" flag for every movie. Resume positions are preserved.'
						onClick={() => setShowClearWatchedConfirm(true)}
						loading={clearingWatched}
						danger
					/>
				</ul>
				<ConfirmDialog
					isOpen={showSanitizeConfirm}
					onClose={() => setShowSanitizeConfirm(false)}
					onConfirm={handleSanitizeTitles}
					title="Sanitize Title Names"
					message="Goes through every movie that has NO remote (TMDB) metadata and rewrites its title using the filename — stripping quality, codec, release-group, year, and bracketed metadata. TV episodes keep their SxxExx marker. Movies with refreshed metadata are untouched. Safe to re-run."
					confirmLabel="Sanitize Titles"
					variant="primary"
				/>
				<ConfirmDialog
					isOpen={showFixThumbnailsConfirm}
					onClose={() => setShowFixThumbnailsConfirm(false)}
					onConfirm={handleFixBrokenThumbnails}
					title="Fix Broken Thumbnails"
					message="This will scan all movies for missing thumbnail files on disk and regenerate them. This may take a while for large libraries."
					confirmLabel="Fix Thumbnails"
					variant="primary"
				/>
				<ConfirmDialog
					isOpen={showRemoveBrokenConfirm}
					onClose={() => setShowRemoveBrokenConfirm(false)}
					onConfirm={handleRemoveBroken}
					title="Remove Broken Movies"
					message="This will scan all movies in the library and remove any whose source files are missing from disk. Related metadata, caches, and thumbnails will also be cleaned up. This cannot be undone."
					confirmLabel="Remove Broken Movies"
					variant="danger"
				/>
				<ConfirmDialog
					isOpen={showClearWatchedConfirm}
					onClose={() => setShowClearWatchedConfirm(false)}
					onConfirm={handleClearWatched}
					title="Clear Watched History"
					message={`This will reset the "watched" status for ${watchedMovieCount} movie(s). Resume positions will be preserved. This cannot be undone.`}
					confirmLabel="Clear Watched History"
					variant="danger"
				/>
			</details>

			{/* Active Sessions */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h2 class={styles.sectionTitle}>Active Sessions</h2>
					{activeSessions.length > 0 && (
						<Button
							variant="danger"
							size="sm"
							onClick={handleEndAllSessions}
							loading={endingAll}
						>
							End All Sessions
						</Button>
					)}
				</div>
				{activeSessions.length > 0 && (
					<p class={styles.endAllNote}>
						This will end all active sessions except your current one.
					</p>
				)}
				{activeSessions.length === 0 ? (
					<p class={styles.emptyText}>No active streams</p>
				) : (
					<div class={styles.sessionList}>
						{activeSessions.map((session) => (
							<div key={session.sessionId} class={styles.sessionItem}>
								<div class={styles.sessionInfo}>
									<span class={styles.sessionUser}>
										{session.username || 'Unknown'}
									</span>
									<span class={styles.sessionMovie}>
										{session.movieTitle || 'Unknown'}
									</span>
									{session.ipAddress && (
										<span class={styles.sessionIp} title="Originating IP">
											{session.ipAddress}
										</span>
									)}
								</div>
								<span class={styles.sessionTime}>
									Started {new Date(session.startedAt).toLocaleTimeString()}
								</span>
								<Button
									variant="danger"
									size="sm"
									onClick={() => handleEndSession(session.sessionId)}
									loading={endingSessionId === session.sessionId}
								>
									End
								</Button>
							</div>
						))}
					</div>
				)}
			</section>

			{/* Session History — collapsed by default */}
			<details class={styles.collapsibleSection}>
				<summary class={styles.collapsibleSummary}>
					<h2 class={styles.sectionTitle}>
						Session History{' '}
						<span class={styles.countBadge}>{sessionHistory.length}</span>
					</h2>
					{sessionHistory.length > 0 && (
						<Button
							variant="danger"
							size="sm"
							onClick={(e: any) => {
								e?.stopPropagation?.();
								setShowClearHistoryConfirm(true);
							}}
							loading={clearingHistory}
						>
							Clear History
						</Button>
					)}
				</summary>
				{sessionHistory.length === 0 ? (
					<p class={styles.emptyText}>No session history</p>
				) : (
					<div class={styles.historyList}>
						{sessionHistory.map((entry) => (
							<div
								key={entry.id}
								class={`${styles.historyItem} ${entry.isActive ? styles.historyActive : ''}`}
							>
								<div class={styles.sessionInfo}>
									<span class={styles.sessionUser}>
										{entry.username || 'Unknown user'}
									</span>
									<span class={styles.sessionMovie}>
										{entry.movieTitle || 'Unknown movie'}
										{entry.movieYear ? ` (${entry.movieYear})` : ''}
									</span>
								</div>
								<div class={styles.historyMeta}>
									{entry.completed && (
										<span class={styles.completedBadge}>Watched</span>
									)}
									{entry.durationWatchedSeconds != null &&
										entry.durationWatchedSeconds > 0 && (
											<span class={styles.historyDuration}>
												{Math.floor(entry.durationWatchedSeconds / 60)}m
												watched
											</span>
										)}
									{entry.isActive && (
										<span class={styles.activeBadge}>Active</span>
									)}
								</div>
								<span class={styles.sessionTime}>
									{new Date(entry.watchedAt).toLocaleDateString()}{' '}
									{new Date(entry.watchedAt).toLocaleTimeString([], {
										hour: '2-digit',
										minute: '2-digit',
									})}
								</span>
							</div>
						))}
					</div>
				)}
				<ConfirmDialog
					isOpen={showClearHistoryConfirm}
					onClose={() => setShowClearHistoryConfirm(false)}
					onConfirm={handleClearSessionHistory}
					title="Clear Session History"
					message={`This will clear ${sessionHistory.filter((s) => !s.isActive).length} history entries. Entries for currently active streams will be preserved. This will also reset "watched" status and resume positions for all cleared movies. This cannot be undone.`}
					confirmLabel="Clear History"
					variant="danger"
				/>
			</details>
		</div>
	);
}

/** One row in the Quick Actions list — label left, description right,
 *  whole row clickable. Loading / danger states reuse the Button
 *  semantics inline so we don't need a separate component module. */
function ActionRow({
	label,
	description,
	onClick,
	loading,
	danger,
}: {
	label: string;
	description: string;
	onClick: () => void;
	loading?: boolean;
	danger?: boolean;
}) {
	return (
		<li class={styles.actionRow}>
			<button
				type="button"
				class={`${styles.actionRowBtn} ${danger ? styles.actionRowDanger : ''}`}
				onClick={onClick}
				disabled={loading}
			>
				<span class={styles.actionLabel}>
					{label}
					{loading ? ' …' : ''}
				</span>
				<span class={styles.actionDescription}>{description}</span>
			</button>
		</li>
	);
}

import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { groupsService } from '@/services/groups.service';
import type { ActiveSession, SessionHistoryEntry } from '@/services/stream.service';
import { streamService } from '@/services/stream.service';
import { fetchMovies } from '@/state/library.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
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
		try {
			await api.post('/sources/scan');
			notifySuccess('Library scan started');
		} catch {
			notifyError('Failed to start library scan');
		}
	}, []);

	const handleRefreshMetadata = useCallback(async () => {
		try {
			await api.post('/movies/refresh-all');
			notifySuccess('Metadata refresh started for all movies');
		} catch {
			notifyError('Failed to start metadata refresh');
		}
	}, []);

	const handleGenerateThumbnails = useCallback(async () => {
		setGeneratingThumbnails(true);
		try {
			const result = await streamService.generateMissingThumbnails();
			notifySuccess(`Thumbnail generation started for ${result.movieCount} movies`);
		} catch {
			notifyError('Failed to start thumbnail generation');
		} finally {
			setGeneratingThumbnails(false);
		}
	}, []);

	const handleFixBrokenThumbnails = useCallback(async () => {
		setFixingThumbnails(true);
		try {
			const result = await api.post<{ movieCount: number; message: string }>(
				'/admin/fix-broken-thumbnails',
			);
			if (result.movieCount > 0) {
				notifySuccess(`Regenerating ${result.movieCount} broken thumbnail(s)`);
			} else {
				notifySuccess('No broken thumbnails found');
			}
		} catch {
			notifyError('Failed to fix broken thumbnails');
		} finally {
			setFixingThumbnails(false);
		}
	}, []);

	const handleGroupSimilarItems = useCallback(async () => {
		setGroupingItems(true);
		try {
			const result = await groupsService.rebuild();
			const prunedNote =
				typeof result.pruned === 'number' && result.pruned > 0
					? `, pruned ${result.pruned} single-member group(s)`
					: '';
			notifySuccess(
				`Grouped ${result.grouped} of ${result.scanned} movies${prunedNote}. Open any item's group page to review.`,
			);
		} catch {
			notifyError('Group detection failed');
		} finally {
			setGroupingItems(false);
		}
	}, []);

	const handleSanitizeTitles = useCallback(async () => {
		setSanitizingTitles(true);
		try {
			const result = await api.post<{
				scanned: number;
				updated: number;
				sample: Array<{ from: string; to: string }>;
			}>('/admin/sanitize-titles');
			if (result.updated > 0) {
				notifySuccess(
					`Cleaned ${result.updated} of ${result.scanned} unmatched titles. Sample: ${result.sample
						.slice(0, 2)
						.map((s) => `"${s.from}" → "${s.to}"`)
						.join(', ')}`,
				);
			} else {
				notifySuccess(
					`No dirty titles found among ${result.scanned} unmatched movies.`,
				);
			}
		} catch {
			notifyError('Title sanitisation failed');
		} finally {
			setSanitizingTitles(false);
		}
	}, []);

	const handleGenerateSprites = useCallback(async () => {
		setGeneratingSprites(true);
		try {
			const result = await api.post<{ movieCount: number; message: string }>(
				'/admin/generate-sprites',
			);
			if (result.movieCount > 0) {
				notifySuccess(`Enqueued sprite generation for ${result.movieCount} movies`);
			} else {
				notifySuccess('All movies already have sprite sheets');
			}
		} catch {
			notifyError('Failed to start sprite generation');
		} finally {
			setGeneratingSprites(false);
		}
	}, []);

	const handleRemoveBroken = useCallback(async () => {
		setRemovingBroken(true);
		try {
			const result = await api.post<{ removedCount: number; message: string }>(
				'/admin/remove-broken-movies',
			);
			if (result.removedCount > 0) {
				notifySuccess(`Removed ${result.removedCount} broken movie(s)`);
				// Refresh library state so the list is up to date
				fetchMovies(1);
			} else {
				notifySuccess('No broken movies found');
			}
		} catch {
			notifyError('Failed to remove broken movies');
		} finally {
			setRemovingBroken(false);
		}
	}, []);

	const handleClearWatched = useCallback(async () => {
		setClearingWatched(true);
		try {
			const result = await api.delete<{ clearedCount: number }>('/history/watched');
			notifySuccess(`Cleared watched status for ${result.clearedCount} movie(s)`);
			setWatchedMovieCount(0);
			fetchMovies(1);
		} catch {
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

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / 1024 ** i).toFixed(1)} ${sizes[i]}`;
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

			{/* Quick Actions */}
			<section class={styles.section}>
				<h2 class={styles.sectionTitle}>Quick Actions</h2>
				<div class={styles.actions}>
					<Button variant="secondary" onClick={handleScanLibrary}>
						Scan Library
					</Button>
					<Button variant="secondary" onClick={handleRefreshMetadata}>
						Refresh All Metadata
					</Button>
					<Button
						variant="secondary"
						onClick={handleGenerateThumbnails}
						loading={generatingThumbnails}
					>
						Fetch Missing Thumbnails
					</Button>
					<Button
						variant="secondary"
						onClick={() => setShowFixThumbnailsConfirm(true)}
						loading={fixingThumbnails}
					>
						Fix Broken Thumbnails
					</Button>
					<Button
						variant="secondary"
						onClick={handleGenerateSprites}
						loading={generatingSprites}
					>
						Generate Seek Sprites
					</Button>
					<Button
						variant="danger"
						onClick={() => setShowRemoveBrokenConfirm(true)}
						loading={removingBroken}
					>
						Remove Broken Movies
					</Button>
					<Button
						variant="danger"
						onClick={() => setShowClearWatchedConfirm(true)}
						loading={clearingWatched}
					>
						Clear Watched History
					</Button>
					<Button
						variant="secondary"
						onClick={handleGroupSimilarItems}
						loading={groupingItems}
					>
						Group Similar Items
					</Button>
					<Button
						variant="secondary"
						onClick={() => setShowSanitizeConfirm(true)}
						loading={sanitizingTitles}
					>
						Sanitize Title Names
					</Button>
				</div>
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
			</section>

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

			{/* Session History */}
			<section class={styles.section}>
				<div class={styles.sectionHeader}>
					<h2 class={styles.sectionTitle}>
						Session History{' '}
						<span class={styles.countBadge}>{sessionHistory.length}</span>
					</h2>
					{sessionHistory.length > 0 && (
						<Button
							variant="danger"
							size="sm"
							onClick={() => setShowClearHistoryConfirm(true)}
							loading={clearingHistory}
						>
							Clear History
						</Button>
					)}
				</div>
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
			</section>
		</div>
	);
}

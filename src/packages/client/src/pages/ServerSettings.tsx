import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './ServerSettings.module.scss';

// ============================================
// Collapsible Section
// ============================================

function Section({
	title,
	defaultOpen = false,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: any;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div class={styles.section}>
			<button class={styles.sectionHeader} onClick={() => setOpen(!open)}>
				<h3 class={styles.sectionTitle}>{title}</h3>
				<span class={styles.sectionArrow}>{open ? '\u25B2' : '\u25BC'}</span>
			</button>
			{open && <div class={styles.sectionContent}>{children}</div>}
		</div>
	);
}

// ============================================
// Helpers
// ============================================

function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const parts = [];
	if (d > 0) parts.push(`${d}d`);
	if (h > 0) parts.push(`${h}h`);
	parts.push(`${m}m`);
	return parts.join(' ');
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}

// ============================================
// Server Info Section
// ============================================

function ServerInfoSection() {
	const [info, setInfo] = useState<any>(null);
	const [loading, setLoading] = useState(true);
	const [restarting, setRestarting] = useState(false);
	const [recycling, setRecycling] = useState(false);
	const [showRestartConfirm, setShowRestartConfirm] = useState(false);

	const loadInfo = useCallback(async () => {
		try {
			const data = await api.get('/admin/server/info');
			setInfo(data);
		} catch {
			notifyError('Failed to load server info');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadInfo();
	}, []);

	const handleRestart = useCallback(async () => {
		setRestarting(true);
		setShowRestartConfirm(false);
		try {
			await api.post('/admin/server/restart');
			notifySuccess('Server restarting...');
		} catch {
			notifyError('Failed to restart server');
			setRestarting(false);
		}
	}, []);

	const handleRecycle = useCallback(async () => {
		setRecycling(true);
		notifySuccess('Recycling hardware encoder…');
		try {
			const res = await api.post<{
				ok: boolean;
				message: string;
				actions: string[];
				probeStderr?: string;
			}>('/admin/server/encoder/recycle');
			if (res.ok) {
				notifySuccess(res.message || 'Hardware encoder recycled successfully');
			} else {
				const detail = res.probeStderr
					? `${res.message} — ${res.probeStderr.split('\n').pop()?.trim() ?? ''}`
					: res.message || 'Hardware encoder recycle failed';
				notifyError(detail);
			}
			await loadInfo();
		} catch (err: any) {
			notifyError(err?.message || 'Failed to recycle hardware encoder');
		} finally {
			setRecycling(false);
		}
	}, [loadInfo]);

	if (loading) return <Spinner size="sm" />;
	if (!info) return <div class={styles.emptyText}>Unable to load server info</div>;

	return (
		<div class={styles.infoGrid}>
			<div class={styles.uptimeBanner}>
				<div class={styles.uptimeIcon}>
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10" />
						<polyline points="12 6 12 12 16 14" />
					</svg>
				</div>
				<div class={styles.uptimeContent}>
					<span class={styles.uptimeLabel}>Server Uptime</span>
					<span class={styles.uptimeValue}>{formatUptime(info.uptime)}</span>
				</div>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Platform</span>
				<span class={styles.infoValue}>
					{info.platform} ({info.arch})
				</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Node.js</span>
				<span class={styles.infoValue}>{info.nodeVersion}</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>CPU</span>
				<span class={styles.infoValue}>
					{info.cpuModel} ({info.cpuCores} cores)
				</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Memory</span>
				<span class={styles.infoValue}>
					{formatBytes(info.totalMemory - info.freeMemory)} /{' '}
					{formatBytes(info.totalMemory)} used
				</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>App Memory</span>
				<span class={styles.infoValue}>{formatBytes(info.processMemory?.rss ?? 0)}</span>
			</div>
			{info.gpu && (
				<>
					<div class={styles.infoRow}>
						<span class={styles.infoLabel}>GPU</span>
						<span class={styles.infoValue}>{info.gpu.name}</span>
					</div>
					<div class={styles.infoRow}>
						<span class={styles.infoLabel}>GPU Memory</span>
						<span class={styles.infoValue}>
							{info.gpu.memoryUsed} / {info.gpu.memoryTotal}
						</span>
					</div>
					<div class={styles.infoRow}>
						<span class={styles.infoLabel}>GPU Utilization</span>
						<span class={styles.infoValue}>{info.gpu.utilization}</span>
					</div>
				</>
			)}
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>HW Accel</span>
				<span class={styles.infoValue}>
					{info.hwAccel}
					{info.hwAccelBroken ? ' (broken — using software)' : ''}
					{info.hwAccelBroken && (
						<button
							class={styles.recycleBtn}
							onClick={handleRecycle}
							title={recycling ? 'Recycling…' : 'Recycle hardware encoder'}
							disabled={recycling}
						>
							{recycling ? (
								<span class={styles.jobRetrySpinner} />
							) : (
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="23 4 23 10 17 10" />
									<polyline points="1 20 1 14 7 14" />
									<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
									<path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
								</svg>
							)}
							<span class={styles.recycleBtnLabel}>Recycle</span>
						</button>
					)}
				</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Encoding</span>
				<span class={styles.infoValue}>
					{info.encoding.quality}, {info.encoding.preset}, {info.encoding.rateControl}
				</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Active Transcodes</span>
				<span class={styles.infoValue}>{info.activeTranscodes}</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>PID</span>
				<span class={styles.infoValue}>{info.pid}</span>
			</div>

			<div class={styles.actions}>
				<Button
					variant="secondary"
					onClick={() => setShowRestartConfirm(true)}
					loading={restarting}
				>
					Restart Server
				</Button>
			</div>

			<ConfirmDialog
				isOpen={showRestartConfirm}
				onClose={() => setShowRestartConfirm(false)}
				onConfirm={handleRestart}
				title="Restart Server?"
				message="This will stop all active streams and transcoding jobs. The server will restart in a few seconds."
				confirmLabel="Restart"
				variant="primary"
			/>
		</div>
	);
}

// ============================================
// Statistics Section
// ============================================

function meterColor(ratio: number): string {
	if (ratio < 0.6) return 'var(--color-accent, #4caf50)';
	if (ratio < 0.85) return '#ff9800';
	return '#f44336';
}

function StatsSection() {
	const [stats, setStats] = useState<any>(null);

	useEffect(() => {
		const load = async () => {
			try {
				const data = await api.get('/health/stats');
				setStats(data);
			} catch {}
		};
		load();
		const interval = setInterval(load, 5000);
		return () => clearInterval(interval);
	}, []);

	if (!stats) return <Spinner size="sm" />;

	const sys = stats.system;
	const svc = stats.services;
	const cpuRatio = Math.min(sys.loadAvg[0] / sys.cpuCount, 1);
	const memTotal = sys.memoryTotal || 1;
	const memUsed = sys.memoryTotal - sys.memoryFree;
	const memRatio = memUsed / memTotal;
	const appMem = sys.appMemory?.total ?? 0;
	const appMemRatio = appMem / memTotal;

	return (
		<div class={styles.statsGrid}>
			{/* CPU */}
			<div class={styles.statCard}>
				<div class={styles.statCardHeader}>
					<span class={styles.statLabel}>CPU Load</span>
					<span class={styles.statValue}>
						{sys.loadAvg[0].toFixed(2)} / {sys.cpuCount}
					</span>
				</div>
				<div class={styles.statBar}>
					<div
						class={styles.statBarFill}
						style={{ width: `${cpuRatio * 100}%`, background: meterColor(cpuRatio) }}
					/>
				</div>
			</div>

			{/* Memory */}
			<div class={styles.statCard}>
				<div class={styles.statCardHeader}>
					<span class={styles.statLabel}>Memory</span>
				</div>
				<div class={styles.statSegments}>
					<span class={styles.statSegment}>App: {formatBytes(appMem)}</span>
					<span class={styles.statSegment}>System: {formatBytes(memUsed)}</span>
					<span class={styles.statSegment}>Total: {formatBytes(memTotal)}</span>
				</div>
				<div class={styles.statBar}>
					<div
						class={styles.statBarFill}
						style={{ width: `${memRatio * 100}%`, background: meterColor(memRatio) }}
					/>
					<div
						class={`${styles.statBarFill} ${styles.statBarOverlay}`}
						style={{ width: `${Math.max(appMemRatio * 100, 0.5)}%` }}
					/>
				</div>
			</div>

			{/* Disk */}
			{sys.diskTotal > 0 &&
				(() => {
					const diskTotal = sys.diskTotal || 1;
					const diskUsed = diskTotal - sys.diskFree;
					const diskRatio = diskUsed / diskTotal;
					const appSize = sys.dataDirSize || 0;
					const appDiskRatio = appSize / diskTotal;
					return (
						<div class={styles.statCard}>
							<div class={styles.statCardHeader}>
								<span class={styles.statLabel}>Disk</span>
							</div>
							<div class={styles.statSegments}>
								<span class={styles.statSegment}>App: {formatBytes(appSize)}</span>
								<span class={styles.statSegment}>
									Used: {formatBytes(diskUsed)}
								</span>
								<span class={styles.statSegment}>
									Total: {formatBytes(diskTotal)}
								</span>
							</div>
							<div class={styles.statBar}>
								<div
									class={styles.statBarFill}
									style={{
										width: `${diskRatio * 100}%`,
										background: meterColor(diskRatio),
									}}
								/>
								<div
									class={`${styles.statBarFill} ${styles.statBarOverlay}`}
									style={{ width: `${Math.max(appDiskRatio * 100, 0.5)}%` }}
								/>
							</div>
						</div>
					);
				})()}

			{/* Library */}
			<div class={styles.statCard}>
				<div class={styles.statLabel}>Library</div>
				<div class={styles.statValue}>
					{stats.library?.movieCount ?? 0} movies, {stats.library?.fileCount ?? 0} files
				</div>
			</div>

			{/* Services */}
			{svc && (
				<div class={styles.statCard}>
					<div class={styles.statLabel}>Activity</div>
					<div class={styles.statValue}>
						{svc.activeStreams ?? 0} streams, {svc.activeTranscodes ?? 0} transcodes,{' '}
						{svc.runningJobs ?? 0} running / {svc.pendingJobs ?? 0} pending jobs
					</div>
				</div>
			)}
		</div>
	);
}

// ============================================
// Jobs Section
// ============================================

function JobsSection() {
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
	const lastSelectedRef = useRef<string | null>(null);

	useEffect(() => {
		const load = async () => {
			try {
				if (tab === 'current') {
					const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
					setCurrentJobs(data.jobs);
				} else {
					const data = await api.get<{ jobs: any[] }>(
						'/admin/server/jobs/history?limit=50',
					);
					setHistoryJobs(data.jobs);
				}
			} catch {}
		};
		load();
		const interval = tab === 'current' ? setInterval(load, 3000) : null;
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [tab]);

	// Clear selection when switching tabs
	useEffect(() => setSelected(new Set()), [tab]);

	const handleAction = useCallback(async (id: string, action: string) => {
		try {
			await api.post(`/admin/server/jobs/${id}/${action}`);
			const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
			setCurrentJobs(data.jobs);
		} catch {
			notifyError(`Failed to ${action} job`);
		}
	}, []);

	/**
	 * Retry a failed/completed job. Most failed jobs live in the
	 * `job_history` table (not the in-memory queue), so the server's
	 * retry endpoint may report a structured reason ("Job not found",
	 * "No handler registered", etc.) we surface inline. Tracks the
	 * in-flight retry id locally so the row's icon button can show a
	 * spinner instead of looking dead.
	 */
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
				// Refresh both lists so the new job shows up in current
				// and the original entry's status (if any) updates in history.
				try {
					const [current, history] = await Promise.all([
						api.get<{ jobs: any[] }>('/admin/server/jobs'),
						api.get<{ jobs: any[] }>('/admin/server/jobs/history?limit=50'),
					]);
					setCurrentJobs(current.jobs);
					setHistoryJobs(history.jobs);
				} catch {
					/* ignore — next poll tick will catch up */
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

	const statusColors: Record<string, string> = {
		running: '#22c55e',
		pending: '#f59e0b',
		completed: '#06b6d4',
		failed: '#ef4444',
		paused: '#8b5cf6',
		cancelled: '#6b7280',
	};

	// Filter jobs
	const jobs = tab === 'current' ? currentJobs : historyJobs;
	const q = searchQuery.toLowerCase().trim();
	const filtered = q
		? jobs.filter(
				(job) =>
					(job.label || '').toLowerCase().includes(q) ||
					(job.type || '').toLowerCase().includes(q) ||
					(job.payload?.filePath || '').toLowerCase().includes(q),
			)
		: jobs;

	return (
		<div class={styles.jobsContainer}>
			{/* Sticky toolbar: tabs + search + bulk actions */}
			<div class={styles.jobsToolbar}>
				<div class={styles.jobsToolbarTop}>
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
							History
						</button>
					</div>
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
				</div>
				<div class={styles.jobsSearchRow}>
					<div class={styles.jobsSearchWrap}>
						<svg
							class={styles.jobsSearchIcon}
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
							class={styles.jobsSearchInput}
							placeholder="Search jobs..."
							value={searchQuery}
							onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
						/>
						{searchQuery && (
							<button
								class={styles.jobsSearchClear}
								onClick={() => setSearchQuery('')}
								title="Clear search"
							>
								x
							</button>
						)}
					</div>
					<span class={styles.jobsCount}>
						{filtered.length} job{filtered.length !== 1 ? 's' : ''}
					</span>
				</div>
			</div>

			{/* Job list */}
			<div class={styles.jobList}>
				{filtered.length === 0 ? (
					<div class={styles.emptyText}>
						{q
							? `No jobs matching "${searchQuery}"`
							: `No ${tab === 'current' ? 'active' : 'historical'} jobs`}
					</div>
				) : (
					filtered.map((job) => {
						const isCancellable =
							job.status === 'running' ||
							job.status === 'pending' ||
							job.status === 'paused';
						const isSelected = selected.has(job.id);
						return (
							<div
								key={job.id}
								class={`${styles.jobItem} ${isSelected ? styles.jobItemSelected : ''}`}
								onClick={(e: MouseEvent) => {
									if (tab !== 'current' || !isCancellable) return;
									const next = new Set(selected);

									if (e.shiftKey && lastSelectedRef.current) {
										// Shift-click: select range from last selected to current
										const lastIdx = filtered.findIndex(
											(j) => j.id === lastSelectedRef.current,
										);
										const curIdx = filtered.findIndex((j) => j.id === job.id);
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
										// Normal click: toggle single item
										if (next.has(job.id)) next.delete(job.id);
										else next.add(job.id);
									}

									lastSelectedRef.current = job.id;
									setSelected(next);
								}}
							>
								<div class={styles.jobHeader}>
									<span class={styles.jobType}>{job.type}</span>
									<span
										class={styles.statusBadge}
										style={{
											background: statusColors[job.status] || '#6b7280',
										}}
									>
										{job.status}
									</span>
									<span class={styles.jobLabel}>{job.label}</span>
									{job.progress > 0 && job.progress < 100 && (
										<span class={styles.jobProgress}>
											{job.progress.toFixed(0)}%
										</span>
									)}
									{(job.startedAt || job.createdAt) && (
										<span class={styles.jobTime}>
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
											class={styles.jobRetryBtn}
											onClick={(e: Event) => {
												e.stopPropagation();
												handleRetry(job.id);
											}}
											title={retryingIds.has(job.id) ? 'Retrying…' : 'Retry'}
											disabled={retryingIds.has(job.id)}
										>
											{retryingIds.has(job.id) ? (
												<span class={styles.jobRetrySpinner} />
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
										class={styles.jobDetailsBtn}
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
									<div class={styles.jobProgressBar}>
										<div
											class={styles.jobProgressFill}
											style={{ width: `${job.progress}%` }}
										/>
									</div>
								)}
								{expandedJob === job.id && (
									<div class={styles.jobDetails}>
										<div class={styles.infoRow}>
											<span class={styles.infoLabel}>ID</span>
											{job.payload?.movieId ? (
												<a
													class={`${styles.infoValue} ${styles.infoLink}`}
													href={`/movie/${job.payload.movieId}`}
													onClick={(e: Event) => {
														e.preventDefault();
														route(`/movie/${job.payload.movieId}`);
													}}
												>
													{job.id}
												</a>
											) : (
												<span class={styles.infoValue}>{job.id}</span>
											)}
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
											<div class={styles.jobActions}>
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

// ============================================
// Logs Section
// ============================================

function LogsSection() {
	const [logFile, setLogFile] = useState('server');
	const [lines, setLines] = useState('200');
	const [content, setContent] = useState('');
	const [loading, setLoading] = useState(false);
	const [logSize, setLogSize] = useState(0);

	const loadLogs = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api.get<{ content: string; sizeBytes: number }>(
				`/admin/server/logs?file=${logFile}&lines=${lines}`,
			);
			setContent(data.content);
			setLogSize(data.sizeBytes);
		} catch {
			notifyError('Failed to load logs');
		} finally {
			setLoading(false);
		}
	}, [logFile, lines]);

	useEffect(() => {
		loadLogs();
	}, [logFile, lines]);

	const copyToClipboard = useCallback(() => {
		navigator.clipboard.writeText(content).then(() => {
			notifySuccess('Copied to clipboard');
		});
	}, [content]);

	return (
		<div>
			<div class={styles.logsToolbar}>
				<select
					class={styles.select}
					value={logFile}
					onChange={(e) => setLogFile((e.target as HTMLSelectElement).value)}
				>
					<option value="server">server.log</option>
					<option value="transcode-debug">transcode-debug.log</option>
				</select>
				<select
					class={styles.select}
					value={lines}
					onChange={(e) => setLines((e.target as HTMLSelectElement).value)}
				>
					<option value="100">100 lines</option>
					<option value="200">200 lines</option>
					<option value="500">500 lines</option>
					<option value="1000">1000 lines</option>
				</select>
				<span class={styles.logSize}>{formatBytes(logSize)}</span>
				<div class={styles.logsActions}>
					<Button variant="ghost" size="sm" onClick={loadLogs} loading={loading}>
						Refresh
					</Button>
					<Button variant="ghost" size="sm" onClick={copyToClipboard}>
						Copy
					</Button>
				</div>
			</div>
			<pre class={styles.logOutput}>{content || 'No log content'}</pre>
		</div>
	);
}

// ============================================
// Main Export
// ============================================

export function ServerSettings() {
	return (
		<div class={styles.container}>
			<Section title="Server Info" defaultOpen>
				<ServerInfoSection />
			</Section>
			<Section title="Statistics">
				<StatsSection />
			</Section>
			<Section title="Jobs">
				<JobsSection />
			</Section>
			<Section title="Logs">
				<LogsSection />
			</Section>
		</div>
	);
}

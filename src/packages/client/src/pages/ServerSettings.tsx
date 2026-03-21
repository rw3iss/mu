import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
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

	if (loading) return <Spinner size="sm" />;
	if (!info) return <div class={styles.emptyText}>Unable to load server info</div>;

	return (
		<div class={styles.infoGrid}>
			<div class={styles.uptimeBanner}>
				<div class={styles.uptimeIcon}>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
				<span class={styles.infoValue}>{info.platform} ({info.arch})</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Node.js</span>
				<span class={styles.infoValue}>{info.nodeVersion}</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>CPU</span>
				<span class={styles.infoValue}>{info.cpuModel} ({info.cpuCores} cores)</span>
			</div>
			<div class={styles.infoRow}>
				<span class={styles.infoLabel}>Memory</span>
				<span class={styles.infoValue}>
					{formatBytes(info.totalMemory - info.freeMemory)} / {formatBytes(info.totalMemory)} used
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
						<span class={styles.infoValue}>{info.gpu.memoryUsed} / {info.gpu.memoryTotal}</span>
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
					{info.hwAccel}{info.hwAccelBroken ? ' (broken — using software)' : ''}
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

			{showRestartConfirm && (
				<div class={styles.confirmOverlay}>
					<div class={styles.confirmModal}>
						<p class={styles.confirmTitle}>Restart Server?</p>
						<p class={styles.confirmDetail}>
							This will stop all active streams and transcoding jobs.
							The server will restart in a few seconds.
						</p>
						<div class={styles.confirmActions}>
							<Button variant="ghost" onClick={() => setShowRestartConfirm(false)}>
								Cancel
							</Button>
							<Button variant="primary" onClick={handleRestart}>
								Restart
							</Button>
						</div>
					</div>
				</div>
			)}
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
					<span class={styles.statValue}>{sys.loadAvg[0].toFixed(2)} / {sys.cpuCount}</span>
				</div>
				<div class={styles.statBar}>
					<div class={styles.statBarFill} style={{ width: `${cpuRatio * 100}%`, background: meterColor(cpuRatio) }} />
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
					<div class={styles.statBarFill} style={{ width: `${memRatio * 100}%`, background: meterColor(memRatio) }} />
					<div class={`${styles.statBarFill} ${styles.statBarOverlay}`} style={{ width: `${Math.max(appMemRatio * 100, 0.5)}%` }} />
				</div>
			</div>

			{/* Disk */}
			{sys.diskTotal > 0 && (() => {
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
							<span class={styles.statSegment}>Used: {formatBytes(diskUsed)}</span>
							<span class={styles.statSegment}>Total: {formatBytes(diskTotal)}</span>
						</div>
						<div class={styles.statBar}>
							<div class={styles.statBarFill} style={{ width: `${diskRatio * 100}%`, background: meterColor(diskRatio) }} />
							<div class={`${styles.statBarFill} ${styles.statBarOverlay}`} style={{ width: `${Math.max(appDiskRatio * 100, 0.5)}%` }} />
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
						{svc.activeStreams ?? 0} streams, {svc.activeTranscodes ?? 0} transcodes, {svc.runningJobs ?? 0} running / {svc.pendingJobs ?? 0} pending jobs
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

	useEffect(() => {
		const load = async () => {
			try {
				if (tab === 'current') {
					const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
					setCurrentJobs(data.jobs);
				} else {
					const data = await api.get<{ jobs: any[] }>('/admin/server/jobs/history?limit=50');
					setHistoryJobs(data.jobs);
				}
			} catch {}
		};
		load();
		const interval = tab === 'current' ? setInterval(load, 3000) : null;
		return () => { if (interval) clearInterval(interval); };
	}, [tab]);

	const handleAction = useCallback(async (id: string, action: string) => {
		try {
			await api.post(`/admin/server/jobs/${id}/${action}`);
			// Refresh
			const data = await api.get<{ jobs: any[] }>('/admin/server/jobs');
			setCurrentJobs(data.jobs);
		} catch {
			notifyError(`Failed to ${action} job`);
		}
	}, []);

	const statusBadge = (status: string) => {
		const colors: Record<string, string> = {
			running: '#22c55e',
			pending: '#f59e0b',
			completed: '#06b6d4',
			failed: '#ef4444',
			paused: '#8b5cf6',
			cancelled: '#6b7280',
		};
		return (
			<span
				class={styles.statusBadge}
				style={{ background: colors[status] || '#6b7280' }}
			>
				{status}
			</span>
		);
	};

	return (
		<div>
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

			<div class={styles.jobList}>
				{(tab === 'current' ? currentJobs : historyJobs).length === 0 ? (
					<div class={styles.emptyText}>No {tab === 'current' ? 'active' : 'historical'} jobs</div>
				) : (
					(tab === 'current' ? currentJobs : historyJobs).map((job) => (
						<div
							key={job.id}
							class={styles.jobItem}
							onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
						>
							<div class={styles.jobHeader}>
								<span class={styles.jobType}>{job.type}</span>
								{statusBadge(job.status)}
								<span class={styles.jobLabel}>{job.label}</span>
								{job.progress > 0 && job.progress < 100 && (
									<span class={styles.jobProgress}>{job.progress.toFixed(0)}%</span>
								)}
								{(job.startedAt || job.createdAt) && (
									<span class={styles.jobTime}>
										{new Date(job.startedAt || job.createdAt).toLocaleString(undefined, {
											month: 'short', day: 'numeric',
											hour: '2-digit', minute: '2-digit',
										})}
									</span>
								)}
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
										<span class={styles.infoValue}>{job.id}</span>
									</div>
									{job.payload?.filePath && (
										<div class={styles.infoRow}>
											<span class={styles.infoLabel}>File</span>
											<span class={styles.infoValue}>{job.payload.filePath}</span>
										</div>
									)}
									{job.payload?.quality && (
										<div class={styles.infoRow}>
											<span class={styles.infoLabel}>Quality</span>
											<span class={styles.infoValue}>{job.payload.quality}</span>
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
											<span class={styles.infoValue}>{formatDuration(job.durationMs)}</span>
										</div>
									)}
									{job.error && (
										<div class={styles.infoRow}>
											<span class={styles.infoLabel}>Error</span>
											<span class={`${styles.infoValue} ${styles.errorText}`}>{job.error}</span>
										</div>
									)}
									{tab === 'current' && (
										<div class={styles.jobActions}>
											{job.status === 'running' && (
												<Button variant="ghost" size="sm" onClick={(e: Event) => { e.stopPropagation(); handleAction(job.id, 'pause'); }}>
													Pause
												</Button>
											)}
											{job.status === 'paused' && (
												<Button variant="ghost" size="sm" onClick={(e: Event) => { e.stopPropagation(); handleAction(job.id, 'resume'); }}>
													Resume
												</Button>
											)}
											{(job.status === 'running' || job.status === 'pending' || job.status === 'paused') && (
												<Button variant="ghost" size="sm" onClick={(e: Event) => { e.stopPropagation(); handleAction(job.id, 'cancel'); }}>
													Cancel
												</Button>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					))
				)}
			</div>
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

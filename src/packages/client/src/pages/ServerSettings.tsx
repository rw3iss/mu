import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
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
				<span class={styles.sectionArrow}>
					<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
				</span>
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
		notifySuccess('Restarting hardware encoder…');
		try {
			const res = await api.post<{
				ok: boolean;
				message: string;
				actions: string[];
				probeStderr?: string;
			}>('/admin/server/encoder/recycle');
			if (res.ok) {
				notifySuccess(res.message || 'Hardware encoder restarted successfully');
			} else {
				const detail = res.probeStderr
					? `${res.message} — ${res.probeStderr.split('\n').pop()?.trim() ?? ''}`
					: res.message || 'Hardware encoder restart failed';
				notifyError(detail);
			}
			await loadInfo();
		} catch (err: any) {
			notifyError(err?.message || 'Failed to restart hardware encoder');
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
							title={recycling ? 'Restarting…' : 'Restart hardware encoder'}
							disabled={recycling}
						>
							{recycling ? (
								<span class={styles.recycleSpinner} />
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
							<span class={styles.recycleBtnLabel}>Restart</span>
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
				<Select
					value={logFile}
					onChange={setLogFile}
					options={[
						{ value: 'server', label: 'server.log' },
						{ value: 'transcode-debug', label: 'transcode-debug.log' },
					]}
				/>
				<Select
					value={lines}
					onChange={setLines}
					options={[
						{ value: '100', label: '100 lines' },
						{ value: '200', label: '200 lines' },
						{ value: '500', label: '500 lines' },
						{ value: '1000', label: '1000 lines' },
					]}
				/>
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
			<Section title="Server Info">
				<ServerInfoSection />
			</Section>
			<Section title="Statistics">
				<StatsSection />
			</Section>
			<Section title="Logs">
				<LogsSection />
			</Section>
		</div>
	);
}

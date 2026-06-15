import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Icon } from '@/components/common/Icon';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { api } from '@/services/api';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { copyToClipboard as writeClipboard } from '@/utils/clipboard';
import { formatBytes } from '@/utils/format-bytes';
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

interface DiskRowData {
	root: string;
	label: string;
	total: number | null;
	free: number | null;
	isAppDrive: boolean;
	appUsedBytes: number | null;
	isCacheDrive?: boolean;
	cacheUsedBytes?: number | null;
	mediaUsedBytes: number;
	mediaSourcePaths: string[];
}

/**
 * One row per physical drive. Bar width is always 100% (= total disk).
 * Layered fills, back to front:
 *   - used-by-other:  total grey background fill (the rest of "used")
 *   - app-data:       red-ish overlay sized to dataDirSize (app drive only)
 *   - media:          accent-coloured overlay sized to media sources on
 *                     this drive (every drive that has any)
 * Hover reveals a tooltip with the precise breakdown.
 */
function DiskRow({ disk }: { disk: DiskRowData }) {
	const total = disk.total ?? 0;
	const free = disk.free ?? 0;
	const known = total > 0;
	const used = known ? total - free : 0;
	const usedRatio = known ? used / total : 0;
	const mediaRatio = known ? Math.min(disk.mediaUsedBytes / total, 1) : 0;
	const appRatio =
		known && disk.appUsedBytes != null ? Math.min(disk.appUsedBytes / total, 1) : 0;
	const cacheRatio =
		known && disk.cacheUsedBytes != null ? Math.min(disk.cacheUsedBytes / total, 1) : 0;
	const measuring = disk.isAppDrive && disk.appUsedBytes == null;

	return (
		<div class={styles.diskRow}>
			<div class={styles.diskRowHeader}>
				<span class={styles.diskRowLabel}>{disk.label}</span>
				<span class={styles.diskRowUsage}>
					{known ? (
						<>
							{formatBytes(used)} / {formatBytes(total)}
						</>
					) : (
						'unavailable'
					)}
				</span>
			</div>
			<div class={styles.diskRowBar}>
				{/* Background = total (full width); inner fills layer on top */}
				<div
					class={styles.diskRowUsedFill}
					style={{
						width: `${usedRatio * 100}%`,
						background: meterColor(usedRatio),
					}}
				/>
				{mediaRatio > 0 && (
					<div
						class={`${styles.diskRowOverlay} ${styles.diskRowMedia}`}
						style={{ width: `${Math.max(mediaRatio * 100, 0.5)}%` }}
					/>
				)}
				{appRatio > 0 && (
					<div
						class={`${styles.diskRowOverlay} ${styles.diskRowApp}`}
						style={{ width: `${Math.max(appRatio * 100, 0.5)}%` }}
					/>
				)}
				{cacheRatio > 0 && (
					<div
						class={`${styles.diskRowOverlay} ${styles.diskRowCache}`}
						style={{ width: `${Math.max(cacheRatio * 100, 0.5)}%` }}
					/>
				)}
				{/* Hover tooltip — pure CSS, only opens on bar hover */}
				<div class={styles.diskTooltip} role="tooltip">
					<div class={styles.diskTooltipRoot}>{disk.root}</div>
					<dl class={styles.diskTooltipDl}>
						<dt>Total</dt>
						<dd>{known ? formatBytes(total) : '—'}</dd>
						<dt>Used</dt>
						<dd>{known ? formatBytes(used) : '—'}</dd>
						<dt>Free</dt>
						<dd>{known ? formatBytes(free) : '—'}</dd>
						{disk.isAppDrive && (
							<>
								<dt>App data</dt>
								<dd>
									{measuring ? 'measuring…' : formatBytes(disk.appUsedBytes ?? 0)}
								</dd>
							</>
						)}
						{disk.isCacheDrive && disk.cacheUsedBytes != null && (
							<>
								<dt>Cache</dt>
								<dd>{formatBytes(disk.cacheUsedBytes)}</dd>
							</>
						)}
						{known && (
							<>
								<dt>Other</dt>
								<dd>
									{formatBytes(
										Math.max(
											0,
											used -
												disk.mediaUsedBytes -
												(disk.appUsedBytes ?? 0) -
												(disk.cacheUsedBytes ?? 0),
										),
									)}
								</dd>
							</>
						)}
						{disk.mediaUsedBytes > 0 && (
							<>
								<dt>Media</dt>
								<dd>{formatBytes(disk.mediaUsedBytes)}</dd>
							</>
						)}
					</dl>
					{disk.mediaSourcePaths.length > 0 && (
						<ul class={styles.diskTooltipPaths}>
							{disk.mediaSourcePaths.map((p) => (
								<li key={p}>{p}</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

const STATS_CACHE_KEY = 'mu_server_stats_cache';

function readCachedStats(): any | null {
	try {
		const raw = localStorage.getItem(STATS_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		// Guard against schema drift: require the basic shape we render.
		if (parsed && parsed.system && parsed.services) return parsed;
		return null;
	} catch {
		return null;
	}
}

function StatsSection() {
	// Hydrate from localStorage so the spinner only shows on a true first
	// visit ever — otherwise the user immediately sees last-session values
	// while the live fetch runs in the background.
	const [stats, setStats] = useState<any>(() => readCachedStats());
	const [updating, setUpdating] = useState(false);
	const [updatedAt, setUpdatedAt] = useState<number | null>(stats ? Date.now() : null);

	useEffect(() => {
		const load = async () => {
			setUpdating(true);
			try {
				const data = await api.get('/health/stats');
				setStats((prev: any) => {
					// Merge: if a server-side scan is still pending (field comes
					// back null), keep the previously-known value rather than
					// flashing "—" or a 0.
					if (!prev) return data;
					const sys = { ...prev.system, ...data.system };
					if (data.system?.dataDirSize == null && prev.system?.dataDirSize != null) {
						sys.dataDirSize = prev.system.dataDirSize;
					}
					if (data.system?.diskTotal == null && prev.system?.diskTotal != null) {
						sys.diskTotal = prev.system.diskTotal;
						sys.diskFree = prev.system.diskFree;
					}
					// For each disk in the new response, keep prev's total/free
					// if the server returned null (still measuring this drive).
					if (Array.isArray(data.system?.disks) && Array.isArray(prev.system?.disks)) {
						const prevByRoot = new Map<string, any>(
							prev.system.disks.map((d: any) => [d.root, d]),
						);
						sys.disks = data.system.disks.map((d: any) => {
							const old = prevByRoot.get(d.root);
							if (!old) return d;
							return {
								...d,
								total: d.total ?? old.total,
								free: d.free ?? old.free,
								appUsedBytes: d.appUsedBytes ?? old.appUsedBytes,
							};
						});
					}
					return { ...data, system: sys };
				});
				setUpdatedAt(Date.now());
				try {
					localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(data));
				} catch {}
			} catch {
				// Keep showing cached values on transient failures.
			} finally {
				setUpdating(false);
			}
		};
		load();
		const interval = setInterval(load, 5000);
		return () => clearInterval(interval);
	}, []);

	if (!stats) {
		return (
			<div class={styles.statsLoading}>
				<Spinner size="sm" /> Loading server stats…
			</div>
		);
	}

	const sys = stats.system;
	const svc = stats.services;
	const cpuRatio = Math.min(sys.loadAvg[0] / sys.cpuCount, 1);
	const memTotal = sys.memoryTotal || 1;
	const memUsed = sys.memoryTotal - sys.memoryFree;
	const memRatio = memUsed / memTotal;
	const appMem = sys.appMemory?.total ?? 0;
	const appMemRatio = appMem / memTotal;

	return (
		<>
			<div class={styles.statsMeta}>
				<span class={styles.statsMetaTime}>
					{updatedAt ? `Updated ${formatRelativeTime(updatedAt)}` : 'Loading…'}
				</span>
				{updating && (
					<span class={styles.statsMetaUpdating}>
						<Spinner size="sm" /> Refreshing
					</span>
				)}
			</div>
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
							style={{
								width: `${cpuRatio * 100}%`,
								background: meterColor(cpuRatio),
							}}
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
							style={{
								width: `${memRatio * 100}%`,
								background: meterColor(memRatio),
							}}
						/>
						<div
							class={`${styles.statBarFill} ${styles.statBarOverlay}`}
							style={{ width: `${Math.max(appMemRatio * 100, 0.5)}%` }}
						/>
					</div>
				</div>

				{/* Disks — one bar per distinct physical drive across app data
			    dir + media source paths. Falls back to the legacy single
			    pair (diskTotal/diskFree) for an old server that hasn't
			    been upgraded yet. */}
				{(() => {
					const disks: any[] = Array.isArray(sys.disks) ? sys.disks : [];
					const fallback =
						disks.length === 0 && (sys.diskTotal ?? 0) > 0
							? [
									{
										root: '/',
										label: 'Disk',
										total: sys.diskTotal,
										free: sys.diskFree,
										isAppDrive: true,
										appUsedBytes: sys.dataDirSize ?? null,
										mediaUsedBytes: 0,
										mediaSourcePaths: [],
									},
								]
							: disks;
					if (fallback.length === 0) return null;
					return (
						<div class={`${styles.statCard} ${styles.diskCard}`}>
							<div class={styles.statCardHeader}>
								<span class={styles.statLabel}>
									Disks{fallback.length > 1 ? ` (${fallback.length})` : ''}
								</span>
							</div>
							<div class={styles.diskList}>
								{fallback.map((d) => (
									<DiskRow key={d.root} disk={d} />
								))}
							</div>
						</div>
					);
				})()}

				{/* Library */}
				<div class={styles.statCard}>
					<div class={styles.statLabel}>Library</div>
					<div class={styles.statValue}>
						{stats.library?.movieCount ?? 0} movies, {stats.library?.fileCount ?? 0}{' '}
						files
					</div>
				</div>

				{/* Services */}
				{svc && (
					<div class={styles.statCard}>
						<div class={styles.statLabel}>Activity</div>
						<div class={styles.statValue}>
							{svc.activeStreams ?? 0} streams, {svc.activeTranscodes ?? 0}{' '}
							transcodes, {svc.runningJobs ?? 0} running / {svc.pendingJobs ?? 0}{' '}
							pending jobs
						</div>
					</div>
				)}
			</div>
		</>
	);
}

/**
 * Format a wall-clock timestamp as "Xs ago" / "Xm ago" relative to now.
 * Used by the stats meta row so the user can tell at a glance whether
 * the displayed numbers are live or last-known.
 */
function formatRelativeTime(ts: number): string {
	const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
	if (deltaSec < 5) return 'just now';
	if (deltaSec < 60) return `${deltaSec}s ago`;
	const m = Math.floor(deltaSec / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	return `${h}h ago`;
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
		void writeClipboard(content).then((ok) => {
			if (ok) notifySuccess('Copied to clipboard');
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

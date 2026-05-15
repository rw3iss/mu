import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Spinner';
import { abbreviateJobId } from '@/components/admin/JobBadge';
import { type Job, type JobStatus, jobsService } from '@/services/jobs.service';
import { wsService } from '@/services/websocket.service';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './JobList.module.scss';

interface JobListProps {
	path?: string;
	matches?: { type?: string; status?: string };
}

const STATUS_OPTIONS: { value: '' | JobStatus; label: string }[] = [
	{ value: '', label: 'All statuses' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'running', label: 'Running' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'failed', label: 'Failed' },
	{ value: 'paused', label: 'Paused' },
];

/**
 * Admin-only job listing. Filters by `?type=` and `?status=` query
 * params; auto-refreshes on the job WS channel so newly-enqueued or
 * completing jobs appear without a manual reload.
 */
export function JobList({ matches }: JobListProps) {
	const typeFilter = matches?.type ?? '';
	const statusFilter = (matches?.status as JobStatus | undefined) ?? '';

	const [jobs, setJobs] = useState<Job[]>([]);
	const [loading, setLoading] = useState(true);
	const [pruning, setPruning] = useState(false);

	const isAdmin = currentUser.value?.role === 'admin';

	const load = useCallback(async () => {
		try {
			const list = await jobsService.list({
				type: typeFilter || undefined,
				status: (statusFilter as JobStatus) || undefined,
			});
			// Newest first
			list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			setJobs(list);
		} catch (err: any) {
			notifyError(`Failed to load jobs: ${err?.message ?? 'unknown error'}`);
		} finally {
			setLoading(false);
		}
	}, [typeFilter, statusFilter]);

	useEffect(() => {
		setLoading(true);
		load();
	}, [load]);

	useEffect(() => {
		const refetch = () => load();
		wsService.on('job:started', refetch);
		wsService.on('job:progress', refetch);
		wsService.on('job:completed', refetch);
		wsService.on('job:failed', refetch);
		return () => {
			wsService.off('job:started', refetch);
			wsService.off('job:progress', refetch);
			wsService.off('job:completed', refetch);
			wsService.off('job:failed', refetch);
		};
	}, [load]);

	const handlePrune = useCallback(async () => {
		setPruning(true);
		try {
			const res = await jobsService.list().then((all) => all); // noop, kept for parallelism
			void res;
			const removed = await fetch('/api/v1/jobs/prune?maxAgeHours=24', {
				method: 'POST',
				credentials: 'include',
			})
				.then((r) => r.json())
				.then((j: { removed: number }) => j.removed)
				.catch(() => 0);
			notifySuccess(`Pruned ${removed} completed job(s) older than 24h`);
			load();
		} catch (err: any) {
			notifyError(`Prune failed: ${err?.message ?? 'unknown error'}`);
		} finally {
			setPruning(false);
		}
	}, [load]);

	const setFilter = (key: 'type' | 'status', value: string) => {
		const params = new URLSearchParams();
		if (key === 'type' ? value : typeFilter) {
			params.set('type', key === 'type' ? value : typeFilter);
		}
		if (key === 'status' ? value : statusFilter) {
			params.set('status', key === 'status' ? value : statusFilter);
		}
		const qs = params.toString();
		route(`/admin/jobs${qs ? `?${qs}` : ''}`);
	};

	if (!isAdmin) {
		return (
			<div class={styles.errorWrap}>
				<h2>Not authorised</h2>
				<p>Admin role required to view jobs.</p>
				<Button variant="ghost" onClick={() => route('/')}>
					<Icon name="arrow-left" size={14} /> Home
				</Button>
			</div>
		);
	}

	return (
		<div class={styles.page}>
			<header class={styles.header}>
				<div>
					<h1 class={styles.title}>Jobs</h1>
					<p class={styles.subtitle}>
						Background processing queue. Filter by type or status; auto-refreshes via WebSocket.
					</p>
				</div>
				<Button variant="ghost" onClick={handlePrune} loading={pruning}>
					<Icon name="trash" size={14} /> Prune completed (24h+)
				</Button>
			</header>

			<div class={styles.filters}>
				<label class={styles.filter}>
					<span>Type</span>
					<input
						type="text"
						class={styles.filterInput}
						placeholder="e.g. thumbnail, pre-transcode"
						value={typeFilter}
						onChange={(e) => setFilter('type', (e.target as HTMLInputElement).value.trim())}
					/>
				</label>
				<label class={styles.filter}>
					<span>Status</span>
					<select
						class={styles.filterSelect}
						value={statusFilter}
						onChange={(e) => setFilter('status', (e.target as HTMLSelectElement).value)}
					>
						{STATUS_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</label>
			</div>

			{loading ? (
				<div class={styles.loading}>
					<Spinner size="md" />
				</div>
			) : jobs.length === 0 ? (
				<div class={styles.empty}>No jobs match the current filters.</div>
			) : (
				<table class={styles.table}>
					<thead>
						<tr>
							<th>ID</th>
							<th>Type</th>
							<th>Label</th>
							<th>Status</th>
							<th>Progress</th>
							<th>Created</th>
						</tr>
					</thead>
					<tbody>
						{jobs.map((j) => (
							<tr
								key={j.id}
								class={styles.row}
								onClick={() => route(`/admin/jobs/${j.id}`)}
							>
								<td>
									<code class={styles.id}>{abbreviateJobId(j.id)}</code>
								</td>
								<td>
									<span class={styles.typeCell}>{j.type}</span>
								</td>
								<td class={styles.labelCell}>{j.label}</td>
								<td>
									<span class={`${styles.status} ${styles[`status_${j.status}`] ?? ''}`}>
										{j.status}
									</span>
								</td>
								<td>
									{typeof j.progress === 'number' ? `${Math.round(j.progress)}%` : '—'}
								</td>
								<td class={styles.timeCell}>{formatTime(j.createdAt)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		const diff = Date.now() - d.getTime();
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return d.toLocaleDateString();
	} catch {
		return iso;
	}
}

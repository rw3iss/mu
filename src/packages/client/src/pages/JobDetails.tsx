import { useCallback, useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Spinner';
import { type Job, jobsService } from '@/services/jobs.service';
import { wsService } from '@/services/websocket.service';
import { currentUser } from '@/state/auth.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './JobDetails.module.scss';

interface JobDetailsProps {
	path?: string;
	id?: string;
}

/**
 * Admin-only job details / management page. Live-updates over the
 * existing JOB_PROGRESS / JOB_COMPLETED / JOB_FAILED WebSocket
 * channels so long-running jobs reflect their state without a manual
 * refresh.
 */
export function JobDetails({ id }: JobDetailsProps) {
	const [job, setJob] = useState<Job | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyAction, setBusyAction] = useState<string | null>(null);

	const isAdmin = currentUser.value?.role === 'admin';

	const load = useCallback(async () => {
		if (!id) return;
		try {
			const j = await jobsService.get(id);
			setJob(j);
			setError(null);
		} catch (err: any) {
			setError(err?.message ?? 'Failed to load job');
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		if (!id) return;
		setLoading(true);
		load();
	}, [id, load]);

	useEffect(() => {
		if (!id) return;
		const matches = (data: unknown) => (data as { id?: string })?.id === id;
		const refetch = (data: unknown) => {
			if (matches(data)) load();
		};
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
	}, [id, load]);

	const runAction = useCallback(
		async (action: string, fn: () => Promise<unknown>, successMsg: string) => {
			setBusyAction(action);
			try {
				const r = (await fn()) as { newJobId?: string | null } | undefined;
				if (action === 'retry' && r?.newJobId) {
					notifySuccess('Job re-queued');
					route(`/admin/jobs/${r.newJobId}`);
					return;
				}
				notifySuccess(successMsg);
				load();
			} catch (err: any) {
				notifyError(`Failed to ${action}: ${err?.message ?? 'unknown error'}`);
			} finally {
				setBusyAction(null);
			}
		},
		[load],
	);

	if (!isAdmin) {
		return (
			<div class={styles.errorWrap}>
				<h2>Not authorised</h2>
				<p>Admin role required to view job details.</p>
				<Button variant="ghost" onClick={() => route('/')}>
					<Icon name="arrow-left" size={14} /> Home
				</Button>
			</div>
		);
	}

	if (loading) {
		return (
			<div class={styles.loadingWrap}>
				<Spinner size="lg" />
			</div>
		);
	}

	if (error || !job) {
		return (
			<div class={styles.errorWrap}>
				<h2>Job not found</h2>
				<p>{error ?? `No job with id ${id}`}</p>
				<Button variant="ghost" onClick={() => route('/admin/jobs')}>
					<Icon name="arrow-left" size={14} /> All jobs
				</Button>
			</div>
		);
	}

	const isLive = job.status === 'pending' || job.status === 'running';
	const isCancellable = isLive || job.status === 'paused';
	const movieId = typeof job.payload?.movieId === 'string' ? job.payload.movieId : null;
	const durationMs =
		job.completedAt && job.startedAt
			? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
			: job.startedAt
				? Date.now() - new Date(job.startedAt).getTime()
				: 0;

	return (
		<div class={styles.page}>
			<button class={styles.back} onClick={() => route('/admin/jobs')}>
				<Icon name="arrow-left" size={14} /> All jobs
			</button>

			<header class={styles.header}>
				<div>
					<div class={styles.eyebrow}>
						<span class={styles.type}>{job.type}</span>
						<span class={`${styles.status} ${styles[`status_${job.status}`] ?? ''}`}>
							{job.status}
						</span>
					</div>
					<h1 class={styles.title}>{job.label}</h1>
					<div class={styles.idRow}>
						<code class={styles.id}>{job.id}</code>
					</div>
				</div>
				<div class={styles.actionBar}>
					{movieId && (
						<Button variant="ghost" onClick={() => route(`/movie/${movieId}`)}>
							<Icon name="film" size={14} /> Movie
						</Button>
					)}
					{job.status === 'pending' && (
						<Button
							variant="secondary"
							loading={busyAction === 'prioritize'}
							onClick={() =>
								runAction(
									'prioritize',
									() => jobsService.prioritize(job.id),
									'Moved to the front of the queue',
								)
							}
						>
							<Icon name="arrow-up" size={14} /> Prioritize
						</Button>
					)}
					{job.status === 'running' && (
						<Button
							variant="secondary"
							loading={busyAction === 'pause'}
							onClick={() => runAction('pause', () => jobsService.pause(job.id), 'Job paused')}
						>
							<Icon name="pause" size={14} /> Pause
						</Button>
					)}
					{job.status === 'paused' && (
						<Button
							variant="secondary"
							loading={busyAction === 'resume'}
							onClick={() => runAction('resume', () => jobsService.resume(job.id), 'Job resumed')}
						>
							<Icon name="play" size={14} /> Resume
						</Button>
					)}
					{job.status === 'failed' && (
						<Button
							variant="secondary"
							loading={busyAction === 'retry'}
							onClick={() => runAction('retry', () => jobsService.retry(job.id), 'Job re-queued')}
						>
							<Icon name="refresh" size={14} /> Retry
						</Button>
					)}
					{isCancellable && (
						<Button
							variant="danger"
							loading={busyAction === 'cancel'}
							onClick={() => runAction('cancel', () => jobsService.cancel(job.id), 'Cancel signal sent')}
						>
							<Icon name="x" size={14} /> Cancel
						</Button>
					)}
				</div>
			</header>

			{typeof job.progress === 'number' && isLive && (
				<div class={styles.progressWrap}>
					<div class={styles.progressBar}>
						<div
							class={styles.progressFill}
							style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
						/>
					</div>
					<span class={styles.progressText}>{Math.round(job.progress)}%</span>
				</div>
			)}

			<dl class={styles.metaGrid}>
				<div class={styles.metaItem}>
					<dt>Priority</dt>
					<dd>{job.priority}</dd>
				</div>
				<div class={styles.metaItem}>
					<dt>Created</dt>
					<dd>{formatTime(job.createdAt)}</dd>
				</div>
				<div class={styles.metaItem}>
					<dt>Started</dt>
					<dd>{job.startedAt ? formatTime(job.startedAt) : '—'}</dd>
				</div>
				<div class={styles.metaItem}>
					<dt>Completed</dt>
					<dd>{job.completedAt ? formatTime(job.completedAt) : '—'}</dd>
				</div>
				{durationMs > 0 && (
					<div class={styles.metaItem}>
						<dt>Duration</dt>
						<dd>{formatDuration(durationMs)}</dd>
					</div>
				)}
			</dl>

			{job.error && (
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Error</h2>
					<pre class={`${styles.codeBlock} ${styles.errorBlock}`}>{job.error}</pre>
				</section>
			)}

			{job.payload && Object.keys(job.payload).length > 0 && (
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Payload</h2>
					<pre class={styles.codeBlock}>{JSON.stringify(job.payload, null, 2)}</pre>
				</section>
			)}

			{job.result !== undefined && job.result !== null && (
				<section class={styles.section}>
					<h2 class={styles.sectionTitle}>Result</h2>
					<pre class={styles.codeBlock}>
						{typeof job.result === 'string'
							? job.result
							: JSON.stringify(job.result, null, 2)}
					</pre>
				</section>
			)}
		</div>
	);
}

function formatTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms} ms`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	if (m < 60) return `${m}m ${rem}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

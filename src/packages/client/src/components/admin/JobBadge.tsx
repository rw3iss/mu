import { route } from 'preact-router';
import type { NotificationAction } from '@/state/notifications.state';
import styles from './JobBadge.module.scss';

interface JobBadgeProps {
	jobId: string;
	/** Optional label override. Default: abbreviated jobId like "5e4b…". */
	label?: string;
	/** Optional extra class merged onto the badge. */
	class?: string;
}

/** Abbreviate a UUID-ish id to "first8…last4" for compact UI display. */
export function abbreviateJobId(jobId: string): string {
	if (!jobId) return '';
	if (jobId.length <= 12) return jobId;
	return `${jobId.slice(0, 8)}…${jobId.slice(-4)}`;
}

export function jobDetailHref(jobId: string): string {
	return `/admin/jobs/${jobId}`;
}

/**
 * Inline link to the admin job-details page. Renders the jobId in a
 * monospace abbreviated form so it sits cleanly next to surrounding
 * text or button labels.
 */
export function JobBadge({ jobId, label, class: className }: JobBadgeProps) {
	if (!jobId) return null;
	const cls = className ? `${styles.badge} ${className}` : styles.badge;
	return (
		<a
			class={cls}
			href={jobDetailHref(jobId)}
			onClick={(e) => {
				e.preventDefault();
				route(jobDetailHref(jobId));
			}}
			title={`View job ${jobId}`}
		>
			{label ?? `Job ${abbreviateJobId(jobId)}`}
		</a>
	);
}

/**
 * Build a toast action that links to a job's detail page. Pass to
 * `notifySuccess(..., duration, [jobAction(id)])`.
 */
export function jobAction(jobId: string, label?: string): NotificationAction {
	return {
		label: label ?? `Job ${abbreviateJobId(jobId)}`,
		href: jobDetailHref(jobId),
	};
}

/**
 * Build a toast action that links to the filtered job-list page for a
 * given job type (e.g. "thumbnail", "pre-transcode"). Useful when an
 * admin action enqueues many jobs and there's no single id to link to.
 */
export function jobListAction(type: string, label = 'View jobs'): NotificationAction {
	return { label, href: `/admin/jobs?type=${encodeURIComponent(type)}` };
}

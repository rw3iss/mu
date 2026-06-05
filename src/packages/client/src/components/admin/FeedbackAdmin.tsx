import { useEffect, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { Spinner } from '@/components/common/Spinner';
import { useConfirm } from '@/hooks/useConfirm';
import {
	type FeedbackDetail,
	type FeedbackSummary,
	feedbackService,
} from '@/services/feedback.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './FeedbackAdmin.module.scss';

/** Admin feedback manager — list, expand for full detail + screenshot, delete / clear. */
export function FeedbackAdmin() {
	const [items, setItems] = useState<FeedbackSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [details, setDetails] = useState<Record<string, FeedbackDetail>>({});
	const [busy, setBusy] = useState(false);
	const { confirm, dialog } = useConfirm();

	const load = async () => {
		setLoading(true);
		try {
			const res = await feedbackService.list();
			setItems(res.feedback);
		} catch {
			notifyError('Failed to load feedback');
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	const toggle = async (id: string) => {
		if (expandedId === id) {
			setExpandedId(null);
			return;
		}
		setExpandedId(id);
		if (!details[id]) {
			try {
				const res = await feedbackService.detail(id);
				setDetails((d) => ({ ...d, [id]: res.feedback }));
			} catch {
				notifyError('Failed to load feedback detail');
			}
		}
	};

	const handleDelete = async (e: Event, id: string) => {
		e.stopPropagation();
		const ok = await confirm({
			title: 'Delete feedback?',
			message: 'This permanently removes this feedback entry.',
			confirmLabel: 'Delete',
			variant: 'danger',
		});
		if (!ok) return;
		setBusy(true);
		try {
			await feedbackService.remove(id);
			setItems((list) => list.filter((f) => f.id !== id));
			notifySuccess('Feedback deleted');
		} catch {
			notifyError('Failed to delete feedback');
		} finally {
			setBusy(false);
		}
	};

	const handleClear = async () => {
		const ok = await confirm({
			title: 'Clear all feedback?',
			message: `This permanently removes all ${items.length} feedback entries.`,
			confirmLabel: 'Clear all',
			variant: 'danger',
		});
		if (!ok) return;
		setBusy(true);
		try {
			const res = await feedbackService.clear();
			setItems([]);
			notifySuccess(`Cleared ${res.cleared} entries`);
		} catch {
			notifyError('Failed to clear feedback');
		} finally {
			setBusy(false);
		}
	};

	const fmtDate = (iso: string) =>
		new Date(iso).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});

	if (loading) {
		return (
			<div class={styles.center}>
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<div class={styles.wrap}>
			{dialog}
			<div class={styles.toolbar}>
				<span class={styles.count}>
					{items.length} {items.length === 1 ? 'entry' : 'entries'}
				</span>
				<div class={styles.toolbarActions}>
					<Button variant="ghost" size="sm" onClick={load} disabled={busy}>
						<Icon name="refresh" size={14} /> Refresh
					</Button>
					{items.length > 0 && (
						<Button variant="danger" size="sm" onClick={handleClear} disabled={busy}>
							<Icon name="trash" size={14} /> Clear all
						</Button>
					)}
				</div>
			</div>

			{items.length === 0 ? (
				<div class={styles.empty}>No feedback yet.</div>
			) : (
				<div class={styles.list}>
					{items.map((f) => {
						const open = expandedId === f.id;
						const detail = details[f.id];
						return (
							<div key={f.id} class={`${styles.row} ${open ? styles.rowOpen : ''}`}>
								<button
									type="button"
									class={styles.rowHeader}
									onClick={() => toggle(f.id)}
								>
									<Icon
										name={open ? 'chevron-down' : 'chevron-right'}
										size={14}
										class={styles.chevron}
									/>
									<span class={styles.from}>{f.name || 'Anonymous'}</span>
									<span class={styles.snippet}>{f.description}</span>
									{f.hasScreenshot && (
										<span class={styles.shotBadge} title="Has screenshot">
											<Icon name="image" size={12} />
										</span>
									)}
									<span
										class={`${styles.status} ${styles[`status_${f.status}`]}`}
									>
										{f.status}
									</span>
									<span class={styles.date}>{fmtDate(f.createdAt)}</span>
									<button
										type="button"
										class={styles.deleteBtn}
										onClick={(e) => handleDelete(e, f.id)}
										disabled={busy}
										aria-label="Delete feedback"
									>
										<Icon name="trash" size={14} />
									</button>
								</button>

								{open && (
									<div class={styles.detail}>
										<div class={styles.meta}>
											{f.email && (
												<span>
													<strong>Email:</strong> {f.email}
												</span>
											)}
											{f.pageUrl && (
												<span class={styles.metaUrl}>
													<strong>Page:</strong> {f.pageUrl}
												</span>
											)}
											{detail?.userAgent && (
												<span class={styles.metaUa}>
													<strong>Agent:</strong> {detail.userAgent}
												</span>
											)}
										</div>
										<p class={styles.body}>{f.description}</p>
										{f.hasScreenshot &&
											(detail?.screenshotData ? (
												<a
													href={detail.screenshotData}
													target="_blank"
													rel="noreferrer"
												>
													<img
														src={detail.screenshotData}
														alt={f.screenshotName ?? 'screenshot'}
														class={styles.shot}
													/>
												</a>
											) : (
												<div class={styles.shotLoading}>
													<Spinner size="sm" /> Loading screenshot…
												</div>
											))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

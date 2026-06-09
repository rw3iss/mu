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
	// Respond form (one open at a time, keyed to the expanded item).
	const [respondingId, setRespondingId] = useState<string | null>(null);
	const [replyText, setReplyText] = useState('');
	const [formError, setFormError] = useState<string | null>(null);
	const [acting, setActing] = useState(false);
	const { confirm, dialog } = useConfirm();

	const openRespond = (id: string) => {
		setRespondingId(id);
		setReplyText('');
		setFormError(null);
	};
	const closeRespond = () => {
		setRespondingId(null);
		setReplyText('');
		setFormError(null);
	};

	const setStatusLocal = (id: string, status: string) =>
		setItems((list) => list.map((f) => (f.id === id ? { ...f, status } : f)));

	const markResolved = async (id: string) => {
		setActing(true);
		setFormError(null);
		try {
			await feedbackService.setStatus(id, 'resolved');
			setStatusLocal(id, 'resolved');
			notifySuccess('Marked resolved');
			closeRespond();
		} catch {
			setFormError('Failed to mark resolved.');
		} finally {
			setActing(false);
		}
	};

	const respond = async (id: string, resolve: boolean) => {
		if (!resolve && !replyText.trim()) {
			setFormError('Enter a reply message.');
			return;
		}
		setActing(true);
		setFormError(null);
		try {
			const res = await feedbackService.respond(id, {
				resolve,
				message: replyText.trim() || undefined,
			});
			if (resolve) setStatusLocal(id, res.status);
			if (res.emailed) {
				notifySuccess(resolve ? 'Resolved & reply sent' : 'Reply sent');
				closeRespond();
			} else {
				// Only a resolve-and-reply reaches here (a plain reply throws when
				// it can't send). The resolve stuck; warn about the email.
				notifySuccess('Marked resolved');
				setFormError(
					`Resolved, but the reply email wasn't sent: ${res.emailError ?? 'unknown reason'}`,
				);
			}
		} catch (err) {
			setFormError((err as Error)?.message || 'Something went wrong.');
		} finally {
			setActing(false);
		}
	};

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
										{f.attachmentUrl ? (
											f.attachmentType?.startsWith('video/') ? (
												// biome-ignore lint/a11y/useMediaCaption: user-supplied clip
												<video src={f.attachmentUrl} class={styles.shot} controls />
											) : (
												<a href={f.attachmentUrl} target="_blank" rel="noreferrer">
													<img
														src={f.attachmentUrl}
														alt={f.screenshotName ?? 'attachment'}
														class={styles.shot}
													/>
												</a>
											)
										) : f.hasScreenshot ? (
											detail?.screenshotData ? (
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
											)
										) : null}

										{respondingId === f.id ? (
											<div class={styles.respondForm}>
												<textarea
													class={styles.replyInput}
													value={replyText}
													onInput={(e) =>
														setReplyText((e.target as HTMLTextAreaElement).value)
													}
													placeholder="Write a reply to the user (optional when resolving)…"
													rows={4}
												/>
												{!f.email && (
													<p class={styles.formHint}>
														This submitter didn't provide an email — a reply can't be
														delivered, but you can still mark it resolved.
													</p>
												)}
												{formError && <p class={styles.formError}>{formError}</p>}
												<div class={styles.respondActions}>
													<Button
														variant="secondary"
														size="sm"
														loading={acting}
														onClick={() => markResolved(f.id)}
													>
														Mark Resolved
													</Button>
													<Button
														variant="primary"
														size="sm"
														loading={acting}
														onClick={() => respond(f.id, true)}
													>
														Resolve and Reply
													</Button>
													<Button
														variant="primary"
														size="sm"
														loading={acting}
														onClick={() => respond(f.id, false)}
													>
														Reply
													</Button>
													<Button
														variant="ghost"
														size="sm"
														disabled={acting}
														onClick={closeRespond}
													>
														Cancel
													</Button>
												</div>
											</div>
										) : (
											<div class={styles.respondBar}>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => openRespond(f.id)}
												>
													Respond
												</Button>
											</div>
										)}
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

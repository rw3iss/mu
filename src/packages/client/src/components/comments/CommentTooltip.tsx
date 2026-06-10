import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import type { MovieComment } from '@/services/comments.service';
import { addComment, deleteComment, editComment } from '@/state/comments.state';
import { notifyError } from '@/state/notifications.state';
import styles from './CommentTooltip.module.scss';

export interface CommentTooltipProps {
	movieId: string;
	/** Viewport anchor point (x = horizontal center). */
	x: number;
	y: number;
	/** 'above' (mini/full — tooltip sits above the anchor) or 'below' (split). */
	placement: 'above' | 'below';
	/** Read view of an existing comment (hover on a seek-bar bubble). */
	comment?: MovieComment | null;
	/** Initial anchored time for a new comment (entry mode). */
	timeSeconds?: number | null;
	/** Current user id — enables edit/delete in read view. */
	currentUserId?: string | null;
	onClose: () => void;
	/** Mouse enter/leave so hover-opened tooltips can stay alive. */
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
}

function fmt(t: number): string {
	const s = Math.max(0, Math.floor(t));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The seek-bar comment tooltip — one flexible component for three states:
 *  - entry: textarea + time row (click time → min/sec inputs + apply checkbox)
 *  - read:  time · author · text blurb (+ Edit/Delete for the author)
 *  - edit:  read view flipped into the entry form, pre-filled
 * Portalled to body, positioned above/below the anchor, quick slide+fade
 * in/out (suppressed under prefers-reduced-motion via global override).
 */
export function CommentTooltip({
	movieId,
	x,
	y,
	placement,
	comment,
	timeSeconds,
	currentUserId,
	onClose,
	onMouseEnter,
	onMouseLeave,
}: CommentTooltipProps) {
	const isReadOnly = !!comment && comment.userId !== currentUserId;
	const [mode, setMode] = useState<'entry' | 'read'>(comment ? 'read' : 'entry');
	const [text, setText] = useState(comment?.text ?? '');
	const [time, setTime] = useState<number | null>(
		comment ? (comment.timeSeconds ?? null) : (timeSeconds ?? null),
	);
	const [editingTime, setEditingTime] = useState(false);
	const [minStr, setMinStr] = useState('0');
	const [secStr, setSecStr] = useState('0');
	const [busy, setBusy] = useState(false);
	const [success, setSuccess] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const taRef = useRef<HTMLTextAreaElement>(null);

	// Escape cancels.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener('keydown', onKey, true);
		return () => document.removeEventListener('keydown', onKey, true);
	}, [onClose]);

	useEffect(() => {
		if (mode === 'entry') taRef.current?.focus();
	}, [mode]);

	const beginTimeEdit = useCallback(() => {
		const t = Math.max(0, Math.floor(time ?? 0));
		setMinStr(String(Math.floor(t / 60)));
		setSecStr(String(t % 60));
		setEditingTime(true);
	}, [time]);

	const applyTime = useCallback(() => {
		const m = Math.max(0, parseInt(minStr, 10) || 0);
		const s = Math.max(0, Math.min(59, parseInt(secStr, 10) || 0));
		setTime(m * 60 + s);
		setEditingTime(false);
	}, [minStr, secStr]);

	const finishWithSuccess = useCallback(() => {
		setSuccess(true);
		setTimeout(() => {
			setLeaving(true);
			setTimeout(onClose, 220);
		}, 1000);
	}, [onClose]);

	const submit = useCallback(async () => {
		const t = text.trim();
		if (!t || busy) return;
		setBusy(true);
		try {
			if (comment) {
				await editComment(movieId, comment.id, { text: t, timeSeconds: time });
			} else {
				await addComment(movieId, { text: t, timeSeconds: time });
			}
			finishWithSuccess();
		} catch (err) {
			notifyError((err as Error)?.message || 'Failed to save comment');
			setBusy(false);
		}
	}, [text, busy, comment, movieId, time, finishWithSuccess]);

	const handleDelete = useCallback(async () => {
		if (!comment || busy) return;
		setBusy(true);
		try {
			await deleteComment(movieId, comment.id);
			onClose();
		} catch {
			notifyError('Failed to delete comment');
			setBusy(false);
		}
	}, [comment, busy, movieId, onClose]);

	const style = {
		left: `${Math.max(150, Math.min(x, window.innerWidth - 150))}px`,
		top: `${y}px`,
	};

	return createPortal(
		<div
			ref={rootRef}
			class={`${styles.tooltip} ${placement === 'above' ? styles.above : styles.below} ${leaving ? styles.leaving : ''}`}
			style={style}
			onClick={(e: Event) => e.stopPropagation()}
			onMouseDown={(e: Event) => e.stopPropagation()}
			onContextMenu={(e: Event) => e.stopPropagation()}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			{success ? (
				<div class={styles.success}>Comment added!</div>
			) : (
				<>
					<div class={styles.head}>
						{time != null &&
							(editingTime && mode === 'entry' ? (
								<span class={styles.timeEdit}>
									<input
										type="number"
										min={0}
										value={minStr}
										onInput={(e) =>
											setMinStr((e.target as HTMLInputElement).value)
										}
									/>
									m
									<input
										type="number"
										min={0}
										max={59}
										value={secStr}
										onInput={(e) =>
											setSecStr((e.target as HTMLInputElement).value)
										}
									/>
									s
									<label class={styles.applyTime} title="Apply time">
										<input type="checkbox" onChange={applyTime} />
									</label>
								</span>
							) : (
								<button
									class={styles.time}
									onClick={mode === 'entry' ? beginTimeEdit : undefined}
									title={mode === 'entry' ? 'Click to change time' : undefined}
								>
									{fmt(time)}
								</button>
							))}
						{comment && <span class={styles.author}>{comment.authorName}</span>}
						<button class={styles.close} onClick={onClose} aria-label="Close">
							<Icon name="x" size={12} />
						</button>
					</div>

					{mode === 'read' ? (
						<>
							<p class={styles.blurb}>{comment!.text}</p>
							{!isReadOnly && (
								<div class={styles.actions}>
									<button class={styles.linkBtn} onClick={() => setMode('entry')}>
										Edit
									</button>
									<button
										class={`${styles.linkBtn} ${styles.danger}`}
										disabled={busy}
										onClick={handleDelete}
									>
										Delete
									</button>
								</div>
							)}
						</>
					) : (
						<>
							<textarea
								ref={taRef}
								class={styles.textarea}
								value={text}
								rows={2}
								maxLength={2000}
								placeholder="Add a comment…"
								onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
								onKeyDown={(e: KeyboardEvent) => {
									if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
								}}
							/>
							<div class={styles.actions}>
								<button class={styles.linkBtn} onClick={onClose}>
									Cancel
								</button>
								<button
									class={styles.commentBtn}
									disabled={busy || !text.trim()}
									onClick={submit}
								>
									{comment ? 'Save' : 'Comment'}
								</button>
							</div>
						</>
					)}
				</>
			)}
		</div>,
		document.body,
	);
}

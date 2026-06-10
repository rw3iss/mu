import { useCallback, useEffect, useState } from 'preact/hooks';
import type { MovieComment } from '@/services/comments.service';
import { currentUser } from '@/state/auth.state';
import {
	addComment,
	deleteComment,
	editComment,
	loadComments,
	movieComments,
	reactToComment,
} from '@/state/comments.state';
import { notifyError } from '@/state/notifications.state';
import { relativeTime } from '@/utils/time-format';
import styles from './CommentsPanel.module.scss';
import { openEmojiPicker } from './EmojiPicker';

interface CommentsPanelProps {
	movieId: string;
	/** Seek the player to a comment's time when its timestamp is clicked. */
	onSeek?: (timeSeconds: number) => void;
}

function fmtTime(t: number): string {
	const s = Math.max(0, Math.floor(t));
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Reusable comments viewer: entry form on top, one-level threaded list with
 * reply / edit (author) / delete (author) / emoji reactions. Reads the shared
 * comments state so every mounted surface updates together.
 */
export function CommentsPanel({ movieId, onSeek }: CommentsPanelProps) {
	const comments = movieComments.value[movieId] ?? null;
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		loadComments(movieId).catch(() => {});
	}, [movieId]);

	const submit = useCallback(async () => {
		const t = draft.trim();
		if (!t || busy) return;
		setBusy(true);
		try {
			await addComment(movieId, { text: t });
			setDraft('');
		} catch (err) {
			notifyError((err as Error)?.message || 'Failed to add comment');
		} finally {
			setBusy(false);
		}
	}, [draft, busy, movieId]);

	return (
		<div class={styles.panel}>
			<div class={styles.entry}>
				<textarea
					class={styles.textarea}
					rows={2}
					maxLength={2000}
					placeholder="Add a comment…"
					value={draft}
					onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
					onKeyDown={(e: KeyboardEvent) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
					}}
				/>
				<button class={styles.submitBtn} disabled={busy || !draft.trim()} onClick={submit}>
					Comment
				</button>
			</div>

			{comments === null ? (
				<div class={styles.empty}>Loading…</div>
			) : comments.length === 0 ? (
				<div class={styles.empty}>No comments yet — be the first.</div>
			) : (
				<ul class={styles.list}>
					{comments.map((c) => (
						<CommentItem key={c.id} movieId={movieId} comment={c} onSeek={onSeek} />
					))}
				</ul>
			)}
		</div>
	);
}

function CommentItem({
	movieId,
	comment,
	onSeek,
	isReply = false,
}: {
	movieId: string;
	comment: MovieComment;
	onSeek?: (t: number) => void;
	isReply?: boolean;
}) {
	const me = currentUser.value?.id;
	const mine = me === comment.userId;
	const [replying, setReplying] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);

	const act = useCallback(
		async (fn: () => Promise<unknown>) => {
			if (busy) return;
			setBusy(true);
			try {
				await fn();
				setReplying(false);
				setEditing(false);
				setDraft('');
			} catch (err) {
				notifyError((err as Error)?.message || 'Action failed');
			} finally {
				setBusy(false);
			}
		},
		[busy],
	);

	const openReactions = useCallback(
		(e: Event) => {
			openEmojiPicker({
				anchor: e.currentTarget as HTMLElement,
				onPick: (emoji) => {
					reactToComment(movieId, comment.id, emoji).catch(() =>
						notifyError('Failed to react'),
					);
				},
			});
		},
		[movieId, comment.id],
	);

	return (
		<li id={`comment-${comment.id}`} class={`${styles.item} ${isReply ? styles.reply : ''}`}>
			<div class={styles.itemHead}>
				<span class={styles.author}>{comment.authorName}</span>
				{comment.timeSeconds != null && (
					<button
						class={styles.timeChip}
						onClick={() => onSeek?.(comment.timeSeconds!)}
						title="Jump to this time"
					>
						{fmtTime(comment.timeSeconds)}
					</button>
				)}
				<span class={styles.when} title={new Date(comment.createdAt).toLocaleString()}>
					{relativeTime(comment.createdAt)}
					{comment.edited ? ' · edited' : ''}
				</span>
			</div>

			{editing ? (
				<div class={styles.inlineForm}>
					<textarea
						class={styles.textarea}
						rows={2}
						value={draft}
						onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
					/>
					<div class={styles.inlineActions}>
						<button class={styles.linkBtn} onClick={() => setEditing(false)}>
							Cancel
						</button>
						<button
							class={styles.submitBtn}
							disabled={busy || !draft.trim()}
							onClick={() =>
								act(() => editComment(movieId, comment.id, { text: draft.trim() }))
							}
						>
							Save
						</button>
					</div>
				</div>
			) : (
				<p class={styles.text}>{comment.text}</p>
			)}

			<div class={styles.itemActions}>
				{comment.reactions.map((r) => (
					<button
						key={r.emoji}
						class={`${styles.reactionPill} ${r.mine ? styles.reactionMine : ''}`}
						onClick={() => reactToComment(movieId, comment.id, r.emoji).catch(() => {})}
					>
						{r.emoji} {r.count}
					</button>
				))}
				<button class={styles.linkBtn} onClick={openReactions} title="React">
					🙂+
				</button>
				{!isReply && (
					<button
						class={styles.linkBtn}
						onClick={() => {
							setReplying(!replying);
							setDraft('');
						}}
					>
						Reply
					</button>
				)}
				{mine && !editing && (
					<button
						class={styles.linkBtn}
						onClick={() => {
							setDraft(comment.text);
							setEditing(true);
						}}
					>
						Edit
					</button>
				)}
				{mine && (
					<button
						class={`${styles.linkBtn} ${styles.danger}`}
						disabled={busy}
						onClick={() => act(() => deleteComment(movieId, comment.id))}
					>
						Delete
					</button>
				)}
			</div>

			{replying && (
				<div class={styles.inlineForm}>
					<textarea
						class={styles.textarea}
						rows={2}
						placeholder={`Reply to ${comment.authorName}…`}
						value={draft}
						onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
					/>
					<div class={styles.inlineActions}>
						<button class={styles.linkBtn} onClick={() => setReplying(false)}>
							Cancel
						</button>
						<button
							class={styles.submitBtn}
							disabled={busy || !draft.trim()}
							onClick={() =>
								act(() =>
									addComment(movieId, {
										text: draft.trim(),
										parentId: comment.id,
									}),
								)
							}
						>
							Reply
						</button>
					</div>
				</div>
			)}

			{(comment.replies?.length ?? 0) > 0 && (
				<ul class={styles.replies}>
					{comment.replies!.map((r) => (
						<CommentItem
							key={r.id}
							movieId={movieId}
							comment={r}
							onSeek={onSeek}
							isReply
						/>
					))}
				</ul>
			)}
		</li>
	);
}

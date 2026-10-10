import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import { Tooltip } from '@/components/common/Tooltip';
import { shareLinksService } from '@/services/share-links.service';
import { globalMovieId } from '@/state/globalPlayer.state';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import { showControls } from '@/state/player.state';
import { copyToClipboard } from '@/utils/clipboard';
import styles from '../PlayerControls.module.scss';
import { formatTime } from './formatTime';

export interface ShareMenuState {
	x: number;
	y: number;
	time: number;
}

interface ShareMenuProps {
	menu: ShareMenuState;
	onClose: () => void;
	/** "Add Comment" — opens the comment draft at the menu's time. */
	onAddComment: (x: number, time: number) => void;
}

/**
 * Seek-bar right-click menu: add a timed comment, or copy a public / private
 * link at that time. Portaled to document.body so it escapes the player
 * bar's stacking context.
 */
export function ShareMenu({ menu: shareMenu, onClose, onAddComment }: ShareMenuProps) {
	const [shareBusy, setShareBusy] = useState(false);
	// Tracks whether the cursor is over the share menu, so auto-hiding the
	// player controls doesn't yank the menu out from under the user.
	const shareMenuHover = useRef(false);

	const copyShareAtTime = useCallback(
		async (kind: 'public' | 'private') => {
			const menu = shareMenu;
			const movieId = globalMovieId.value;
			if (!menu || !movieId) return;
			setShareBusy(true);
			try {
				let url: string;
				if (kind === 'public') {
					const { token } = await shareLinksService.create(movieId);
					url = `${shareLinksService.buildUrl(token)}?t=${menu.time}`;
				} else {
					url = `${window.location.origin}/movie/${movieId}?t=${menu.time}`;
				}
				const copiedOk = await copyToClipboard(url);
				if (!copiedOk) throw new Error('Clipboard unavailable');
				notifySuccess(
					`${kind === 'public' ? 'Public' : 'Private'} link copied (at ${formatTime(menu.time)})`,
				);
			} catch (err) {
				notifyError((err as Error)?.message || 'Could not copy the link');
			} finally {
				setShareBusy(false);
				onClose();
			}
		},
		[shareMenu],
	);

	// Dismiss the share menu on outside click / Escape.
	useEffect(() => {
		if (!shareMenu) return;
		const close = () => onClose();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		// Defer binding so the opening contextmenu doesn't immediately self-close.
		const id = setTimeout(() => {
			document.addEventListener('mousedown', close);
			document.addEventListener('keydown', onKey);
		}, 0);
		return () => {
			clearTimeout(id);
			document.removeEventListener('mousedown', close);
			document.removeEventListener('keydown', onKey);
		};
	}, [shareMenu]);

	// Auto-close the share menu when the player controls auto-hide — unless the
	// cursor is currently over the menu. NOTE: signal.subscribe fires
	// immediately with the current value; in split/mini modes showControls is
	// false at open time, which used to kill the menu instantly — skip the
	// initial fire and only react to actual hide TRANSITIONS.
	useEffect(() => {
		if (!shareMenu) return;
		let initial = true;
		return showControls.subscribe((v) => {
			if (initial) {
				initial = false;
				return;
			}
			if (!v && !shareMenuHover.current) onClose();
		});
	}, [shareMenu]);

	return createPortal(
		<div
			class={styles.shareMenu}
			style={{ left: `${shareMenu.x}px`, top: `${shareMenu.y}px` }}
			onMouseDown={(e) => e.stopPropagation()}
			onContextMenu={(e) => e.preventDefault()}
			onMouseEnter={() => {
				shareMenuHover.current = true;
			}}
			onMouseLeave={() => {
				shareMenuHover.current = false;
			}}
		>
			<div class={styles.shareMenuLabel}>{formatTime(shareMenu.time)}</div>
			<button
				type="button"
				class={styles.shareMenuBtn}
				onClick={() => {
					onAddComment(shareMenu.x, shareMenu.time);
					onClose();
				}}
			>
				<Icon name="edit" size={13} />
				Add Comment
			</button>
			<Tooltip label="Copies a public link anyone can watch" delay={1000}>
				<button
					type="button"
					class={styles.shareMenuBtn}
					disabled={shareBusy}
					onClick={() => copyShareAtTime('public')}
				>
					<Icon name="globe" size={13} />
					Copy Public URL
				</button>
			</Tooltip>
			<Tooltip label="Copies a link for logged-in users" delay={1000}>
				<button
					type="button"
					class={styles.shareMenuBtn}
					disabled={shareBusy}
					onClick={() => copyShareAtTime('private')}
				>
					<Icon name="lock" size={13} />
					Copy Private URL
				</button>
			</Tooltip>
		</div>,
		document.body,
	);
}

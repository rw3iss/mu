import type { JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useUiSetting } from '@/hooks/useUiSetting';
import { sharedSessionService } from '@/services/shared-session.service';
import { currentUser } from '@/state/auth.state';
import {
	chatMessages,
	closeChatWindow,
	sessionSettings,
	showChatWindow,
} from '@/state/shared-session.state';
import styles from './SessionChatWindow.module.scss';
import { SendIcon } from './SessionIcons';

type Dock = 'floating' | 'top' | 'right' | 'bottom' | 'left';

interface FloatPos {
	x: number;
	y: number;
	w: number;
	h: number;
}

const DEFAULT_POS: FloatPos = { x: 40, y: 120, w: 320, h: 420 };
const MIN_W = 260;
const MIN_H = 240;

/**
 * Floating, draggable, resizable and dockable chat window (portal → body).
 * Closing hides it but keeps the socket subscribed, so the unread badge keeps
 * growing (the service increments `chatUnread` while `showChatWindow` is false).
 * Dock + position persist via `useUiSetting`.
 */
export function SessionChatWindow() {
	const [dock, setDock] = useUiSetting<Dock>('mu_session_chat_dock', 'floating');
	const [pos, setPos] = useUiSetting<FloatPos>('mu_session_chat_pos', DEFAULT_POS);
	const [draft, setDraft] = useState('');
	const listRef = useRef<HTMLDivElement>(null);

	const open = showChatWindow.value;

	// Backfill history each time the window is opened.
	useEffect(() => {
		if (open) void sharedSessionService.loadChatHistory();
	}, [open]);

	// Auto-scroll to the newest message.
	const msgs = chatMessages.value;
	useEffect(() => {
		if (open && listRef.current) {
			listRef.current.scrollTop = listRef.current.scrollHeight;
		}
	}, [msgs.length, open]);

	if (!open || !sessionSettings.value.enableChat) return null;

	const send = () => {
		const text = draft.trim();
		if (!text) return;
		sharedSessionService.sendChat(text);
		setDraft('');
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	};

	// ── Drag (floating only) ──
	const startDrag = (e: MouseEvent) => {
		if (dock !== 'floating') return;
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const base = { ...pos };
		const onMove = (ev: MouseEvent) => {
			const nx = Math.max(
				0,
				Math.min(window.innerWidth - 80, base.x + (ev.clientX - startX)),
			);
			const ny = Math.max(
				0,
				Math.min(window.innerHeight - 40, base.y + (ev.clientY - startY)),
			);
			setPos({ ...base, x: nx, y: ny });
		};
		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	};

	// ── Resize (floating only) ──
	const startResize = (e: MouseEvent) => {
		if (dock !== 'floating') return;
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startY = e.clientY;
		const base = { ...pos };
		const onMove = (ev: MouseEvent) => {
			const nw = Math.max(MIN_W, base.w + (ev.clientX - startX));
			const nh = Math.max(MIN_H, base.h + (ev.clientY - startY));
			setPos({ ...base, w: nw, h: nh });
		};
		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	};

	const dockClass =
		dock === 'floating'
			? styles.floating
			: dock === 'top'
				? styles.dockTop
				: dock === 'right'
					? styles.dockRight
					: dock === 'bottom'
						? styles.dockBottom
						: styles.dockLeft;

	const floatStyle: JSX.CSSProperties =
		dock === 'floating'
			? { left: `${pos.x}px`, top: `${pos.y}px`, width: `${pos.w}px`, height: `${pos.h}px` }
			: {};

	const meId = currentUser.value?.id;

	const DOCKS: { id: Dock; label: string }[] = [
		{ id: 'floating', label: 'Float' },
		{ id: 'left', label: 'Left' },
		{ id: 'top', label: 'Top' },
		{ id: 'bottom', label: 'Bottom' },
		{ id: 'right', label: 'Right' },
	];

	return createPortal(
		<div class={`${styles.window} ${dockClass}`} style={floatStyle} data-session-chat>
			<div class={styles.header} onMouseDown={startDrag}>
				<span class={styles.title}>Session Chat</span>
				<div class={styles.headerActions}>
					<select
						class={styles.dockSelect}
						value={dock}
						onMouseDown={(e) => e.stopPropagation()}
						onChange={(e) => setDock((e.target as HTMLSelectElement).value as Dock)}
						title="Dock position"
					>
						{DOCKS.map((d) => (
							<option key={d.id} value={d.id}>
								{d.label}
							</option>
						))}
					</select>
					<button
						class={styles.closeBtn}
						onClick={closeChatWindow}
						aria-label="Close chat"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
			</div>

			<div class={styles.messages} ref={listRef}>
				{msgs.length === 0 ? (
					<div class={styles.empty}>No messages yet. Say hi 👋</div>
				) : (
					msgs.map((m) => (
						<div
							key={m.id}
							class={`${styles.msg} ${m.userId === meId ? styles.msgMine : ''}`}
						>
							{m.userId !== meId && <span class={styles.msgName}>{m.name}</span>}
							<span class={styles.msgText}>{m.text}</span>
						</div>
					))
				)}
			</div>

			<div class={styles.inputRow}>
				<input
					class={styles.input}
					type="text"
					placeholder="Message…"
					value={draft}
					onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
					onKeyDown={onKeyDown}
				/>
				<button
					class={styles.sendBtn}
					onClick={send}
					disabled={!draft.trim()}
					aria-label="Send message"
				>
					<SendIcon size={16} />
				</button>
			</div>

			{dock === 'floating' && (
				<div class={styles.resizeHandle} onMouseDown={startResize} aria-hidden="true" />
			)}
		</div>,
		document.body,
	);
}

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { notifyError } from '@/state/notifications.state';
import {
	discardSnippet,
	downloadBlobAs,
	downloadSnippet,
	type RecordedSnippet,
	recordedSnippet,
	snippetExt,
	snippetFilenameBase,
	trimVideoBlob,
} from '@/state/snippet-recorder.state';
import styles from './SnippetDialog.module.scss';

function fmt(s: number): string {
	const m = Math.floor(s / 60);
	return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Force a real duration for blobs that report Infinity (WebM from MediaRecorder). */
function materializeDuration(v: HTMLVideoElement): Promise<number> {
	return new Promise((resolve) => {
		const onSeeked = () => {
			v.removeEventListener('seeked', onSeeked);
			try {
				v.currentTime = 0;
			} catch {
				/* ignore */
			}
			resolve(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
		};
		v.addEventListener('seeked', onSeeked, { once: true });
		try {
			v.currentTime = 1e101;
		} catch {
			resolve(0);
		}
	});
}

const MIN_GAP = 0.3; // min trimmed length, seconds

export function SnippetDialog() {
	const snippet = recordedSnippet.value;
	if (!snippet) return null;
	return <SnippetEditor snippet={snippet} />;
}

function SnippetEditor({ snippet }: { snippet: RecordedSnippet }) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [duration, setDuration] = useState(snippet.durationSeconds || 0);
	const [start, setStart] = useState(0);
	const [end, setEnd] = useState(snippet.durationSeconds || 0);
	const [current, setCurrent] = useState(0);
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const endRef = useRef(end);
	endRef.current = end;

	// Resolve a real duration (WebM reports Infinity) + track the playhead.
	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		let cancelled = false;
		const resolveDuration = async () => {
			let d = v.duration;
			if (!Number.isFinite(d) || d <= 0) d = await materializeDuration(v);
			if (!Number.isFinite(d) || d <= 0) d = snippet.durationSeconds || 0;
			if (cancelled || d <= 0) return;
			setDuration(d);
			// Snap `end` to the real duration while it's still at its initial
			// (untrimmed) value, so a small mismatch between the elapsed count
			// and the decoded duration doesn't read as a trim.
			const initial = snippet.durationSeconds || 0;
			setEnd((e) => (e <= 0 || Math.abs(e - initial) < 0.05 ? d : Math.min(e, d)));
		};
		if (v.readyState >= 1) void resolveDuration();
		else v.addEventListener('loadedmetadata', resolveDuration, { once: true });

		const onTime = () => {
			setCurrent(v.currentTime);
			// Stop at the trim out-point during playback.
			if (!v.paused && v.currentTime >= endRef.current - 0.03) v.pause();
		};
		v.addEventListener('timeupdate', onTime);
		return () => {
			cancelled = true;
			v.removeEventListener('timeupdate', onTime);
			v.removeEventListener('loadedmetadata', resolveDuration);
		};
	}, [snippet]);

	const isTrimmed = start > 0.05 || end < duration - 0.05;
	const trimmedLen = Math.max(0, end - start);

	const playTrim = useCallback(() => {
		const v = videoRef.current;
		if (!v) return;
		try {
			v.currentTime = start;
		} catch {
			/* ignore */
		}
		void v.play().catch(() => {});
	}, [start]);

	const handleDownload = useCallback(async () => {
		if (!isTrimmed) {
			downloadSnippet();
			return;
		}
		videoRef.current?.pause();
		setProcessing(true);
		setProgress(0);
		try {
			const out = await trimVideoBlob(
				snippet.blob,
				snippet.mimeType,
				start,
				end,
				setProgress,
			);
			downloadBlobAs(
				out,
				`${snippetFilenameBase(snippet.movieTitle)}-trimmed`,
				snippet.mimeType,
			);
		} catch {
			notifyError('Could not trim the clip — downloading the full version instead.');
			downloadSnippet();
		} finally {
			setProcessing(false);
		}
	}, [isTrimmed, snippet, start, end]);

	return (
		<Modal isOpen onClose={discardSnippet} title="Recorded Snippet" size="md">
			<div class={styles.body}>
				{/* biome-ignore lint/a11y/useMediaCaption: user's own captured clip */}
				<video ref={videoRef} class={styles.preview} src={snippet.url} controls />

				<TrimBar
					duration={duration}
					start={start}
					end={end}
					current={current}
					disabled={processing}
					onChange={(s, e) => {
						setStart(s);
						setEnd(e);
					}}
				/>

				<div class={styles.trimRow}>
					<span class={styles.trimInfo}>
						{fmt(start)} – {fmt(end)} · <strong>{fmt(trimmedLen)}</strong>
						{isTrimmed ? ' trimmed' : ''}
					</span>
					<Button variant="ghost" size="sm" onClick={playTrim} disabled={processing}>
						▶ Play selection
					</Button>
				</div>

				<div class={styles.meta}>
					{(snippet.blob.size / (1024 * 1024)).toFixed(1)} MB ·{' '}
					{snippetExt(snippet.mimeType).toUpperCase()}
				</div>

				{processing && (
					<div class={styles.progress}>
						<span>Trimming… {Math.round(progress * 100)}%</span>
						<div class={styles.progressTrack}>
							<div
								class={styles.progressFill}
								style={{ width: `${Math.round(progress * 100)}%` }}
							/>
						</div>
					</div>
				)}

				<div class={styles.actions}>
					<Button variant="ghost" onClick={discardSnippet} disabled={processing}>
						Discard
					</Button>
					<Button variant="primary" onClick={handleDownload} disabled={processing}>
						{processing ? 'Trimming…' : isTrimmed ? 'Download trimmed' : 'Download'}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

interface TrimBarProps {
	duration: number;
	start: number;
	end: number;
	current: number;
	disabled?: boolean;
	onChange: (start: number, end: number) => void;
}

function TrimBar({ duration, start, end, current, disabled, onChange }: TrimBarProps) {
	const ref = useRef<HTMLDivElement>(null);
	const dragging = useRef<'start' | 'end' | null>(null);
	if (duration <= 0) return null;

	const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

	const timeFromX = (clientX: number): number => {
		const r = ref.current?.getBoundingClientRect();
		if (!r || r.width === 0) return 0;
		const x = Math.min(r.width, Math.max(0, clientX - r.left));
		return (x / r.width) * duration;
	};

	const onDown = (which: 'start' | 'end') => (e: PointerEvent) => {
		if (disabled) return;
		e.preventDefault();
		e.stopPropagation();
		dragging.current = which;
		ref.current?.setPointerCapture?.(e.pointerId);
	};
	const onMove = (e: PointerEvent) => {
		if (!dragging.current) return;
		const t = timeFromX(e.clientX);
		if (dragging.current === 'start') onChange(Math.min(t, end - MIN_GAP), end);
		else onChange(start, Math.max(t, start + MIN_GAP));
	};
	const onUp = (e: PointerEvent) => {
		if (!dragging.current) return;
		dragging.current = null;
		ref.current?.releasePointerCapture?.(e.pointerId);
	};

	return (
		<div
			ref={ref}
			class={`${styles.trimBar} ${disabled ? styles.trimDisabled : ''}`}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onUp}
		>
			<div class={styles.trimDim} style={{ left: 0, width: pct(start) }} />
			<div class={styles.trimDim} style={{ left: pct(end), right: 0 }} />
			<div class={styles.trimSel} style={{ left: pct(start), width: pct(end - start) }} />
			<div class={styles.trimPlayhead} style={{ left: pct(current) }} />
			<div
				class={`${styles.trimHandle} ${styles.trimHandleStart}`}
				style={{ left: pct(start) }}
				onPointerDown={onDown('start')}
				role="slider"
				aria-label="Trim start"
				aria-valuenow={start}
				tabIndex={0}
			/>
			<div
				class={`${styles.trimHandle} ${styles.trimHandleEnd}`}
				style={{ left: pct(end) }}
				onPointerDown={onDown('end')}
				role="slider"
				aria-label="Trim end"
				aria-valuenow={end}
				tabIndex={0}
			/>
		</div>
	);
}

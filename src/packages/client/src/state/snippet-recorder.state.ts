import { signal } from '@preact/signals';
import { audioEngine } from '@/audio/audio-engine';
import { getActiveVideoElement } from '@/components/player/useVideoEngine';
import { notifyError, notifyInfo } from './notifications.state';

export interface RecordedSnippet {
	url: string;
	blob: Blob;
	mimeType: string;
	durationSeconds: number;
	movieTitle?: string;
}

export const isRecordingSnippet = signal(false);
/** Elapsed seconds of the in-progress recording. */
export const snippetElapsed = signal(0);
/** The finished clip, awaiting preview/download/discard (null = no dialog). */
export const recordedSnippet = signal<RecordedSnippet | null>(null);

/** Auto-stop ceiling so an in-memory Blob can't balloon unbounded. */
const MAX_SECONDS = 5 * 60;

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;
let capturedStream: MediaStream | null = null;

/** Whether this browser can record the player at all. */
export function snippetSupported(): boolean {
	if (typeof MediaRecorder === 'undefined') return false;
	const v = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
	return typeof v.captureStream === 'function' || typeof v.mozCaptureStream === 'function';
}

function pickMimeType(): string {
	const candidates = [
		// MP4 (H.264 + AAC) first — universally playable. MediaRecorder
		// supports it on modern Chrome/Edge/Safari; H.264 *encode* may be
		// absent on some Linux Chromium builds, so WebM remains the fallback.
		'video/mp4;codecs=avc1.42E01E,mp4a.40.2', // H.264 baseline + AAC-LC
		'video/mp4;codecs=avc1.640028,mp4a.40.2', // H.264 high + AAC-LC
		'video/mp4;codecs=h264,aac',
		'video/mp4',
		// WebM fallback (always available).
		'video/webm;codecs=vp9,opus',
		'video/webm;codecs=vp8,opus',
		'video/webm',
	];
	for (const c of candidates) {
		if (MediaRecorder.isTypeSupported(c)) return c;
	}
	return 'video/webm';
}

/** File extension for a recorded snippet's MIME type. */
export function snippetExt(mimeType: string): string {
	return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function captureVideoStream(video: HTMLVideoElement): MediaStream | null {
	const anyVideo = video as unknown as {
		captureStream?: () => MediaStream;
		mozCaptureStream?: () => MediaStream;
	};
	try {
		if (anyVideo.captureStream) return anyVideo.captureStream();
		if (anyVideo.mozCaptureStream) return anyVideo.mozCaptureStream();
	} catch {
		/* tainted / unsupported */
	}
	return null;
}

/** Start recording the live player output. */
export function startSnippet(movieTitle?: string): void {
	if (isRecordingSnippet.value) return;
	if (!snippetSupported()) {
		notifyError('Recording is not supported in this browser.');
		return;
	}
	const video = getActiveVideoElement();
	if (!video) {
		notifyError('No video is playing.');
		return;
	}

	const elementStream = captureVideoStream(video);
	const videoTrack = elementStream?.getVideoTracks()[0];
	if (!videoTrack) {
		notifyError('Could not capture the video.');
		return;
	}

	// Audio: prefer the effects-processed graph tap (direct-play path); fall
	// back to the element's own captured audio (HLS/blob: path).
	const graphAudio = audioEngine.createRecordingAudioTrack();
	const audioTrack = graphAudio ?? elementStream?.getAudioTracks()[0] ?? null;

	const stream = new MediaStream();
	stream.addTrack(videoTrack);
	if (audioTrack) stream.addTrack(audioTrack);
	capturedStream = stream;

	const mimeType = pickMimeType();
	try {
		recorder = new MediaRecorder(stream, { mimeType });
	} catch {
		notifyError('Failed to start recording.');
		cleanup();
		return;
	}

	chunks = [];
	recorder.ondataavailable = (e) => {
		if (e.data && e.data.size > 0) chunks.push(e.data);
	};
	recorder.onstop = () => {
		const blob = new Blob(chunks, { type: mimeType });
		const durationSeconds = snippetElapsed.value;
		cleanup();
		if (blob.size === 0) {
			notifyError('Recording was empty.');
			return;
		}
		recordedSnippet.value = {
			url: URL.createObjectURL(blob),
			blob,
			mimeType,
			durationSeconds,
			movieTitle,
		};
	};

	startedAt = Date.now();
	snippetElapsed.value = 0;
	isRecordingSnippet.value = true;
	recorder.start(1000); // gather data in 1s slices
	timer = setInterval(() => {
		snippetElapsed.value = Math.floor((Date.now() - startedAt) / 1000);
		if (snippetElapsed.value >= MAX_SECONDS) {
			notifyInfo('Recording reached the 5-minute limit.', 4000);
			stopSnippet();
		}
	}, 250);
}

/** Stop the in-progress recording; fires onstop → opens the preview dialog. */
export function stopSnippet(): void {
	if (!recorder || recorder.state === 'inactive') {
		cleanup();
		return;
	}
	try {
		recorder.stop();
	} catch {
		cleanup();
	}
}

function cleanup(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
	audioEngine.stopRecordingTap();
	// Stop only the recording tracks we created references to; the element's
	// own playback tracks are owned by the <video>, so we don't stop those.
	if (capturedStream) {
		for (const t of capturedStream.getTracks()) {
			// Don't kill the live element audio/video — capturedStream tracks
			// are clones/refs; stopping them is safe for captureStream output.
			try {
				t.stop();
			} catch {
				/* ignore */
			}
		}
	}
	capturedStream = null;
	recorder = null;
	isRecordingSnippet.value = false;
}

/** Close the preview dialog and free the Blob URL. */
export function discardSnippet(): void {
	const s = recordedSnippet.value;
	if (s) URL.revokeObjectURL(s.url);
	recordedSnippet.value = null;
}

/** Sanitised base filename for a snippet (no extension). */
export function snippetFilenameBase(movieTitle?: string): string {
	const safe = (movieTitle ?? 'snippet').replace(/[^\w.-]+/g, '_').slice(0, 60);
	return `${safe}-snippet`;
}

/** Trigger a browser download of the (full) recorded clip. */
export function downloadSnippet(): void {
	const s = recordedSnippet.value;
	if (!s) return;
	const a = document.createElement('a');
	a.href = s.url;
	a.download = `${snippetFilenameBase(s.movieTitle)}.${snippetExt(s.mimeType)}`;
	document.body.appendChild(a);
	a.click();
	a.remove();
}

/** Trigger a download of an arbitrary blob (used for the trimmed clip). */
export function downloadBlobAs(blob: Blob, filenameNoExt: string, mimeType: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${filenameNoExt}.${snippetExt(mimeType)}`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function onceEvent(el: HTMLMediaElement, ev: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const ok = () => {
			cleanup();
			resolve();
		};
		const no = () => {
			cleanup();
			reject(new Error(`${ev} failed`));
		};
		const cleanup = () => {
			el.removeEventListener(ev, ok);
			el.removeEventListener('error', no);
		};
		el.addEventListener(ev, ok, { once: true });
		el.addEventListener('error', no, { once: true });
	});
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			video.removeEventListener('seeked', done);
			resolve();
		};
		video.addEventListener('seeked', done, { once: true });
		try {
			video.currentTime = t;
		} catch {
			resolve();
		}
	});
}

/**
 * Re-encode the `[startSec, endSec]` region of a recorded clip into a new Blob,
 * fully in-browser (no server). Plays a hidden element through
 * captureStream()+MediaRecorder; audio is tapped via Web Audio so the re-encode
 * is silent to the speakers. Runs in real time (region length) — report
 * progress via `onProgress`. Throws on unsupported / blocked playback so the
 * caller can fall back to the full clip.
 */
export async function trimVideoBlob(
	blob: Blob,
	mimeType: string,
	startSec: number,
	endSec: number,
	onProgress?: (fraction: number) => void,
): Promise<Blob> {
	if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder unsupported');
	const url = URL.createObjectURL(blob);
	const video = document.createElement('video');
	video.src = url;
	video.preload = 'auto';
	(video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
	video.muted = false;
	video.volume = 1;
	let ctx: AudioContext | null = null;

	try {
		await onceEvent(video, 'loadedmetadata');

		// Audio: route through Web Audio so capture works but nothing hits the
		// speakers during the re-encode.
		let audioTrack: MediaStreamTrack | null = null;
		try {
			const AC =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: typeof AudioContext })
					.webkitAudioContext;
			if (AC) {
				ctx = new AC();
				const node = ctx.createMediaElementSource(video);
				const dest = ctx.createMediaStreamDestination();
				node.connect(dest);
				audioTrack = dest.stream.getAudioTracks()[0] ?? null;
				await ctx.resume().catch(() => {});
			}
		} catch {
			ctx = null;
		}

		const cap = (
			video as HTMLVideoElement & { captureStream?: () => MediaStream }
		).captureStream?.();
		const videoTrack = cap?.getVideoTracks()[0];
		if (!videoTrack) throw new Error('captureStream unavailable');

		const out = new MediaStream();
		out.addTrack(videoTrack);
		const at = audioTrack ?? cap?.getAudioTracks()[0] ?? null;
		if (at) out.addTrack(at);

		const recorder = new MediaRecorder(
			out,
			MediaRecorder.isTypeSupported(mimeType) ? { mimeType } : undefined,
		);
		const chunks: Blob[] = [];
		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
		const stopped = new Promise<void>((res) => {
			recorder.onstop = () => res();
		});

		await seekTo(video, startSec);
		recorder.start();
		try {
			await video.play();
		} catch {
			try {
				recorder.stop();
			} catch {
				/* ignore */
			}
			throw new Error('playback blocked');
		}

		const span = Math.max(0.1, endSec - startSec);
		await new Promise<void>((resolve) => {
			let raf = 0;
			const tick = () => {
				const t = video.currentTime;
				onProgress?.(Math.min(1, Math.max(0, (t - startSec) / span)));
				if (t >= endSec - 0.02 || video.ended) {
					cancelAnimationFrame(raf);
					resolve();
					return;
				}
				raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
		});

		try {
			video.pause();
		} catch {
			/* ignore */
		}
		if (recorder.state !== 'inactive') recorder.stop();
		await stopped;
		onProgress?.(1);
		return new Blob(chunks, { type: mimeType });
	} finally {
		try {
			video.pause();
		} catch {
			/* ignore */
		}
		video.removeAttribute('src');
		video.load();
		ctx?.close().catch(() => {});
		URL.revokeObjectURL(url);
	}
}

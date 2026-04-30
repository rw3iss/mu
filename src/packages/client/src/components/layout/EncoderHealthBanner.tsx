import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { api } from '@/services/api';
import { wsService } from '@/services/websocket.service';
import { notifyError, notifySuccess } from '@/state/notifications.state';
import styles from './EncoderHealthBanner.module.scss';

/**
 * Server-encoder health surfaced to the user.
 *
 * Goes red when the server marks `hwAccelBroken` (e.g. NVENC DLL init
 * failure on Windows, no NVENC capable devices, etc). Watches both an
 * initial fetch from `/admin/server/info` and live updates from the
 * `server` WebSocket channel.
 *
 * Dismissal is per-occurrence: clicking the close button records the
 * current `since` timestamp in localStorage. The banner re-appears
 * only if the server emits a NEWER `since` (i.e. the encoder broke
 * again after the user acknowledged the last failure).
 */

interface EncoderHealthState {
	degraded: boolean;
	since: string | null;
	reason: string | null;
}

const state = signal<EncoderHealthState>({ degraded: false, since: null, reason: null });
const DISMISSED_KEY = 'mu_encoder_banner_dismissed_until';

function isDismissed(since: string | null): boolean {
	if (!since) return false;
	try {
		const dismissed = localStorage.getItem(DISMISSED_KEY);
		if (!dismissed) return false;
		// Banner stays hidden as long as the server's reported `since`
		// is older than (or equal to) the last value the user dismissed.
		return new Date(since).getTime() <= new Date(dismissed).getTime();
	} catch {
		return false;
	}
}

function dismiss(since: string | null): void {
	if (!since) return;
	try {
		localStorage.setItem(DISMISSED_KEY, since);
	} catch {}
	state.value = { ...state.value, degraded: false };
}

async function refetch(): Promise<void> {
	try {
		const info = await api.get<{
			hwAccelBroken?: boolean;
			hwAccelBrokenSince?: string | null;
			hwAccelBrokenReason?: string | null;
		}>('/admin/server/info');
		state.value = {
			degraded: info.hwAccelBroken === true,
			since: info.hwAccelBrokenSince ?? null,
			reason: info.hwAccelBrokenReason ?? null,
		};
	} catch {
		// Non-admin or unreachable — banner just stays hidden.
	}
}

async function reset(): Promise<void> {
	try {
		await api.post('/admin/server/encoder/reset');
		notifySuccess('Hardware encoding re-enabled — next transcode will retry the GPU');
		state.value = { degraded: false, since: null, reason: null };
	} catch {
		notifyError('Failed to reset encoder state');
	}
}

export function EncoderHealthBanner() {
	useEffect(() => {
		// Initial fetch — covers the case where the flag was already set
		// before the user opened the app.
		refetch();

		// Live updates from the server.
		wsService.subscribe('server');
		const handler = (data: unknown) => {
			const payload = data as Partial<EncoderHealthState> & {
				type?: string;
				encoderDegraded?: boolean;
			};
			if (payload?.type !== 'encoder-degraded') return;
			state.value = {
				degraded: payload.encoderDegraded === true,
				since: payload.since ?? null,
				reason: payload.reason ?? null,
			};
		};
		wsService.on('server:status', handler);
		return () => {
			wsService.off('server:status', handler);
		};
	}, []);

	const s = state.value;
	if (!s.degraded || isDismissed(s.since)) return null;

	return (
		<div class={styles.banner} role="status">
			<div class={styles.icon} aria-hidden="true">
				⚠
			</div>
			<div class={styles.body}>
				<div class={styles.title}>Hardware video encoding is unavailable</div>
				<div class={styles.detail}>
					Transcoding is using software encoding for now — playback works but uses more
					CPU and may be slower.
					{s.reason && (
						<>
							{' '}
							<span class={styles.reason} title={s.reason}>
								Reason:{' '}
								{s.reason.length > 90 ? `${s.reason.slice(0, 90)}…` : s.reason}
							</span>
						</>
					)}
				</div>
			</div>
			<div class={styles.actions}>
				<button type="button" class={styles.retryBtn} onClick={reset}>
					Retry GPU
				</button>
				<button
					type="button"
					class={styles.dismissBtn}
					onClick={() => dismiss(s.since)}
					aria-label="Dismiss"
				>
					✕
				</button>
			</div>
		</div>
	);
}

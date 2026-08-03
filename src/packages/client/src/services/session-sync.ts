import type { SessionCommand } from '@mu/shared';
import { getActiveVideoElement } from '@/components/player/useVideoEngine';
import { notifyInfo } from '@/state/notifications.state';
import { sessionSettings } from '@/state/shared-session.state';
import { sharedVideoEngine } from '@/state/videoEngineRef';

/**
 * Playback sync engine for Shared Sessions.
 *
 * Applies remote {@link SessionCommand}s (play / pause / seek / heartbeat) to
 * the shared player via the video engine, and owns the periodic position
 * heartbeat that the current controller (last actor / admin) emits so laggards
 * can drift-correct.
 *
 * The player-side INTERCEPTION (wrapping the engine's togglePlay/seek so a
 * local action broadcasts a command) is done by the UI layer — this module only
 * exposes `applyRemoteCommand` (inbound) and the heartbeat timer. `applyingRemote`
 * guards against a remote apply being echoed back out as a local command.
 */

let applyingRemote = false;

/** True while a remote command is being applied (echo guard for broadcasters). */
export function isApplyingRemote(): boolean {
	return applyingRemote;
}

/** Lead added to a target position to cover this client's own start latency. */
const PLAY_DECODE_LEAD_SECONDS = 0.15;

/**
 * Apply a command received from another member to the local player.
 * Play/pause/seek are authoritative; heartbeat drives drift correction.
 */
export function applyRemoteCommand(cmd: SessionCommand): void {
	const engine = sharedVideoEngine.value;
	const video = getActiveVideoElement();
	if (!engine) return;

	applyingRemote = true;
	try {
		switch (cmd.kind) {
			case 'play': {
				const target =
					cmd.positionSeconds + transitElapsed(cmd.at) + PLAY_DECODE_LEAD_SECONDS;
				engine.seek(target);
				if (video?.paused) engine.togglePlay();
				else engine.setIntendedPlaying(true);
				notifyInfo(`${cmd.byName} played the movie`, 3000);
				break;
			}
			case 'pause': {
				if (video && !video.paused) engine.togglePlay();
				else engine.setIntendedPlaying(false);
				engine.seek(cmd.positionSeconds);
				notifyInfo(`${cmd.byName} paused the movie`, 3000);
				break;
			}
			case 'seek': {
				engine.seek(cmd.positionSeconds);
				break;
			}
			case 'heartbeat': {
				driftCorrect(cmd, engine, video);
				break;
			}
		}
	} finally {
		// Let the resulting media events settle before dropping the guard.
		setTimeout(() => {
			applyingRemote = false;
		}, 0);
	}
}

/** Seconds elapsed since a command was stamped (bounded to sane values). */
function transitElapsed(at: number): number {
	const dt = (Date.now() - at) / 1000;
	if (!Number.isFinite(dt) || dt < 0) return 0;
	return Math.min(dt, 5);
}

/**
 * Drift-correct against a controller heartbeat per the session's `syncMode`.
 * `soft` (default): ignore small drift, nudge playbackRate for medium drift,
 * hard-seek for large drift. `hard`: seek on any over-threshold drift.
 * `wait-for-all`: treated as soft locally (the controller-side pause-until-ready
 * behaviour is a server/controller concern; the local receiver still converges).
 */
function driftCorrect(
	cmd: SessionCommand,
	engine: {
		seek: (t: number) => void;
		togglePlay: () => void;
		setIntendedPlaying: (b: boolean) => void;
	},
	video: HTMLVideoElement | null,
): void {
	if (!video) return;
	const settings = sessionSettings.value;

	// Align play state with the controller first.
	if (cmd.playing === true && video.paused) {
		engine.togglePlay();
	} else if (cmd.playing === false && !video.paused) {
		engine.togglePlay();
	}

	const expected = cmd.positionSeconds + (cmd.playing ? transitElapsed(cmd.at) : 0);
	const drift = video.currentTime - expected;
	const threshold = Math.max(0.25, settings.driftThresholdSeconds);
	const absd = Math.abs(drift);

	if (absd < threshold) {
		// Converged — make sure any prior nudge is cleared.
		if (video.playbackRate !== 1) video.playbackRate = 1;
		return;
	}

	if (settings.syncMode === 'hard') {
		video.playbackRate = 1;
		engine.seek(expected);
		return;
	}

	// soft / wait-for-all: nudge for medium drift, hard-seek far past.
	if (absd <= threshold * 3) {
		// Behind (drift < 0) → speed up; ahead (drift > 0) → slow down.
		video.playbackRate = drift < 0 ? 1.05 : 0.95;
	} else {
		video.playbackRate = 1;
		engine.seek(expected);
	}
}

// ── Heartbeat (controller emits ~every 3s) ──

const HEARTBEAT_INTERVAL_MS = 3000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Start emitting position heartbeats via `broadcast`. Idempotent. */
export function startHeartbeat(broadcast: () => void): void {
	if (heartbeatTimer) return;
	heartbeatTimer = setInterval(broadcast, HEARTBEAT_INTERVAL_MS);
}

/** Stop emitting heartbeats. */
export function stopHeartbeat(): void {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

export function isHeartbeatRunning(): boolean {
	return heartbeatTimer !== null;
}

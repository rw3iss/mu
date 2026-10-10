import type { AudioStreamSession, EntityRef } from '@mu/shared';
import { audioEngine } from '@/audio/audio-engine';
import { musicService } from '@/services/music.service';
import {
	currentTime,
	duration,
	isBuffering,
	isMuted,
	isPlaying,
	volume,
} from '@/state/player.state';
import { registerPlayerAdapter } from '../registry';
import type { ControlGroupId, NowPlayingMeta, PlayerAdapter } from '../types';

/**
 * Audio (music) side of the player shell. See docs/music-support-plan.md §6.4.
 *
 * Owns two hidden `<audio>` elements (A/B). The current one plays; the next
 * queue item is preloaded on the other and swapped in on `ended`, so album
 * playback runs without a reload gap. Both elements feed the AudioEngine's
 * source bus only when Web Audio is actually needed (effects or ReplayGain) —
 * otherwise they stay on the native output path.
 *
 * This module knows nothing about queues: `state/musicPlayer.state.ts`
 * registers {@link AudioPlaybackHooks} and drives it.
 */

export interface AudioPlaybackHooks {
	/** Natural end of the current element. */
	onEnded(): void;
	/** Fired from the time loop while playing (current element only). */
	onTick(position: number, total: number): void;
	/** The current element paused (user, OS, or end of stream). */
	onPause(position: number): void;
	/** The current element failed to load / decode. */
	onError(message: string): void;
}

interface Slot {
	el: HTMLAudioElement;
	session: AudioStreamSession | null;
	/** Track id loaded on this element. */
	trackId: string | null;
	/** AudioContext the element was bound to (a closed one makes it mute). */
	boundCtx: AudioContext | null;
	/** Position to apply once metadata is in. */
	pendingSeek: number | null;
}

function createElement(): HTMLAudioElement {
	const el = document.createElement('audio');
	// REQUIRED for createMediaElementSource to receive samples.
	el.crossOrigin = 'anonymous';
	el.preload = 'auto';
	el.style.display = 'none';
	el.setAttribute('data-mu-audio', '');
	document.body.appendChild(el);
	return el;
}

class AudioPlayback {
	private slots: [Slot, Slot] | null = null;
	private cur = 0;
	private hooks: AudioPlaybackHooks | null = null;
	private raf: number | null = null;
	/** True while the audio adapter owns the shell's generic player signals. */
	private active = false;
	/** Suppresses the pause signal while swapping / tearing down. */
	private quiet = false;

	setHooks(hooks: AudioPlaybackHooks): void {
		this.hooks = hooks;
	}

	/**
	 * Whether element events write the shared player signals (isPlaying,
	 * currentTime, …). Off while a video owns the shell.
	 */
	setActive(on: boolean): void {
		this.active = on;
		if (on) this.syncSignals();
		else this.stopLoop();
	}

	isActive(): boolean {
		return this.active;
	}

	private ensure(): [Slot, Slot] {
		if (!this.slots) {
			this.slots = [this.makeSlot(), this.makeSlot()];
		}
		return this.slots;
	}

	private makeSlot(): Slot {
		const slot: Slot = {
			el: createElement(),
			session: null,
			trackId: null,
			boundCtx: null,
			pendingSeek: null,
		};
		this.wire(slot);
		return slot;
	}

	private isCurrent(slot: Slot): boolean {
		return !!this.slots && this.slots[this.cur] === slot;
	}

	private wire(slot: Slot): void {
		const el = slot.el;
		el.addEventListener('loadedmetadata', () => {
			if (slot.pendingSeek != null) {
				const t = slot.pendingSeek;
				slot.pendingSeek = null;
				try {
					el.currentTime = t;
				} catch {}
			}
			if (this.isCurrent(slot) && this.active) this.syncDuration(slot);
		});
		el.addEventListener('durationchange', () => {
			if (this.isCurrent(slot) && this.active) this.syncDuration(slot);
		});
		el.addEventListener('play', () => {
			if (!this.isCurrent(slot) || !this.active) return;
			isPlaying.value = true;
			void audioEngine.resume();
			audioEngine.setPlaybackActive(true);
			this.startLoop();
		});
		el.addEventListener('pause', () => {
			if (!this.isCurrent(slot) || !this.active || this.quiet) return;
			isPlaying.value = false;
			audioEngine.setPlaybackActive(false);
			this.stopLoop();
			currentTime.value = el.currentTime;
			this.hooks?.onPause(el.currentTime);
		});
		el.addEventListener('waiting', () => {
			if (this.isCurrent(slot) && this.active) isBuffering.value = true;
		});
		const ready = () => {
			if (this.isCurrent(slot) && this.active) isBuffering.value = false;
		};
		el.addEventListener('canplay', ready);
		el.addEventListener('playing', ready);
		el.addEventListener('seeked', () => {
			if (this.isCurrent(slot) && this.active) currentTime.value = el.currentTime;
		});
		el.addEventListener('ended', () => {
			if (!this.isCurrent(slot) || !this.active) return;
			this.stopLoop();
			this.hooks?.onEnded();
		});
		el.addEventListener('error', () => {
			if (!this.isCurrent(slot) || !el.getAttribute('src')) return;
			isBuffering.value = false;
			const code = el.error?.code;
			this.hooks?.onError(
				code === 4 ? 'This track format cannot be played.' : 'Failed to load track.',
			);
		});
	}

	private syncDuration(slot: Slot): void {
		const d = slot.el.duration;
		if (Number.isFinite(d) && d > 0) duration.value = d;
		else if (slot.session?.durationSeconds) duration.value = slot.session.durationSeconds;
	}

	private syncSignals(): void {
		const slot = this.slots?.[this.cur];
		if (!slot) return;
		currentTime.value = slot.el.currentTime || slot.pendingSeek || 0;
		this.syncDuration(slot);
		isPlaying.value = !slot.el.paused;
		isBuffering.value = false;
		if (!slot.el.paused) this.startLoop();
	}

	private startLoop(): void {
		if (this.raf !== null) return;
		const tick = () => {
			const slot = this.slots?.[this.cur];
			if (!slot || !this.active) {
				this.raf = null;
				return;
			}
			const t = slot.el.currentTime;
			currentTime.value = t;
			const total = Number.isFinite(slot.el.duration)
				? slot.el.duration
				: (slot.session?.durationSeconds ?? 0);
			this.hooks?.onTick(t, total);
			this.raf = requestAnimationFrame(tick);
		};
		this.raf = requestAnimationFrame(tick);
	}

	private stopLoop(): void {
		if (this.raf !== null) cancelAnimationFrame(this.raf);
		this.raf = null;
	}

	/** The element that is (or would be) playing now. */
	currentElement(): HTMLAudioElement | null {
		return this.slots?.[this.cur]?.el ?? null;
	}

	currentSession(): AudioStreamSession | null {
		return this.slots?.[this.cur]?.session ?? null;
	}

	currentTrackId(): string | null {
		return this.slots?.[this.cur]?.trackId ?? null;
	}

	position(): number {
		const slot = this.slots?.[this.cur];
		if (!slot) return 0;
		return slot.pendingSeek ?? slot.el.currentTime ?? 0;
	}

	isPaused(): boolean {
		return this.slots?.[this.cur]?.el.paused ?? true;
	}

	/**
	 * An element that was bound to a now-closed AudioContext (after an audio
	 * reset) is permanently silent — replace it with a fresh one.
	 */
	private ensureUsable(index: number): Slot {
		const slots = this.ensure();
		const slot = slots[index]!;
		if (slot.boundCtx && slot.boundCtx !== audioEngine.getContext()) {
			const fresh = this.makeSlot();
			const src = slot.el.getAttribute('src');
			fresh.session = slot.session;
			fresh.trackId = slot.trackId;
			if (src) {
				fresh.pendingSeek = slot.el.currentTime || slot.pendingSeek;
				fresh.el.src = src;
			}
			this.quiet = true;
			slot.el.pause();
			slot.el.removeAttribute('src');
			slot.el.load();
			slot.el.remove();
			this.quiet = false;
			slots[index] = fresh;
			return fresh;
		}
		return slot;
	}

	/** Load a session into the current element and optionally start it. */
	load(
		trackId: string,
		session: AudioStreamSession,
		startPosition: number,
		autoplay: boolean,
	): void {
		const slot = this.ensureUsable(this.cur);
		this.quiet = true;
		slot.el.pause();
		this.quiet = false;
		slot.session = session;
		slot.trackId = trackId;
		slot.pendingSeek = startPosition > 0 ? startPosition : null;
		slot.el.src = session.streamUrl;
		slot.el.load();
		this.applyVolume();
		if (this.active) {
			currentTime.value = startPosition;
			if (session.durationSeconds) duration.value = session.durationSeconds;
			isBuffering.value = autoplay;
		}
		if (audioEngine.hasSource(slot.el)) audioEngine.setActiveSource(slot.el);
		if (autoplay) this.play();
	}

	play(): void {
		const slot = this.slots?.[this.cur];
		if (!slot?.el.getAttribute('src')) return;
		void audioEngine.resume();
		slot.el.play().catch((err: unknown) => {
			// NotAllowedError = autoplay policy (e.g. after a refresh); the
			// user's next click on play resumes.
			if ((err as { name?: string })?.name !== 'AbortError' && this.active) {
				isPlaying.value = false;
				isBuffering.value = false;
			}
		});
	}

	pause(): void {
		this.slots?.[this.cur]?.el.pause();
	}

	seek(t: number): void {
		const slot = this.slots?.[this.cur];
		if (!slot) return;
		const total = Number.isFinite(slot.el.duration)
			? slot.el.duration
			: (slot.session?.durationSeconds ?? t);
		const target = Math.max(0, Math.min(t, total || t));
		if (slot.el.readyState < 1) {
			slot.pendingSeek = target;
		} else {
			try {
				slot.el.currentTime = target;
			} catch {}
		}
		if (this.active) currentTime.value = target;
	}

	// ── Gapless preload ──

	/** Track id preloaded on the idle element, or null. */
	preloadedTrackId(): string | null {
		const other = this.slots?.[1 - this.cur];
		return other?.trackId ?? null;
	}

	preload(trackId: string, session: AudioStreamSession): void {
		const idx = 1 - this.cur;
		const slot = this.ensureUsable(idx);
		slot.session = session;
		slot.trackId = trackId;
		slot.pendingSeek = null;
		slot.el.src = session.streamUrl;
		slot.el.load();
		this.applyVolume();
	}

	clearPreload(): void {
		const other = this.slots?.[1 - this.cur];
		if (!other) return;
		other.session = null;
		other.trackId = null;
		other.pendingSeek = null;
		if (other.el.getAttribute('src')) {
			other.el.removeAttribute('src');
			other.el.load();
		}
	}

	/**
	 * Swap the preloaded element in and start it. Returns its session, or
	 * null when nothing usable is preloaded.
	 */
	swapToPreloaded(): AudioStreamSession | null {
		if (!this.slots) return null;
		const idx = 1 - this.cur;
		const next = this.ensureUsable(idx);
		if (!next.session || !next.el.getAttribute('src')) return null;
		const prev = this.slots[this.cur]!;
		this.quiet = true;
		prev.el.pause();
		this.quiet = false;
		this.cur = idx;
		if (audioEngine.hasSource(next.el)) audioEngine.setActiveSource(next.el);
		next.el.currentTime = 0;
		if (this.active) {
			currentTime.value = 0;
			this.syncDuration(next);
		}
		this.play();
		// Free the old element's decoder + connection; it becomes the next
		// preload target.
		prev.session = null;
		prev.trackId = null;
		prev.el.removeAttribute('src');
		prev.el.load();
		return next.session;
	}

	/** Stop both elements and drop their sources. */
	stop(): void {
		this.stopLoop();
		if (!this.slots) return;
		this.quiet = true;
		for (const slot of this.slots) {
			slot.el.pause();
			slot.session = null;
			slot.trackId = null;
			slot.pendingSeek = null;
			if (slot.el.getAttribute('src')) {
				slot.el.removeAttribute('src');
				slot.el.load();
			}
		}
		this.quiet = false;
	}

	// ── Web Audio / volume ──

	/** Put both elements on the engine bus (effects or ReplayGain need it). */
	attachToEngine(): void {
		if (!this.slots) return;
		for (let i = 0; i < 2; i++) {
			const slot = this.ensureUsable(i);
			if (audioEngine.hasSource(slot.el)) continue;
			if (audioEngine.attachSource(slot.el)) slot.boundCtx = audioEngine.getContext();
		}
		const current = this.slots[this.cur]!;
		if (audioEngine.hasSource(current.el)) audioEngine.setActiveSource(current.el);
		this.applyVolume();
	}

	/** Volume/mute: master gain when on the bus, element volume otherwise. */
	applyVolume(): void {
		if (!this.slots) return;
		const v = Number.isFinite(volume.value) ? Math.max(0, Math.min(1, volume.value)) : 1;
		let onBus = false;
		for (const slot of this.slots) {
			if (audioEngine.hasSource(slot.el)) {
				onBus = true;
				slot.el.muted = false;
				slot.el.volume = 1;
			} else {
				slot.el.volume = v;
				slot.el.muted = isMuted.value;
			}
		}
		if (onBus && this.active) audioEngine.setMasterOutput(v, isMuted.value);
	}

	/**
	 * Recover from an audio reset: the engine was destroyed, so both elements
	 * are bound to a dead context. Replace them and resume where we were.
	 */
	resetElements(): void {
		if (!this.slots) return;
		const slot = this.slots[this.cur]!;
		const wasPlaying = !slot.el.paused;
		const pos = slot.el.currentTime;
		const { session, trackId } = slot;
		audioEngine.destroy();
		this.quiet = true;
		for (const s of this.slots) {
			s.el.pause();
			s.el.removeAttribute('src');
			s.el.load();
			s.el.remove();
		}
		this.quiet = false;
		this.slots = null;
		this.cur = 0;
		if (session && trackId) this.load(trackId, session, pos, wasPlaying);
	}
}

/** Singleton A/B element engine for music. */
export const audioPlayback = new AudioPlayback();

/** The music toolbar. See `ControlGroupId` for zone placement. */
export const AUDIO_TOOLBAR: ControlGroupId[] = [
	'waveform',
	'trackTitle',
	'trackTransport',
	'shuffle',
	'repeat',
	'queue',
	'effects',
	'volume',
	'settings',
	'expand',
];

/** End-of-track hook, set by musicPlayer.state (avoids an import cycle). */
export const audioAdapterHooks: { onEnded: (() => void) | null } = { onEnded: null };

export const audioAdapter: PlayerAdapter = {
	kind: 'audio',

	async loadMeta(ref: EntityRef): Promise<NowPlayingMeta> {
		if (ref.type === 'album') {
			const a = await musicService.album(ref.id);
			return {
				ref,
				title: a.title,
				subtitle: a.artistCredit,
				artUrl: a.artUrl,
				links: [{ label: 'Album', href: `/album/${a.id}` }],
			};
		}
		if (ref.type === 'artist') {
			const a = await musicService.artist(ref.id);
			return {
				ref,
				title: a.name,
				artUrl: a.imageUrl,
				links: [{ label: 'Artist', href: `/artist/${a.id}` }],
			};
		}
		const t = await musicService.track(ref.id);
		return {
			ref,
			title: t.title,
			subtitle: [t.artistCredit, t.albumTitle].filter(Boolean).join(' · '),
			artUrl: t.artUrl,
			links: [
				{ label: 'Track', href: `/track/${t.id}` },
				{ label: 'Album', href: `/album/${t.albumId}` },
			],
		};
	},

	startStream(ref: EntityRef) {
		return musicService.startStream(ref.id);
	},

	onEnded() {
		audioAdapterHooks.onEnded?.();
	},

	toolbar: AUDIO_TOOLBAR,
	panels: [
		{ id: 'upnext', label: 'Up Next' },
		{ id: 'album', label: 'Album' },
		{ id: 'playlist', label: 'Playlist' },
		{ id: 'recommended', label: 'Recommended' },
		{ id: 'lyrics', label: 'Lyrics' },
	],
	surface: 'artwork',
};

registerPlayerAdapter(audioAdapter);

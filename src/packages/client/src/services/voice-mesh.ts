import type { RTCIceServerConfig, SharedSessionPresence, SignalMessage } from '@mu/shared';
import { peerPresence } from '@/state/shared-session.state';

/**
 * WebRTC voice mesh for Shared Sessions.
 *
 * Each member holds one {@link RTCPeerConnection} to every other member
 * (full mesh — fine for the small parties this feature targets). The LOCAL
 * processed mic track (from `MicAudioEngine`) is added to every connection;
 * remote tracks are attached to hidden `<audio>` elements so peer voice plays
 * independently of the movie audio.
 *
 * Signaling (offer/answer/ICE) is relayed as {@link SignalMessage}s over the
 * session WebSocket channel by the caller (`shared-session.service.ts`), which
 * feeds inbound signals back in via {@link handleSignal}.
 *
 * Glare avoidance: for any pair, the peer with the lexicographically SMALLER
 * userId is the offerer; the other side only ever answers. This is deterministic
 * regardless of who joined first, so no rollback/negotiation-needed dance is
 * required.
 */

interface PeerEntry {
	pc: RTCPeerConnection;
	audioEl: HTMLAudioElement;
	/** True if we are the offerer for this pair. */
	initiator: boolean;
	remoteStream: MediaStream | null;
	sender: RTCRtpSender | null;
}

export interface VoiceMeshOptions {
	sessionId: string;
	localUserId: string;
	iceServers: RTCIceServerConfig[];
	/** The processed local mic track (or null while muted-before-start). */
	getLocalTrack: () => MediaStreamTrack | null;
	/** Send a signaling envelope to a specific peer over the session channel. */
	sendSignal: (msg: SignalMessage) => void;
}

/** Target Opus bitrate for "phone-call efficient but decent" voice. */
const OPUS_MAX_BITRATE = 24000;
/** RMS byte level (0..~128) above which a peer is considered "talking". */
const SPEAKING_THRESHOLD = 8;

export class VoiceMesh {
	private opts: VoiceMeshOptions | null = null;
	private peers = new Map<string, PeerEntry>();
	private allMuted = false;
	private perPeerMuted = new Set<string>();

	// Voice-activity detection.
	private vadCtx: AudioContext | null = null;
	private vadNodes = new Map<string, AnalyserNode>();
	private vadTimer: ReturnType<typeof setInterval> | null = null;
	private localStream: MediaStream | null = null;

	init(opts: VoiceMeshOptions): void {
		this.opts = opts;
		this.startVadLoop();
		// Local voice-activity tap (so "you're talking" shows for yourself too).
		const local = opts.getLocalTrack();
		if (local) this.attachLocalVad(local);
	}

	/**
	 * Reconcile the mesh against the current joined roster: open a connection to
	 * every member we don't have yet, and drop connections to members who left.
	 * `memberIds` should EXCLUDE the local user.
	 */
	syncPeers(memberIds: string[]): void {
		if (!this.opts) return;
		const wanted = new Set(memberIds.filter((id) => id !== this.opts!.localUserId));
		for (const id of wanted) {
			if (!this.peers.has(id)) this.createPeer(id);
		}
		for (const id of [...this.peers.keys()]) {
			if (!wanted.has(id)) this.removePeer(id);
		}
	}

	/** Replace the outgoing mic track on every peer (device swap / (un)mute-by-track). */
	replaceLocalTrack(track: MediaStreamTrack | null): void {
		for (const entry of this.peers.values()) {
			entry.sender?.replaceTrack(track).catch(() => {});
		}
		if (track) this.attachLocalVad(track);
	}

	/** Mute/unmute ALL incoming peer audio (local playback only). */
	setAllMuted(muted: boolean): void {
		this.allMuted = muted;
		for (const [id, entry] of this.peers) {
			entry.audioEl.muted = muted || this.perPeerMuted.has(id);
		}
	}

	/** Mute/unmute one peer's incoming audio. */
	setPeerMuted(peerId: string, muted: boolean): void {
		if (muted) this.perPeerMuted.add(peerId);
		else this.perPeerMuted.delete(peerId);
		const entry = this.peers.get(peerId);
		if (entry) entry.audioEl.muted = this.allMuted || muted;
	}

	/** Handle an inbound signaling message routed to us. */
	async handleSignal(msg: SignalMessage): Promise<void> {
		if (!this.opts || msg.toUserId !== this.opts.localUserId) return;
		const peerId = msg.fromUserId;
		let entry = this.peers.get(peerId);
		if (!entry) entry = this.createPeer(peerId, /*deferOffer*/ true);

		try {
			if (msg.kind === 'offer') {
				await entry.pc.setRemoteDescription(
					new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit),
				);
				const answer = await entry.pc.createAnswer();
				answer.sdp = answer.sdp ? this.mungeOpusSdp(answer.sdp) : answer.sdp;
				await entry.pc.setLocalDescription(answer);
				this.opts.sendSignal({
					sessionId: this.opts.sessionId,
					fromUserId: this.opts.localUserId,
					toUserId: peerId,
					kind: 'answer',
					payload: entry.pc.localDescription,
				});
			} else if (msg.kind === 'answer') {
				await entry.pc.setRemoteDescription(
					new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit),
				);
			} else if (msg.kind === 'ice') {
				await entry.pc.addIceCandidate(
					new RTCIceCandidate(msg.payload as RTCIceCandidateInit),
				);
			}
		} catch {
			/* transient negotiation error — the mesh self-heals on the next sync */
		}
	}

	/** Tear down every peer connection + VAD. */
	teardown(): void {
		if (this.vadTimer) {
			clearInterval(this.vadTimer);
			this.vadTimer = null;
		}
		for (const id of [...this.peers.keys()]) this.removePeer(id);
		this.vadNodes.clear();
		if (this.vadCtx) {
			this.vadCtx.close().catch(() => {});
			this.vadCtx = null;
		}
		this.localStream = null;
		this.perPeerMuted.clear();
		this.allMuted = false;
		this.opts = null;
	}

	// ── Private ──

	private createPeer(peerId: string, deferOffer = false): PeerEntry {
		const opts = this.opts!;
		const pc = new RTCPeerConnection({ iceServers: opts.iceServers });
		const audioEl = document.createElement('audio');
		audioEl.autoplay = true;
		audioEl.muted = this.allMuted || this.perPeerMuted.has(peerId);
		audioEl.style.display = 'none';
		document.body.appendChild(audioEl);

		const initiator = opts.localUserId < peerId;
		const entry: PeerEntry = { pc, audioEl, initiator, remoteStream: null, sender: null };
		this.peers.set(peerId, entry);

		// Add the local processed mic track.
		const track = opts.getLocalTrack();
		if (track) {
			const stream = new MediaStream([track]);
			entry.sender = pc.addTrack(track, stream);
		} else {
			// No mic yet — still create a sendrecv transceiver so we can add later.
			const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
			entry.sender = tr.sender;
		}
		this.tuneOpusSender(entry.sender);

		pc.onicecandidate = (ev) => {
			if (ev.candidate) {
				opts.sendSignal({
					sessionId: opts.sessionId,
					fromUserId: opts.localUserId,
					toUserId: peerId,
					kind: 'ice',
					payload: ev.candidate.toJSON(),
				});
			}
		};

		pc.ontrack = (ev) => {
			const stream = ev.streams[0] ?? new MediaStream([ev.track]);
			entry.remoteStream = stream;
			entry.audioEl.srcObject = stream;
			entry.audioEl.play().catch(() => {});
			this.attachRemoteVad(peerId, stream);
			this.updatePresence(peerId, { ready: true });
		};

		pc.onconnectionstatechange = () => {
			const s = pc.connectionState;
			if (s === 'connected') this.updatePresence(peerId, { ready: true });
			if (s === 'failed' || s === 'closed' || s === 'disconnected') {
				this.updatePresence(peerId, { ready: false, speaking: false });
			}
		};

		if (initiator && !deferOffer) void this.makeOffer(peerId, entry);
		return entry;
	}

	private async makeOffer(peerId: string, entry: PeerEntry): Promise<void> {
		const opts = this.opts!;
		try {
			const offer = await entry.pc.createOffer();
			offer.sdp = offer.sdp ? this.mungeOpusSdp(offer.sdp) : offer.sdp;
			await entry.pc.setLocalDescription(offer);
			opts.sendSignal({
				sessionId: opts.sessionId,
				fromUserId: opts.localUserId,
				toUserId: peerId,
				kind: 'offer',
				payload: entry.pc.localDescription,
			});
		} catch {
			/* ignore — resync will retry */
		}
	}

	private removePeer(peerId: string): void {
		const entry = this.peers.get(peerId);
		if (!entry) return;
		try {
			entry.pc.close();
		} catch {
			/* ignore */
		}
		entry.audioEl.srcObject = null;
		entry.audioEl.remove();
		this.peers.delete(peerId);
		const analyser = this.vadNodes.get(peerId);
		if (analyser) {
			try {
				analyser.disconnect();
			} catch {
				/* ignore */
			}
			this.vadNodes.delete(peerId);
		}
		this.clearPresence(peerId);
	}

	// ── Opus tuning ──

	private tuneOpusSender(sender: RTCRtpSender | null): void {
		if (!sender) return;
		try {
			const params = sender.getParameters();
			if (!params.encodings || params.encodings.length === 0) {
				params.encodings = [{}];
			}
			for (const enc of params.encodings) {
				enc.maxBitrate = OPUS_MAX_BITRATE;
				// dtx is non-standard on the params type but honoured by Chrome.
				(enc as RTCRtpEncodingParameters & { dtx?: 'enabled' | 'disabled' }).dtx =
					'enabled';
			}
			void sender.setParameters(params).catch(() => {});
		} catch {
			/* setParameters can throw before negotiation — safe to skip */
		}
	}

	/**
	 * Force mono + DTX + inband-FEC + a bitrate cap on the Opus fmtp line so the
	 * mesh stays light. `setParameters` covers bitrate; SDP munging covers the
	 * codec-level flags that have no programmatic API.
	 */
	private mungeOpusSdp(sdp: string): string {
		const lines = sdp.split(/\r\n|\n/);
		// Find the Opus payload type.
		let opusPt: string | null = null;
		for (const line of lines) {
			const m = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
			if (m) {
				opusPt = m[1] ?? null;
				break;
			}
		}
		if (!opusPt) return sdp;

		const extras = [
			'stereo=0',
			'sprop-stereo=0',
			'usedtx=1',
			'useinbandfec=1',
			`maxaveragebitrate=${OPUS_MAX_BITRATE}`,
		];
		const out: string[] = [];
		let patched = false;
		for (const line of lines) {
			const fmtp = line.match(new RegExp(`^a=fmtp:${opusPt}\\s+(.*)$`));
			if (fmtp) {
				const existing = (fmtp[1] ?? '')
					.split(';')
					.map((s) => s.trim())
					.filter(Boolean);
				const keys = new Set(existing.map((kv) => kv.split('=')[0]));
				for (const e of extras) {
					const k = e.split('=')[0]!;
					if (!keys.has(k)) existing.push(e);
				}
				out.push(`a=fmtp:${opusPt} ${existing.join(';')}`);
				patched = true;
			} else {
				out.push(line);
			}
		}
		if (!patched) {
			// No fmtp line for Opus — inject one right after its rtpmap.
			const final: string[] = [];
			for (const line of out) {
				final.push(line);
				if (new RegExp(`^a=rtpmap:${opusPt}\\s+opus`, 'i').test(line)) {
					final.push(`a=fmtp:${opusPt} ${extras.join(';')}`);
				}
			}
			return final.join('\r\n');
		}
		return out.join('\r\n');
	}

	// ── Voice-activity detection ──

	private ensureVadCtx(): AudioContext {
		if (!this.vadCtx) this.vadCtx = new AudioContext();
		return this.vadCtx;
	}

	private attachLocalVad(track: MediaStreamTrack): void {
		if (!this.opts) return;
		this.localStream = new MediaStream([track]);
		this.attachVad(this.opts.localUserId, this.localStream);
	}

	private attachRemoteVad(peerId: string, stream: MediaStream): void {
		this.attachVad(peerId, stream);
	}

	private attachVad(userId: string, stream: MediaStream): void {
		try {
			const ctx = this.ensureVadCtx();
			const src = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			src.connect(analyser);
			// Replace any prior analyser for this user.
			const prev = this.vadNodes.get(userId);
			if (prev) {
				try {
					prev.disconnect();
				} catch {
					/* ignore */
				}
			}
			this.vadNodes.set(userId, analyser);
		} catch {
			/* getUserMedia/context race — VAD is best-effort */
		}
	}

	private startVadLoop(): void {
		if (this.vadTimer) return;
		const buf = new Uint8Array(256);
		this.vadTimer = setInterval(() => {
			for (const [userId, analyser] of this.vadNodes) {
				analyser.getByteTimeDomainData(buf);
				let peak = 0;
				for (let i = 0; i < buf.length; i++) {
					const d = Math.abs((buf[i] ?? 128) - 128);
					if (d > peak) peak = d;
				}
				const speaking = peak > SPEAKING_THRESHOLD;
				const cur = peerPresence.value[userId];
				if (!cur || cur.speaking !== speaking) {
					this.updatePresence(userId, { speaking });
				}
			}
		}, 200);
	}

	private updatePresence(userId: string, patch: Partial<SharedSessionPresence>): void {
		const cur: SharedSessionPresence = peerPresence.value[userId] ?? {
			userId,
			muted: false,
			speaking: false,
			ready: false,
			buffering: false,
		};
		peerPresence.value = { ...peerPresence.value, [userId]: { ...cur, ...patch } };
	}

	private clearPresence(userId: string): void {
		if (!(userId in peerPresence.value)) return;
		const next = { ...peerPresence.value };
		delete next[userId];
		peerPresence.value = next;
	}
}

export const voiceMesh = new VoiceMesh();

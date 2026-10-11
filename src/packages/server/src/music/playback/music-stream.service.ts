import { randomUUID } from 'node:crypto';
import { AUDIO_QUALITIES, type AudioQuality, type AudioStreamSession, nowISO } from '@mu/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { playHistory, trackFiles, tracks } from '../../database/schema/index.js';
import { MusicQueryService } from '../library/music-query.service.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { AudioTranscodeService } from './audio-transcode.service.js';
import { codecKey, parseCaps, planStream, policyOf, type StreamPlan } from './playability.js';

const QUALITIES: readonly AudioQuality[] = AUDIO_QUALITIES;

function asQuality(v: string | undefined, fallback: AudioQuality): AudioQuality {
	return QUALITIES.includes(v as AudioQuality) ? (v as AudioQuality) : fallback;
}

/**
 * Audio streaming. Sessions are stateless: the session id embeds the track id
 * (`<trackId>.<nonce>`) and file URLs carry their own profile + capability
 * list, so a server restart mid-song doesn't break the <audio> element, and
 * the same file+quality always has the same URL (offline caching keys on it).
 */
@Injectable()
export class MusicStreamService {
	constructor(
		private readonly database: DatabaseService,
		private readonly query: MusicQueryService,
		private readonly transcoder: AudioTranscodeService,
		private readonly musicSettings: MusicSettingsService,
	) {}

	private plan(
		file: typeof trackFiles.$inferSelect,
		profile: AudioQuality,
		caps: string,
	): StreamPlan {
		const s = this.musicSettings.get();
		return planStream(
			{
				codec: codecKey(file.codec, file.container),
				bitrate: file.bitrate,
				sampleRate: file.sampleRate,
				bitDepth: file.bitDepth,
			},
			profile,
			s.maxProfile,
			parseCaps(caps),
			s.bitrates,
			policyOf(s),
		);
	}

	start(trackId: string, opts: { profile?: string; caps?: string }): AudioStreamSession {
		const file = this.query.bestFile(trackId);
		if (!file) throw new NotFoundException(`No playable file for track ${trackId}`);
		const settings = this.musicSettings.get();
		const profile = asQuality(opts.profile, settings.defaultProfile);
		const caps = (opts.caps ?? '').replace(/[^a-z0-9,]/gi, '').slice(0, 120);
		const plan = this.plan(file, profile, caps);
		const qs = new URLSearchParams({ p: plan.profile, c: caps }).toString();
		return {
			sessionId: `${trackId}.${randomUUID().slice(0, 8)}`,
			ref: { type: 'track', id: trackId },
			trackFileId: file.id,
			streamUrl: `/api/v1/music/files/${file.id}?${qs}`,
			profile: plan.profile,
			original: plan.mode === 'original',
			codec: plan.mode === 'original' ? file.codec : (plan.target?.codec ?? null),
			durationSeconds: file.durationSeconds,
			startPosition: 0,
			replayGainTrack: file.replaygainTrack,
			replayGainAlbum: file.replaygainAlbum,
			waveformUrl: settings.waveforms ? `/api/v1/music/waveform/${file.id}` : null,
			...delivered(file, plan),
		};
	}

	/** Resolve the bytes for a file URL: the original, or a (built-on-demand) transcode. */
	async resolveFile(
		trackFileId: string,
		profile: string | undefined,
		caps: string | undefined,
	): Promise<string> {
		const file = this.database.db
			.select()
			.from(trackFiles)
			.where(eq(trackFiles.id, trackFileId))
			.get();
		if (!file || !file.available)
			throw new NotFoundException(`Track file ${trackFileId} not found`);
		const plan = this.plan(
			file,
			asQuality(profile, this.musicSettings.get().defaultProfile),
			caps ?? '',
		);
		if (plan.mode === 'original') return file.filePath;
		const cached = this.transcoder.cachedPath(file.id, plan);
		if (cached) return cached;
		// Build-then-serve. Audio encodes run at many times realtime (a 4-min
		// track to Opus ≈ 1 s), so even long mixes are a short wait — simpler
		// and range-request friendly versus piping a live encode.
		return this.transcoder.build(file.id, file.filePath, plan);
	}

	async waveform(trackFileId: string) {
		if (!this.musicSettings.get().waveforms)
			throw new NotFoundException('Waveforms are disabled');
		const cached = await this.transcoder.readWaveform(trackFileId);
		if (cached) return cached;
		const file = this.database.db
			.select()
			.from(trackFiles)
			.where(eq(trackFiles.id, trackFileId))
			.get();
		if (!file?.durationSeconds)
			throw new NotFoundException(`Track file ${trackFileId} not found`);
		const data = await this.transcoder.buildWaveform(
			file.id,
			file.filePath,
			file.durationSeconds,
		);
		this.database.db
			.update(trackFiles)
			.set({ waveformPath: this.transcoder.waveformPath(file.id) })
			.where(eq(trackFiles.id, file.id))
			.run();
		return data;
	}

	/** Record listening progress in play_history; bump play counts on completion. */
	progress(userId: string, sessionId: string, positionSeconds: number, completed: boolean): void {
		const trackId = sessionId.split('.')[0] ?? '';
		if (!trackId) throw new BadRequestException('Invalid session');
		const track = this.database.db
			.select({ id: tracks.id })
			.from(tracks)
			.where(eq(tracks.id, trackId))
			.get();
		if (!track) throw new NotFoundException(`Track ${trackId} not found`);
		const db = this.database.db;
		const now = nowISO();
		const pos = Math.max(0, Math.round(positionSeconds));
		const existing = db
			.select()
			.from(playHistory)
			.where(
				and(
					eq(playHistory.userId, userId),
					eq(playHistory.entityType, 'track'),
					eq(playHistory.entityId, trackId),
				),
			)
			.get();
		if (existing) {
			db.update(playHistory)
				.set({
					positionSeconds: completed ? 0 : pos,
					completed: completed || existing.completed,
					playCount: (existing.playCount ?? 0) + (completed ? 1 : 0),
					lastPlayedAt: now,
				})
				.where(eq(playHistory.id, existing.id))
				.run();
		} else {
			db.insert(playHistory)
				.values({
					id: randomUUID(),
					userId,
					entityType: 'track',
					entityId: trackId,
					positionSeconds: completed ? 0 : pos,
					completed,
					playCount: completed ? 1 : 0,
					lastPlayedAt: now,
				})
				.run();
		}
		if (completed) {
			db.update(tracks)
				.set({ playCount: sql`${tracks.playCount} + 1` })
				.where(eq(tracks.id, trackId))
				.run();
		}
	}
}

/** Sample rate / bit depth / bitrate of what the plan actually sends. */
function delivered(
	file: { sampleRate: number | null; bitDepth: number | null; bitrate: number | null },
	plan: StreamPlan,
): { sampleRate: number | null; bitDepth: number | null; bitrateKbps: number | null } {
	if (plan.mode === 'original' || !plan.target) {
		return {
			sampleRate: file.sampleRate,
			bitDepth: file.bitDepth,
			bitrateKbps: file.bitrate ? Math.round(file.bitrate / 1000) : null,
		};
	}
	const t = plan.target;
	const lossless = t.codec === 'flac';
	return {
		sampleRate: t.sampleRate ?? file.sampleRate,
		bitDepth: lossless ? (t.bitDepth ?? file.bitDepth) : null,
		// MP3 V0 averages ~245 kbps.
		bitrateKbps: lossless ? null : (t.bitrateKbps ?? (t.vbrQuality === 0 ? 245 : null)),
	};
}

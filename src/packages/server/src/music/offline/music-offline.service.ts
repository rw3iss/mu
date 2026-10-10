import type { MusicOfflineItem, MusicOfflinePolicy, MusicOfflineTokenResponse } from '@mu/shared';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { MusicSettingsService } from '../music-settings.service.js';
import { MusicStreamService } from '../playback/music-stream.service.js';
import {
	deriveOfflineKey,
	type OfflineTokenPayload,
	signOfflineToken,
	verifyOfflineToken,
} from './offline-token.js';

/** Signed download URLs stay valid this long (downloads start right away). */
export const OFFLINE_TOKEN_TTL_MS = 30 * 60 * 1000;
/** Max tracks per token request (an album / playlist page). */
export const MAX_OFFLINE_TRACKS_PER_REQUEST = 500;

/**
 * Offline music downloads (docs/music-support-plan.md §6.5). Issues
 * short-lived HMAC-signed file URLs so the Service Worker's cached Requests
 * never embed the user's JWT, and enforces `MusicSettings.offline`.
 */
@Injectable()
export class MusicOfflineService {
	private key: Buffer | null = null;

	constructor(
		private readonly config: ConfigService,
		private readonly musicSettings: MusicSettingsService,
		private readonly stream: MusicStreamService,
	) {}

	private signingKey(): Buffer {
		if (!this.key) {
			const secret = this.config.get<string>('auth.jwtSecret');
			if (!secret) throw new Error('auth.jwtSecret is not configured');
			this.key = deriveOfflineKey(secret);
		}
		return this.key;
	}

	policy(role: string | undefined): MusicOfflinePolicy {
		const o = this.musicSettings.get().offline;
		const allowed = o.allowDownloads && !!role && (o.roles as string[]).includes(role);
		return {
			allowed,
			profile: o.downloadProfile,
			maxOfflineGbPerDevice: o.maxOfflineGbPerDevice,
		};
	}

	issue(
		user: { id: string; role?: string },
		trackIds: string[],
		caps: string | undefined,
	): MusicOfflineTokenResponse {
		const policy = this.policy(user.role);
		if (!policy.allowed) {
			throw new ForbiddenException('Offline downloads are not allowed for your account');
		}
		const cleanCaps = (caps ?? '').replace(/[^a-z0-9,]/gi, '').slice(0, 120);
		const ids = [...new Set((trackIds ?? []).map(String).filter(Boolean))].slice(
			0,
			MAX_OFFLINE_TRACKS_PER_REQUEST,
		);
		const expires = Date.now() + OFFLINE_TOKEN_TTL_MS;
		const items: MusicOfflineItem[] = [];
		const missing: string[] = [];
		for (const trackId of ids) {
			let session: ReturnType<MusicStreamService['start']>;
			try {
				session = this.stream.start(trackId, { profile: policy.profile, caps: cleanCaps });
			} catch {
				missing.push(trackId);
				continue;
			}
			const t = signOfflineToken(this.signingKey(), {
				f: session.trackFileId,
				p: session.profile,
				c: cleanCaps,
				u: user.id,
				e: expires,
			});
			items.push({
				trackId,
				trackFileId: session.trackFileId,
				url: `/api/v1/music/offline/files/${session.trackFileId}?t=${encodeURIComponent(t)}`,
				profile: session.profile,
				codec: session.codec,
				durationSeconds: session.durationSeconds,
			});
		}
		return { items, missing, expiresAt: new Date(expires).toISOString(), policy };
	}

	/** Validate a download token for `trackFileId`; throws 403 when unusable. */
	verify(trackFileId: string, token: string | undefined): OfflineTokenPayload {
		const payload = verifyOfflineToken(this.signingKey(), token);
		if (!payload || payload.f !== trackFileId) {
			throw new ForbiddenException('Invalid or expired download link');
		}
		// Admin switched downloads off → outstanding links stop working too.
		if (!this.musicSettings.get().offline.allowDownloads) {
			throw new ForbiddenException('Offline downloads are disabled');
		}
		return payload;
	}

	resolveFile(payload: OfflineTokenPayload): Promise<string> {
		return this.stream.resolveFile(payload.f, payload.p, payload.c);
	}
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ShareTokenVerifier } from '../common/share-token.verifier.js';
import { DatabaseService } from '../database/database.service.js';
import { movies } from '../database/schema/index.js';
import { SettingsService } from '../settings/settings.service.js';
import {
	SHARE_TOKEN_DEFAULT_DAYS,
	SHARE_TOKEN_SETTING_KEY,
	SHARE_TOKEN_TYPE,
	type ShareTokenPayload,
} from './share-token.constants.js';

export interface ShareTokenResult {
	token: string;
	movieId: string;
	expiresInDays: number | null;
}

/**
 * Creates and verifies per-movie share JWTs.
 *
 * Tokens are signed with the app's existing fastify JWT secret (reused from
 * normal auth), so a rotation of `auth.jwtSecret` invalidates all outstanding
 * share links. This is intentional and documented.
 */
@Injectable()
export class ShareLinksService {
	private readonly logger = new Logger(ShareLinksService.name);

	constructor(
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly verifier: ShareTokenVerifier,
	) {}

	/**
	 * Create a signed share token for the given movie.
	 * @throws NotFoundException if the movie doesn't exist.
	 */
	createShareToken(movieId: string, fastifyInstance: any): ShareTokenResult {
		const movie = this.database.db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
		if (!movie) {
			throw new NotFoundException(`Movie ${movieId} not found`);
		}

		const expiryDays = this.resolveExpiryDays();
		const payload: ShareTokenPayload = { movieId, type: SHARE_TOKEN_TYPE };
		const signOptions: Record<string, unknown> = {};
		if (expiryDays && expiryDays > 0) {
			signOptions.expiresIn = `${expiryDays}d`;
		}

		const token = fastifyInstance.jwt.sign(payload, signOptions);
		this.logger.log(
			`Created share token for movie=${movieId} (expiresInDays=${expiryDays ?? 'never'})`,
		);
		return {
			token,
			movieId,
			expiresInDays: expiryDays && expiryDays > 0 ? expiryDays : null,
		};
	}

	/**
	 * Verify a share token. Returns the payload or null.
	 */
	verifyShareToken(token: string, fastifyInstance: any): ShareTokenPayload | null {
		return this.verifier.verify(token, fastifyInstance);
	}

	private resolveExpiryDays(): number | null {
		const raw = this.settings.get<number | null | undefined>(
			SHARE_TOKEN_SETTING_KEY,
			SHARE_TOKEN_DEFAULT_DAYS,
		);
		if (raw == null) return null;
		const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
		if (!Number.isFinite(n) || n <= 0) return null;
		return n;
	}
}

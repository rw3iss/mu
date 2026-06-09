import { nowISO } from '@mu/shared';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Observable } from 'rxjs';
import { DatabaseService } from '../../database/database.service.js';
import { users } from '../../database/schema/index.js';

/** Don't touch the DB more than once per this window per user. */
const THROTTLE_MS = 60_000;

/**
 * Stamps `users.last_seen_at` on authenticated requests so member presence
 * ("Active …") reflects general app use — browsing, not just login/playback.
 * Throttled per-user in memory and fire-and-forget, so it never blocks or
 * fails a request. Skips share-token viewers and the setup bypass (no real
 * user row to update).
 */
@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
	private readonly lastWrite = new Map<string, number>();

	constructor(private readonly database: DatabaseService) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		try {
			const req = context.switchToHttp().getRequest();
			const user = req?.user;
			const id: string | undefined = user?.sub ?? user?.id;
			if (id && user.role !== 'share' && id !== '__setup__' && id !== '__share__') {
				const now = Date.now();
				const last = this.lastWrite.get(id) ?? 0;
				if (now - last >= THROTTLE_MS) {
					this.lastWrite.set(id, now);
					try {
						this.database.db
							.update(users)
							.set({ lastSeenAt: nowISO() })
							.where(eq(users.id, id))
							.run();
					} catch {
						// Non-critical — never let presence tracking break a request.
					}
				}
			}
		} catch {
			// ignore — presence is best-effort
		}
		return next.handle();
	}
}

import { nowISO } from '@mu/shared';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Observable } from 'rxjs';
import { DatabaseService } from '../../database/database.service.js';
import { users } from '../../database/schema/index.js';

/** Don't touch the DB more than once per this window per user. */
const THROTTLE_MS = 60_000;

/**
 * Background/automated requests that must NOT count as "activity" — otherwise
 * an idle-but-open browser (which keeps polling + heart-beating) would always
 * read as "Active just now". Playback progress/heartbeat fire on a timer even
 * while paused, so real watching is tracked separately via watch history +
 * `stream_sessions.last_progress_at`, not here.
 */
const BACKGROUND_BEAT = /\/stream\/[^/]+\/(heartbeat|progress)(\?|$)/;

/**
 * Stamps `users.last_seen_at` when a member actually DOES something — i.e. a
 * state-changing request (POST/PUT/PATCH/DELETE), excluding playback heartbeat/
 * progress beats. Passive GET polling (notifications, jobs, library browsing)
 * is deliberately ignored so presence reflects real activity, not just an open
 * tab. Login sets `last_login_at` and watching updates `last_progress_at`, so
 * this covers the remaining "performed an action" case.
 *
 * Throttled per-user in memory and fire-and-forget, so it never blocks or
 * fails a request. Skips share-token viewers and the setup bypass.
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

			const method = String(req?.method ?? 'GET').toUpperCase();
			const isMutation =
				method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
			const isBackgroundBeat = BACKGROUND_BEAT.test(String(req?.url ?? ''));
			const countsAsActivity = isMutation && !isBackgroundBeat;

			if (
				countsAsActivity &&
				id &&
				user.role !== 'share' &&
				id !== '__setup__' &&
				id !== '__share__'
			) {
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

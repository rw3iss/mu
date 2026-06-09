import { PROFILE_DESCRIPTION_MAX } from '@mu/shared';
import type {
	CurrentlyWatching,
	MemberSummary,
	ProfileFavorite,
	ProfileHistoryItem,
	ProfileStats,
	ProfileSystemConfig,
	ProfileUser,
	ProfileView,
	UpdateProfileInput,
} from '@mu/shared';
import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { AuthCacheService } from '../common/permissions/auth-cache.service.js';
import { DatabaseService } from '../database/database.service.js';
import { favorites as favoritesTable, movies, streamSessions, users } from '../database/schema/index.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import { HistoryService } from '../movies/history.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** A "watching now" session counts only if it was active within this window. */
const ACTIVE_SESSION_WINDOW_MS = 3 * 60 * 1000;
/** App-settings key for the admin "show users info" master switch. */
const SHOW_USERS_INFO_KEY = 'showUsersInfo';

interface Requester {
	id: string;
	role: string;
}

@Injectable()
export class ProfileService {
	constructor(
		private readonly database: DatabaseService,
		private readonly favorites: FavoritesService,
		private readonly history: HistoryService,
		private readonly settings: SettingsService,
		private readonly authCache: AuthCacheService,
	) {}

	// ── System setting ────────────────────────────────────────────────────

	getSystemConfig(): ProfileSystemConfig {
		return { showUsersInfo: this.settings.get<boolean>(SHOW_USERS_INFO_KEY, false) === true };
	}

	setSystemConfig(showUsersInfo: boolean): ProfileSystemConfig {
		this.settings.set(SHOW_USERS_INFO_KEY, !!showUsersInfo);
		return this.getSystemConfig();
	}

	// ── Profiles ──────────────────────────────────────────────────────────

	async getOwnProfile(userId: string): Promise<ProfileView> {
		const user = this.findUserById(userId);
		if (!user) throw new NotFoundException('User not found');
		return this.buildProfile(user, { includePrivate: true, editable: true });
	}

	async getProfileByUsername(username: string, requester: Requester): Promise<ProfileView> {
		const user = this.findUserByUsername(username);
		if (!user) throw new NotFoundException('User not found');

		const isAdmin = requester.role === 'admin';
		const isSelf = requester.id === user.id;
		const showUsersInfo = this.getSystemConfig().showUsersInfo;
		const visible = isAdmin || isSelf || (showUsersInfo && !!user.profilePublic);
		// Hidden profiles look like they don't exist to ordinary users.
		if (!visible) throw new NotFoundException('User not found');

		return this.buildProfile(user, { includePrivate: isAdmin || isSelf, editable: isSelf });
	}

	async listMembers(requester: Requester): Promise<MemberSummary[]> {
		const isAdmin = requester.role === 'admin';
		const showUsersInfo = this.getSystemConfig().showUsersInfo;
		// Non-admins can only browse members when the admin has enabled it.
		if (!isAdmin && !showUsersInfo) throw new NotFoundException('Members are not available');

		const rows = this.database.db
			.select()
			.from(users)
			// Admins see everyone; ordinary users see only opted-in profiles.
			.where(isAdmin ? undefined : eq(users.profilePublic, true))
			.orderBy(users.username)
			.all();

		return rows.map((u) => {
			const stats = this.computeStats(u.id, u.createdAt);
			const summary: MemberSummary = {
				id: u.id,
				username: u.username,
				role: u.role,
				avatarUrl: u.avatarUrl ?? null,
				description: u.description ?? null,
				createdAt: u.createdAt,
				favoritesCount: stats.favoritesCount,
				watchedCount: stats.watchedCount,
			};
			if (isAdmin) summary.profilePublic = !!u.profilePublic;
			return summary;
		});
	}

	// ── Editing ───────────────────────────────────────────────────────────

	async updateOwnProfile(userId: string, patch: UpdateProfileInput): Promise<ProfileView> {
		const user = this.findUserById(userId);
		if (!user) throw new NotFoundException('User not found');

		const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

		if (patch.description !== undefined) {
			const desc = (patch.description ?? '').toString();
			if (desc.length > PROFILE_DESCRIPTION_MAX) {
				throw new BadRequestException(`Description must be ${PROFILE_DESCRIPTION_MAX} characters or fewer`);
			}
			update.description = desc.trim() || null;
		}
		if (patch.profilePublic !== undefined) update.profilePublic = !!patch.profilePublic;
		if (patch.avatarUrl !== undefined) update.avatarUrl = patch.avatarUrl?.toString().trim() || null;
		if (patch.username !== undefined) {
			const username = patch.username.toString().trim();
			if (!username) throw new BadRequestException('Username cannot be empty');
			update.username = username;
		}
		if (patch.email !== undefined) update.email = patch.email?.toString().trim() || null;

		try {
			this.database.db.update(users).set(update).where(eq(users.id, userId)).run();
		} catch (err) {
			// Unique constraint on username/email.
			if (String((err as Error).message).includes('UNIQUE')) {
				throw new ConflictException('That username or email is already taken');
			}
			throw err;
		}
		// Username/role/avatar are cached on the auth path — refresh it.
		this.authCache.invalidateUser(userId);

		return this.getOwnProfile(userId);
	}

	// ── Aggregation ───────────────────────────────────────────────────────

	private async buildProfile(
		user: typeof users.$inferSelect,
		opts: { includePrivate: boolean; editable: boolean },
	): Promise<ProfileView> {
		const profileUser: ProfileUser = {
			id: user.id,
			username: user.username,
			role: user.role,
			avatarUrl: user.avatarUrl ?? null,
			description: user.description ?? null,
			createdAt: user.createdAt,
		};
		if (opts.includePrivate) {
			profileUser.email = user.email ?? null;
			profileUser.profilePublic = !!user.profilePublic;
		}

		const [favorites, history] = await Promise.all([
			this.mapFavorites(user.id),
			Promise.resolve(this.mapHistory(user.id)),
		]);
		const currentlyWatching = this.getCurrentlyWatching(user.id);

		const stats: ProfileStats = {
			favoritesCount: favorites.length,
			watchedCount: this.history.getWatchedCount(user.id),
			joinedAt: user.createdAt,
		};

		return { user: profileUser, stats, favorites, history, currentlyWatching, editable: opts.editable };
	}

	private async mapFavorites(userId: string): Promise<ProfileFavorite[]> {
		const list = await this.favorites.list(userId);
		const mapped: ProfileFavorite[] = list.map((f) => {
			if (f.entityType === 'movie' && f.movie) {
				return {
					id: f.id,
					type: 'movie',
					key: f.key,
					role: f.role ?? null,
					createdAt: f.createdAt,
					title: f.movie.title,
					imageUrl: f.movie.posterUrl ?? null,
					subtitle: f.movie.year ? String(f.movie.year) : null,
					movieId: f.movie.id,
				};
			}
			const dept = (f.person?.knownForDepartment ?? '').toLowerCase();
			const role = (f.role ?? '').toLowerCase();
			const isDirector = role.includes('direct') || dept === 'directing';
			return {
				id: f.id,
				type: isDirector ? 'director' : 'cast',
				key: f.key,
				role: f.role ?? null,
				createdAt: f.createdAt,
				title: f.person?.name ?? 'Unknown',
				imageUrl: f.person?.profileUrl ?? null,
				subtitle: f.person?.knownForDepartment ?? null,
				personKey: f.key,
			};
		});
		// Earliest-added first (the profile shows the user's oldest tastes first).
		mapped.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		return mapped;
	}

	private mapHistory(userId: string): ProfileHistoryItem[] {
		// Pull the user's full history (most-recent first from the service).
		const { data } = this.history.getHistory(userId, 1, 1000);
		return data.map((h) => ({
			movieId: h.movieId,
			title: h.movieTitle,
			year: h.movieYear ?? null,
			posterUrl: h.moviePosterUrl ?? null,
			watchedAt: h.watchedAt,
			positionSeconds: h.positionSeconds ?? 0,
			durationSeconds: h.movieDurationSeconds ?? null,
			completed: !!h.completed,
		}));
	}

	private getCurrentlyWatching(userId: string): CurrentlyWatching | null {
		const since = new Date(Date.now() - ACTIVE_SESSION_WINDOW_MS).toISOString();
		const row = this.database.db
			.select({
				movieId: streamSessions.movieId,
				positionSeconds: streamSessions.positionSeconds,
				startedAt: streamSessions.startedAt,
				title: movies.title,
				year: movies.year,
				posterUrl: movies.posterUrl,
				backdropUrl: movies.backdropUrl,
				durationSeconds: sql<number | null>`(SELECT mf.duration_seconds FROM movie_files mf WHERE mf.movie_id = ${streamSessions.movieId} LIMIT 1)`,
			})
			.from(streamSessions)
			.leftJoin(movies, eq(streamSessions.movieId, movies.id))
			.where(and(eq(streamSessions.userId, userId), gt(streamSessions.lastActiveAt, since)))
			.orderBy(desc(streamSessions.lastActiveAt))
			.limit(1)
			.get();

		if (!row || !row.title) return null;
		return {
			movieId: row.movieId,
			title: row.title,
			year: row.year ?? null,
			posterUrl: row.posterUrl ?? null,
			backdropUrl: row.backdropUrl ?? null,
			positionSeconds: row.positionSeconds ?? 0,
			durationSeconds: row.durationSeconds ?? null,
			startedAt: row.startedAt,
		};
	}

	private computeStats(userId: string, createdAt: string): ProfileStats {
		const fav = this.database.db
			.select({ c: sql<number>`COUNT(*)` })
			.from(favoritesTable)
			.where(eq(favoritesTable.userId, userId))
			.get();
		return {
			favoritesCount: fav?.c ?? 0,
			watchedCount: this.history.getWatchedCount(userId),
			joinedAt: createdAt,
		};
	}

	// ── Lookups ───────────────────────────────────────────────────────────

	private findUserById(id: string) {
		return this.database.db.select().from(users).where(eq(users.id, id)).get();
	}

	private findUserByUsername(username: string) {
		return this.database.db
			.select()
			.from(users)
			.where(sql`lower(${users.username}) = lower(${username})`)
			.get();
	}
}

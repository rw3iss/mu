// Shared types for the user Profile + Members feature (social dashboard).
// Used by the server (profile module) and the client (profile service + pages).

/** A favorite type as surfaced on a profile, derived for client-side filtering. */
export type ProfileFavoriteType = 'movie' | 'cast' | 'director';

/** Admin-controlled system switch that exposes the Members/profile feature. */
export interface ProfileSystemConfig {
	/** When true, the Members page + cross-user profiles are available to non-admins. */
	showUsersInfo: boolean;
}

/** Basic user identity shown on a profile. Private fields are present only for
 *  the profile owner or an admin. */
export interface ProfileUser {
	id: string;
	username: string;
	/** Friendly name shown in place of the username when set. */
	displayName: string | null;
	role: string;
	avatarUrl: string | null;
	description: string | null;
	createdAt: string;
	/** Present only when viewing your own profile or as an admin. */
	email?: string | null;
	/** The per-user "show profile info" flag — present only for owner/admin. */
	profilePublic?: boolean;
}

/** Aggregate counts for the profile header / member rows. */
export interface ProfileStats {
	favoritesCount: number;
	watchedCount: number;
	joinedAt: string;
	/** Most recent activity (login / watch / session); null if never active. */
	lastActiveAt: string | null;
	/** When the user last logged out, IF that's newer than their last activity
	 *  (i.e. they're currently signed out). Null when they're active. */
	loggedOutAt: string | null;
}

/** One favorite entry on a profile, flattened for display + filtering. */
export interface ProfileFavorite {
	id: string;
	type: ProfileFavoriteType;
	key: string;
	role: string | null;
	createdAt: string;
	title: string;
	imageUrl: string | null;
	subtitle: string | null;
	/** Set for movie favorites — enables navigation to the movie detail page. */
	movieId?: string;
	/** Set for person favorites — `tmdb:<id>` / `name:<slug>`. */
	personKey?: string;
}

/** One recently-watched entry on a profile, with the resume position. */
export interface ProfileHistoryItem {
	movieId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	watchedAt: string;
	positionSeconds: number;
	durationSeconds: number | null;
	completed: boolean;
	/** This user's own internal (mu) rating for the movie, if they rated it. */
	rating: number | null;
}

/** The "Watching Now" tout — the user's most recent movie with a live session. */
export interface CurrentlyWatching {
	movieId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	backdropUrl: string | null;
	positionSeconds: number;
	durationSeconds: number | null;
	startedAt: string;
	/** This user's own internal (mu) rating for the movie, if they rated it. */
	rating: number | null;
}

/** Full profile payload returned by GET /profile/me and /profile/:username. */
export interface ProfileView {
	user: ProfileUser;
	stats: ProfileStats;
	favorites: ProfileFavorite[];
	history: ProfileHistoryItem[];
	currentlyWatching: CurrentlyWatching | null;
	/** True when the requester may edit this profile (it's their own). */
	editable: boolean;
}

/** A row in the Members list. */
export interface MemberSummary {
	id: string;
	username: string;
	/** Friendly name shown in place of the username when set. */
	displayName: string | null;
	role: string;
	avatarUrl: string | null;
	description: string | null;
	createdAt: string;
	favoritesCount: number;
	watchedCount: number;
	/** Most recent activity (login / watch / session); null if never active. */
	lastActiveAt: string | null;
	/** When the user last logged out, if newer than their last activity (i.e.
	 *  currently signed out); null when active. */
	loggedOutAt: string | null;
	/** The user's live session, if any — shown as a compact row on the card. */
	currentlyWatching: CurrentlyWatching | null;
	/** Present for admins (so they can see who has opted in). */
	profilePublic?: boolean;
}

/** Editable fields for PATCH /profile/me. */
export interface UpdateProfileInput {
	description?: string;
	profilePublic?: boolean;
	avatarUrl?: string | null;
	displayName?: string | null;
	username?: string;
	email?: string | null;
}

/** Max length of the profile description blurb. */
export const PROFILE_DESCRIPTION_MAX = 500;

/** Max length of the display name. */
export const DISPLAY_NAME_MAX = 60;

/** Minimum length of a user password (enforced on the self-service change form). */
export const PASSWORD_MIN_LENGTH = 6;

/** The name to show for a user: their display name when set, else username. */
export function resolveDisplayName(
	user: { displayName?: string | null; username?: string | null } | null | undefined,
): string {
	return (user?.displayName?.trim() || user?.username || '').trim();
}

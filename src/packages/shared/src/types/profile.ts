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
	role: string;
	avatarUrl: string | null;
	description: string | null;
	createdAt: string;
	favoritesCount: number;
	watchedCount: number;
	/** Most recent activity (login / watch / session); null if never active. */
	lastActiveAt: string | null;
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
	username?: string;
	email?: string | null;
}

/** Max length of the profile description blurb. */
export const PROFILE_DESCRIPTION_MAX = 500;

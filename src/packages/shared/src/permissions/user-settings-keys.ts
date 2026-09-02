/**
 * Allowlist of setting keys that may be stored per-user.
 *
 * Server `setForUser(key, ...)` rejects any key not in this list unless
 * the actor has `admin:any-user-setting` (support escape hatch).
 */
export const USER_SETTING_KEYS = [
	// Consolidated per-user playback preferences blob (general + watch tracking),
	// written by the Settings → Playback tab via PUT /settings/playback.
	'playback',
	// Playback
	'playback.preferredAudioLang',
	'playback.preferredSubtitleLang',
	'playback.autoplay',
	'playback.autoplayNext',
	'playback.bufferSize',
	'playback.skipIntroSeconds',
	'playback.skipCreditsSeconds',
	// Watch tracking (formerly app-wide; now overridable per user, with
	// the app default still acting as the fallback)
	'playback.watchedThresholdSeconds',
	'playback.completedTailSeconds',
	// Appearance
	'appearance.theme',
	'appearance.posterSize',
	'appearance.density',
	'appearance.cardLayout',
	// Notifications
	'notifications.toastDuration',
	'notifications.muted',
	// Saved defaults for the Known For / Similar result filter bars, written by
	// the "Save search as default" button. One blob so a save replaces the set.
	'movieSearchDefaults',
	// General
	'general.startPage',
	'general.dateFormat',
	'general.timeFormat',
] as const;

export type UserSettingKey = (typeof USER_SETTING_KEYS)[number];

export function isUserSettingKey(k: string): k is UserSettingKey {
	return (USER_SETTING_KEYS as readonly string[]).includes(k);
}

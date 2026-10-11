import type { AudioQuality, ReplayGainMode } from '@mu/shared';
import { effect } from '@preact/signals';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { musicService } from '@/services/music.service';
import { musicEnabled } from '@/state/features.state';
import {
	MUSIC_GAPLESS_KEY,
	MUSIC_PROFILE_KEY,
	MUSIC_REPLAYGAIN_KEY,
	MUSIC_RESUME_AFTER_VIDEO_KEY,
} from '@/state/musicPlayer.state';
import { setMine, userSettings, userSettingsReady } from '@/state/userSettings.state';
import { musicServerSettings } from '@/utils/music-quality';

/**
 * Per-user music preferences. The player reads local uiSettings (instant, per
 * device); this module keeps them in step with the user's server settings
 * (`music.*`, allowlisted) so a choice follows the user to other devices, and
 * falls back to the admin defaults from `GET /music/settings` when the user
 * has never chosen.
 *
 * Precedence: server user setting → value already chosen on this device →
 * admin default.
 */
interface Pref {
	/** uiSetting key the player reads. */
	local: string;
	/** Allowlisted per-user server key. */
	server: string;
	/** Admin default from MusicSettings. */
	adminKey: 'defaultProfile' | 'replayGain' | 'gapless' | 'resumeAfterVideo';
}

const PREFS: Pref[] = [
	{ local: MUSIC_PROFILE_KEY, server: 'music.streamProfile', adminKey: 'defaultProfile' },
	{ local: MUSIC_REPLAYGAIN_KEY, server: 'music.replayGain', adminKey: 'replayGain' },
	{ local: MUSIC_GAPLESS_KEY, server: 'music.gapless', adminKey: 'gapless' },
	{
		local: MUSIC_RESUME_AFTER_VIDEO_KEY,
		server: 'music.resumeAfterVideo',
		adminKey: 'resumeAfterVideo',
	},
];

const hasLocal = (key: string) => {
	try {
		return localStorage.getItem(`mu_ui_${key}`) !== null;
	} catch {
		return false;
	}
};

let synced = false;

async function sync(): Promise<void> {
	if (synced) return;
	synced = true;
	const admin = await musicService.settings().catch(() => null);
	if (admin) musicServerSettings.value = admin;
	const mine = userSettings.value;
	for (const p of PREFS) {
		const serverValue = mine[p.server];
		if (serverValue !== undefined && serverValue !== null) {
			setUiSetting(p.local, serverValue);
		} else if (!hasLocal(p.local) && admin) {
			setUiSetting(p.local, admin[p.adminKey]);
		}
	}
	// A saved Lossless choice is meaningless once the admin turns FLAC off.
	if (
		admin &&
		!admin.allowLossless &&
		getUiSetting<AudioQuality>(MUSIC_PROFILE_KEY, 'original') === 'lossless'
	) {
		setUiSetting(MUSIC_PROFILE_KEY, 'original');
	}
}

/** Start syncing once the user's settings are loaded and Music is on. Idempotent. */
export function initMusicPrefs(): void {
	effect(() => {
		if (userSettingsReady.value && musicEnabled.value) void sync();
	});
}

/** Change a preference on this device and for the user everywhere. */
export function setMusicPref(
	key: 'streamProfile' | 'replayGain' | 'gapless' | 'resumeAfterVideo',
	value: AudioQuality | ReplayGainMode | boolean,
): void {
	const pref = PREFS.find((p) => p.server === `music.${key}`);
	if (!pref) return;
	setUiSetting(pref.local, value);
	void setMine(pref.server, value).catch(() => {
		// Device-local value still applies; the server copy retries on next change.
	});
}

import { type AudioQuality, DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

/** Admin music settings (app setting `music`) merged over the defaults. */
@Injectable()
export class MusicSettingsService {
	constructor(private readonly settings: SettingsService) {}

	get(): MusicSettings {
		const raw = (this.settings.get<Partial<MusicSettings>>('music', {}) ??
			{}) as Partial<MusicSettings>;
		return normalize({
			...DEFAULT_MUSIC_SETTINGS,
			...raw,
			bitrates: { ...DEFAULT_MUSIC_SETTINGS.bitrates, ...(raw.bitrates ?? {}) },
			offline: { ...DEFAULT_MUSIC_SETTINGS.offline, ...(raw.offline ?? {}) },
		});
	}

	set(patch: Partial<MusicSettings>): MusicSettings {
		const next = normalize({ ...this.get(), ...patch });
		this.settings.set('music', next);
		return next;
	}
}

/** With lossless off, no setting may point at FLAC. */
function normalize(s: MusicSettings): MusicSettings {
	if (s.allowLossless) return s;
	const noFlac = (q: AudioQuality): AudioQuality => (q === 'lossless' ? 'original' : q);
	return {
		...s,
		defaultProfile: noFlac(s.defaultProfile),
		maxProfile: noFlac(s.maxProfile),
		fallbackProfile: s.fallbackProfile === 'lossless' ? 'high' : s.fallbackProfile,
		offline: {
			...s.offline,
			downloadProfile:
				s.offline.downloadProfile === 'lossless' ? 'high' : s.offline.downloadProfile,
		},
	};
}

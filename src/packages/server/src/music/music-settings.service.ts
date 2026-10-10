import { DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '@mu/shared';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

/** Admin music settings (app setting `music`) merged over the defaults. */
@Injectable()
export class MusicSettingsService {
	constructor(private readonly settings: SettingsService) {}

	get(): MusicSettings {
		const raw = (this.settings.get<Partial<MusicSettings>>('music', {}) ??
			{}) as Partial<MusicSettings>;
		return {
			...DEFAULT_MUSIC_SETTINGS,
			...raw,
			bitrates: { ...DEFAULT_MUSIC_SETTINGS.bitrates, ...(raw.bitrates ?? {}) },
			offline: { ...DEFAULT_MUSIC_SETTINGS.offline, ...(raw.offline ?? {}) },
		};
	}

	set(patch: Partial<MusicSettings>): MusicSettings {
		const next = { ...this.get(), ...patch };
		this.settings.set('music', next);
		return next;
	}
}

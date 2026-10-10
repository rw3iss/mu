import {
	DEFAULT_FEATURE_FLAGS,
	type FeatureFlags,
	type FeatureName,
	type MediaKind,
	WsEvent,
} from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** App-setting key holding the persisted flags. */
export const FEATURES_SETTING_KEY = 'features';

/** Which feature gates each media kind (source scanning, importers, jobs). */
export const KIND_FEATURE: Record<MediaKind, FeatureName> = {
	video: 'movies',
	audio: 'music',
};

/**
 * Single source of truth for the top-level product features (movies / music).
 *
 * Resolution, per flag: `features` app setting (DB) → `features.*` config
 * (env `MU_FEATURE_MOVIES` / `MU_FEATURE_MUSIC`) → `DEFAULT_FEATURE_FLAGS`.
 * Disabling a feature never deletes data — it only stops routes, scans and
 * jobs for that kind. See docs/music-support-plan.md §7.1.
 */
@Injectable()
export class FeatureFlagsService {
	private readonly logger = new Logger('FeatureFlags');
	/** Cached resolved flags; invalidated by `set()`. Settings reads hit SQLite. */
	private cached: FeatureFlags | null = null;

	constructor(
		private readonly settings: SettingsService,
		private readonly config: ConfigService,
		private readonly events: EventsService,
	) {}

	/** Env/config-level defaults (before any DB override). */
	private defaults(): FeatureFlags {
		return {
			movies: this.config.get<boolean>('features.movies', DEFAULT_FEATURE_FLAGS.movies),
			music: this.config.get<boolean>('features.music', DEFAULT_FEATURE_FLAGS.music),
		};
	}

	getAll(): FeatureFlags {
		if (this.cached) return { ...this.cached };
		const base = this.defaults();
		let stored: Partial<FeatureFlags> = {};
		try {
			const raw = this.settings.get<Partial<FeatureFlags> | null>(FEATURES_SETTING_KEY, null);
			if (raw && typeof raw === 'object') stored = raw;
		} catch (err) {
			this.logger.warn(
				`Feature flags read failed, using defaults: ${(err as Error).message}`,
			);
			return base;
		}
		const resolved: FeatureFlags = {
			movies: typeof stored.movies === 'boolean' ? stored.movies : base.movies,
			music: typeof stored.music === 'boolean' ? stored.music : base.music,
		};
		this.cached = resolved;
		return { ...resolved };
	}

	isEnabled(name: FeatureName): boolean {
		return this.getAll()[name] === true;
	}

	/** True when the feature that owns `kind` is enabled. */
	isKindEnabled(kind: MediaKind): boolean {
		return this.isEnabled(KIND_FEATURE[kind]);
	}

	/** Admin: persist a partial update. Emits `features:changed` when anything changed. */
	set(partial: Partial<FeatureFlags>): FeatureFlags {
		const prev = this.getAll();
		const next: FeatureFlags = {
			movies: typeof partial.movies === 'boolean' ? partial.movies : prev.movies,
			music: typeof partial.music === 'boolean' ? partial.music : prev.music,
		};
		this.settings.set(FEATURES_SETTING_KEY, next);
		this.cached = next;
		if (next.movies !== prev.movies || next.music !== prev.music) {
			this.logger.log(`Features changed: movies=${next.movies} music=${next.music}`);
			this.events.emit(WsEvent.FEATURES_CHANGED, next);
		}
		return { ...next };
	}
}

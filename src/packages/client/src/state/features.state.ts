import { DEFAULT_FEATURE_FLAGS, type FeatureFlags } from '@mu/shared';
import { computed, signal } from '@preact/signals';
import { featuresService } from '@/services/features.service';
import { wsService } from '@/services/websocket.service';

/**
 * Server feature flags (`GET /features`). Defaults to movies-only until the
 * first load resolves, so music entry points never flash in on a server that
 * has Music disabled. Refreshed on the `features:changed` websocket event.
 */
export const features = signal<FeatureFlags>({ ...DEFAULT_FEATURE_FLAGS });
export const featuresLoaded = signal(false);

export const musicEnabled = computed(() => features.value.music);
export const moviesEnabled = computed(() => features.value.movies);

let inflight: Promise<void> | null = null;

export function loadFeatures(): Promise<void> {
	if (inflight) return inflight;
	inflight = featuresService
		.get()
		.then((f) => {
			features.value = {
				movies: f?.movies !== false,
				music: f?.music === true,
			};
		})
		.catch(() => {
			// Older server without the endpoint → movies only.
		})
		.finally(() => {
			featuresLoaded.value = true;
			inflight = null;
		});
	return inflight;
}

let wired = false;

/** Load once at app start and keep in sync with admin toggles. Idempotent. */
export function initFeatures(): void {
	void loadFeatures();
	if (wired) return;
	wired = true;
	wsService.on('features:changed', (data) => {
		const f = data as Partial<FeatureFlags> | null;
		if (f && typeof f.movies === 'boolean' && typeof f.music === 'boolean') {
			features.value = { movies: f.movies, music: f.music };
			featuresLoaded.value = true;
		} else {
			void loadFeatures();
		}
	});
}

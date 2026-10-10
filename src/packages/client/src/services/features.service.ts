import type { FeatureFlags } from '@mu/shared';
import { api } from './api';

/** Top-level product feature flags (public endpoint). See plan §7.1. */
export const featuresService = {
	get(): Promise<FeatureFlags> {
		return api.get<FeatureFlags>('/features');
	},
};

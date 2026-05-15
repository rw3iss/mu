/**
 * Built-in curated theme catalogue (client side).
 *
 * Source of truth is `./catalogue.json` — also read by the migrate
 * seeder so client + DB never drift. Each entry becomes a row in the
 * `themes` table, seeded once by name (idempotent on re-run).
 *
 * Add a theme: append a new entry to catalogue.json. No code changes.
 */

import type { ThemeConfig } from '@mu/shared';
import catalogue from './catalogue.json';

export interface ThemeDefinition {
	name: string;
	mode: 'dark' | 'light';
	description: string;
	isDefault: boolean;
	config: ThemeConfig;
}

interface RawCatalogue {
	themes: ThemeDefinition[];
}

const raw = catalogue as unknown as RawCatalogue;

export const BUILTIN_THEMES: ThemeDefinition[] = raw.themes;

export const BUILTIN_DARK_THEMES: ThemeDefinition[] = BUILTIN_THEMES.filter(
	(t) => t.mode === 'dark',
);

export const BUILTIN_LIGHT_THEMES: ThemeDefinition[] = BUILTIN_THEMES.filter(
	(t) => t.mode === 'light',
);

export function getBuiltinTheme(name: string): ThemeDefinition | undefined {
	return BUILTIN_THEMES.find((t) => t.name === name);
}

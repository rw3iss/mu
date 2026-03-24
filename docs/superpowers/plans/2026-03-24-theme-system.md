# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-local appearance settings with a database-backed theme profile system supporting create/edit/import/export and independent light/dark mode assignment.

**Architecture:** New `themes` DB table stores theme configs as JSON. Server provides CRUD + import/export REST API with in-memory cache. Client fetches themes on boot, applies the active theme's config via existing CSS variable mechanism. Settings > Appearance becomes a theme profile selector + inline editor.

**Tech Stack:** NestJS (server), Drizzle ORM + SQLite, Preact + Signals (client), SCSS Modules

**Spec:** `docs/superpowers/specs/2026-03-24-theme-system-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/database/schema/themes.ts` | Drizzle schema for themes table |
| `packages/server/src/themes/themes.module.ts` | NestJS module wiring |
| `packages/server/src/themes/themes.service.ts` | CRUD, cache, seed, validate, import/export |
| `packages/server/src/themes/themes.controller.ts` | REST endpoints |
| `packages/client/src/services/themes.service.ts` | API client (fetch, create, update, delete, import, export) |
| `packages/client/src/state/themes.state.ts` | Signals: theme list, selected IDs, active config, apply logic |
| `packages/shared/src/types/theme.ts` | Shared ThemeConfig interface + defaults |

### Modified Files
| File | Change |
|------|--------|
| `packages/server/src/database/schema/index.ts` | Export themes schema |
| `packages/server/src/app.module.ts` | Import ThemesModule |
| `scripts/migrate.js` | CREATE TABLE themes + seed defaults |
| `packages/client/src/state/appearance.state.ts` | Apply config from active theme instead of individual localStorage keys |
| `packages/client/src/state/theme.state.ts` | On mode change, apply the matching theme profile |
| `packages/client/src/app.tsx` | Fetch themes on init |
| `packages/client/src/pages/Settings.tsx` | Replace Appearance section; move 2 settings to General |

---

## Task 1: Shared Types + Default Configs

**Files:**
- Create: `packages/shared/src/types/theme.ts`

- [ ] **Step 1: Create ThemeConfig interface and defaults**

```ts
// packages/shared/src/types/theme.ts
export interface ThemeConfig {
	accentColor: string;
	pageBg: string;
	panelBg: string;
	itemSpacing: string;
	itemRadius: number;
	cardBorder: { width: number; color: string; opacity: number };
	disableHover: boolean;
	textScale: number;
}

export interface ThemeRecord {
	id: string;
	name: string;
	mode: 'dark' | 'light';
	config: ThemeConfig;
	isDefault: boolean;
	createdBy: string | null;
	createdAt: string;
	updatedAt: string;
}

export const DEFAULT_DARK_CONFIG: ThemeConfig = {
	accentColor: '#06b6d4',
	pageBg: '#050709',
	panelBg: '#090b12',
	itemSpacing: 'normal',
	itemRadius: 3,
	cardBorder: { width: 1, color: '#788cb4', opacity: 0.07 },
	disableHover: false,
	textScale: 1.0,
};

export const DEFAULT_LIGHT_CONFIG: ThemeConfig = {
	accentColor: '#0891b2',
	pageBg: '#f8fafc',
	panelBg: '#ffffff',
	itemSpacing: 'normal',
	itemRadius: 3,
	cardBorder: { width: 1, color: '#94a3b8', opacity: 0.15 },
	disableHover: false,
	textScale: 1.0,
};

export function validateThemeConfig(obj: unknown): obj is ThemeConfig {
	if (!obj || typeof obj !== 'object') return false;
	const c = obj as Record<string, unknown>;
	return (
		typeof c.accentColor === 'string' &&
		typeof c.pageBg === 'string' &&
		typeof c.panelBg === 'string' &&
		typeof c.itemSpacing === 'string' &&
		typeof c.itemRadius === 'number' &&
		typeof c.cardBorder === 'object' &&
		typeof c.disableHover === 'boolean' &&
		typeof c.textScale === 'number'
	);
}
```

- [ ] **Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:
```ts
export * from './types/theme.js';
```

- [ ] **Step 3: Build shared package**

Run: `cd src && pnpm build --filter=@mu/shared`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/theme.ts packages/shared/src/index.ts
git commit -m "feat: add shared ThemeConfig type and defaults"
```

---

## Task 2: Database Schema + Migration

**Files:**
- Create: `packages/server/src/database/schema/themes.ts`
- Modify: `packages/server/src/database/schema/index.ts`
- Modify: `scripts/migrate.js`

- [ ] **Step 1: Create Drizzle schema**

```ts
// packages/server/src/database/schema/themes.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const themes = sqliteTable('themes', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	mode: text('mode').notNull(), // 'dark' | 'light'
	config: text('config').notNull(), // JSON string
	isDefault: integer('is_default').default(0),
	createdBy: text('created_by'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export type Theme = typeof themes.$inferSelect;
export type NewTheme = typeof themes.$inferInsert;
```

- [ ] **Step 2: Export from schema index**

Add to `packages/server/src/database/schema/index.ts`:
```ts
export { themes } from './themes.js';
```

- [ ] **Step 3: Add to migrate.js**

Add to the `tables` array in `scripts/migrate.js`:
```js
`CREATE TABLE IF NOT EXISTS themes (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	mode TEXT NOT NULL,
	config TEXT NOT NULL,
	is_default INTEGER DEFAULT 0,
	created_by TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
)`,
```

- [ ] **Step 4: Build and verify**

Run: `cd src && pnpm build`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/database/schema/themes.ts packages/server/src/database/schema/index.ts scripts/migrate.js
git commit -m "feat: add themes database schema and migration"
```

---

## Task 3: Server — ThemesService

**Files:**
- Create: `packages/server/src/themes/themes.service.ts`

- [ ] **Step 1: Create service with CRUD, cache, seed, validate**

```ts
// packages/server/src/themes/themes.service.ts
import crypto from 'node:crypto';
import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nowISO, DEFAULT_DARK_CONFIG, DEFAULT_LIGHT_CONFIG, validateThemeConfig } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { themes } from '../database/schema/index.js';

@Injectable()
export class ThemesService implements OnModuleInit {
	private readonly logger = new Logger(ThemesService.name);
	private cache: Map<string, typeof themes.$inferSelect> = new Map();

	constructor(private readonly database: DatabaseService) {}

	onModuleInit() {
		this.seedDefaults();
		this.refreshCache();
	}

	private seedDefaults() {
		const existing = this.database.db.select().from(themes).all();
		if (existing.some(t => t.isDefault)) return;

		const now = nowISO();
		this.database.db.insert(themes).values({
			id: crypto.randomUUID(),
			name: 'Default (Dark)',
			mode: 'dark',
			config: JSON.stringify(DEFAULT_DARK_CONFIG),
			isDefault: 1,
			createdBy: null,
			createdAt: now,
			updatedAt: now,
		}).run();

		this.database.db.insert(themes).values({
			id: crypto.randomUUID(),
			name: 'Default (Light)',
			mode: 'light',
			config: JSON.stringify(DEFAULT_LIGHT_CONFIG),
			isDefault: 1,
			createdBy: null,
			createdAt: now,
			updatedAt: now,
		}).run();

		this.logger.log('Seeded default themes');
	}

	private refreshCache() {
		this.cache.clear();
		const all = this.database.db.select().from(themes).all();
		for (const t of all) this.cache.set(t.id, t);
	}

	findAll() {
		return Array.from(this.cache.values()).map(t => ({
			...t,
			config: JSON.parse(t.config),
		}));
	}

	findOne(id: string) {
		const t = this.cache.get(id);
		if (!t) throw new NotFoundException('Theme not found');
		return { ...t, config: JSON.parse(t.config) };
	}

	create(data: { name: string; mode: string; config: unknown; createdBy?: string }) {
		if (!validateThemeConfig(data.config)) {
			throw new BadRequestException('Invalid theme config');
		}
		const now = nowISO();
		const id = crypto.randomUUID();
		this.database.db.insert(themes).values({
			id,
			name: data.name,
			mode: data.mode,
			config: JSON.stringify(data.config),
			isDefault: 0,
			createdBy: data.createdBy ?? null,
			createdAt: now,
			updatedAt: now,
		}).run();
		this.refreshCache();
		return this.findOne(id);
	}

	update(id: string, data: { name?: string; mode?: string; config?: unknown }) {
		const existing = this.cache.get(id);
		if (!existing) throw new NotFoundException('Theme not found');
		if (data.config && !validateThemeConfig(data.config)) {
			throw new BadRequestException('Invalid theme config');
		}
		this.database.db.update(themes).set({
			...(data.name != null ? { name: data.name } : {}),
			...(data.mode != null ? { mode: data.mode } : {}),
			...(data.config != null ? { config: JSON.stringify(data.config) } : {}),
			updatedAt: nowISO(),
		}).where(eq(themes.id, id)).run();
		this.refreshCache();
		return this.findOne(id);
	}

	remove(id: string) {
		const existing = this.cache.get(id);
		if (!existing) throw new NotFoundException('Theme not found');
		if (existing.isDefault) throw new BadRequestException('Cannot delete default themes');
		this.database.db.delete(themes).where(eq(themes.id, id)).run();
		this.refreshCache();
	}

	importTheme(data: unknown) {
		const obj = data as Record<string, unknown>;
		if (!obj.name || !obj.mode || !obj.config) {
			throw new BadRequestException('Invalid theme file: missing name, mode, or config');
		}
		if (!validateThemeConfig(obj.config)) {
			throw new BadRequestException('Invalid theme config in import');
		}
		return this.create({
			name: obj.name as string,
			mode: obj.mode as string,
			config: obj.config,
		});
	}

	exportTheme(id: string) {
		const t = this.findOne(id);
		return {
			name: t.name,
			mode: t.mode,
			config: t.config,
			exportedAt: nowISO(),
		};
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/themes/themes.service.ts
git commit -m "feat: add ThemesService with CRUD, cache, seed, import/export"
```

---

## Task 4: Server — Controller + Module

**Files:**
- Create: `packages/server/src/themes/themes.controller.ts`
- Create: `packages/server/src/themes/themes.module.ts`
- Modify: `packages/server/src/app.module.ts`

- [ ] **Step 1: Create controller**

```ts
// packages/server/src/themes/themes.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ThemesService } from './themes.service.js';

@Controller('api/v1/themes')
export class ThemesController {
	constructor(private readonly themesService: ThemesService) {}

	@Get()
	findAll() {
		return this.themesService.findAll();
	}

	@Get(':id')
	findOne(@Param('id') id: string) {
		return this.themesService.findOne(id);
	}

	@Post()
	create(@Body() body: any) {
		return this.themesService.create(body);
	}

	@Put(':id')
	update(@Param('id') id: string, @Body() body: any) {
		return this.themesService.update(id, body);
	}

	@Delete(':id')
	remove(@Param('id') id: string) {
		this.themesService.remove(id);
		return { success: true };
	}

	@Post('import')
	importTheme(@Body() body: any) {
		return this.themesService.importTheme(body);
	}

	@Get(':id/export')
	exportTheme(@Param('id') id: string, @Res() reply: FastifyReply) {
		const data = this.themesService.exportTheme(id);
		const filename = `${data.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.json`;
		return reply
			.header('Content-Type', 'application/json')
			.header('Content-Disposition', `attachment; filename="${filename}"`)
			.send(JSON.stringify(data, null, 2));
	}
}
```

- [ ] **Step 2: Create module**

```ts
// packages/server/src/themes/themes.module.ts
import { Module } from '@nestjs/common';
import { ThemesController } from './themes.controller.js';
import { ThemesService } from './themes.service.js';

@Module({
	controllers: [ThemesController],
	providers: [ThemesService],
	exports: [ThemesService],
})
export class ThemesModule {}
```

- [ ] **Step 3: Register in AppModule**

Add to `packages/server/src/app.module.ts` imports array:
```ts
import { ThemesModule } from './themes/themes.module.js';
// In @Module imports: [..., ThemesModule]
```

- [ ] **Step 4: Build and verify**

Run: `cd src && pnpm build`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/themes/ packages/server/src/app.module.ts
git commit -m "feat: add themes REST API (controller + module)"
```

---

## Task 5: Client — API Service

**Files:**
- Create: `packages/client/src/services/themes.service.ts`

- [ ] **Step 1: Create API client**

```ts
// packages/client/src/services/themes.service.ts
import type { ThemeRecord } from '@mu/shared';
import { api } from './api';

export const themesApi = {
	list: () => api.get<ThemeRecord[]>('/themes'),
	get: (id: string) => api.get<ThemeRecord>(`/themes/${id}`),
	create: (data: { name: string; mode: string; config: unknown }) =>
		api.post<ThemeRecord>('/themes', data),
	update: (id: string, data: { name?: string; mode?: string; config?: unknown }) =>
		api.put<ThemeRecord>(`/themes/${id}`, data),
	remove: (id: string) => api.delete(`/themes/${id}`),
	importTheme: (data: unknown) => api.post<ThemeRecord>('/themes/import', data),
	exportUrl: (id: string) => `/api/v1/themes/${id}/export`,
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/services/themes.service.ts
git commit -m "feat: add themes API client service"
```

---

## Task 6: Client — Theme State

**Files:**
- Create: `packages/client/src/state/themes.state.ts`
- Modify: `packages/client/src/state/appearance.state.ts`
- Modify: `packages/client/src/state/theme.state.ts`
- Modify: `packages/client/src/app.tsx`

- [ ] **Step 1: Create themes state with signals and apply logic**

```ts
// packages/client/src/state/themes.state.ts
import { signal, effect } from '@preact/signals';
import type { ThemeConfig, ThemeRecord } from '@mu/shared';
import { DEFAULT_DARK_CONFIG, DEFAULT_LIGHT_CONFIG } from '@mu/shared';
import { themesApi } from '@/services/themes.service';
import { getUiSetting, setUiSetting } from '@/hooks/useUiSetting';
import { theme } from './theme.state';

export const themesList = signal<ThemeRecord[]>([]);
export const selectedDarkId = signal<string | null>(getUiSetting('theme_dark_id', null));
export const selectedLightId = signal<string | null>(getUiSetting('theme_light_id', null));
export const activeConfig = signal<ThemeConfig>(DEFAULT_DARK_CONFIG);
export const editingThemeId = signal<string | null>(null);

export async function fetchThemes(): Promise<void> {
	try {
		const list = await themesApi.list();
		themesList.value = list;
		// Auto-select defaults if nothing selected
		if (!selectedDarkId.value) {
			const def = list.find(t => t.mode === 'dark' && t.isDefault);
			if (def) setSelectedDarkId(def.id);
		}
		if (!selectedLightId.value) {
			const def = list.find(t => t.mode === 'light' && t.isDefault);
			if (def) setSelectedLightId(def.id);
		}
		applyActiveTheme();
	} catch {}
}

export function setSelectedDarkId(id: string) {
	selectedDarkId.value = id;
	setUiSetting('theme_dark_id', id);
	applyActiveTheme();
}

export function setSelectedLightId(id: string) {
	selectedLightId.value = id;
	setUiSetting('theme_light_id', id);
	applyActiveTheme();
}

export function getResolvedMode(): 'dark' | 'light' {
	const t = theme.value;
	if (t === 'auto') {
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}
	return t;
}

export function applyActiveTheme() {
	const mode = getResolvedMode();
	const id = mode === 'dark' ? selectedDarkId.value : selectedLightId.value;
	const found = themesList.value.find(t => t.id === id);
	const config = found?.config ?? (mode === 'dark' ? DEFAULT_DARK_CONFIG : DEFAULT_LIGHT_CONFIG);
	activeConfig.value = config;
	applyThemeConfig(config);
}

export function applyThemeConfig(config: ThemeConfig) {
	const root = document.documentElement;
	// Accent color
	if (config.accentColor) {
		root.style.setProperty('--color-accent', config.accentColor);
	} else {
		root.style.removeProperty('--color-accent');
	}
	// Page background
	if (config.pageBg) {
		root.style.setProperty('--color-bg-primary', config.pageBg);
	} else {
		root.style.removeProperty('--color-bg-primary');
	}
	// Panel background
	if (config.panelBg) {
		root.style.setProperty('--color-bg-surface', config.panelBg);
		root.style.setProperty('--panel-bg', config.panelBg);
	} else {
		root.style.removeProperty('--color-bg-surface');
		root.style.removeProperty('--panel-bg');
	}
	// Item spacing
	const spacingMap: Record<string, string> = {
		none: '0px', minimal: '4px', compact: '8px',
		normal: '16px', comfortable: '24px', spaced: '48px',
	};
	root.style.setProperty('--item-gap', spacingMap[config.itemSpacing] ?? '16px');
	// Item radius
	root.style.setProperty('--item-radius', `${config.itemRadius}px`);
	// Card border
	const b = config.cardBorder;
	const rgba = `rgba(${parseInt(b.color.slice(1, 3), 16)}, ${parseInt(b.color.slice(3, 5), 16)}, ${parseInt(b.color.slice(5, 7), 16)}, ${b.opacity})`;
	root.style.setProperty('--card-border', `${b.width}px solid ${rgba}`);
	// Disable hover
	if (config.disableHover) {
		root.dataset.nohover = '';
	} else {
		delete root.dataset.nohover;
	}
	// Text scale
	root.style.setProperty('--text-scale', String(config.textScale));
}

// Re-apply when theme mode changes
effect(() => {
	// Access theme.value to subscribe
	const _ = theme.value;
	if (themesList.value.length > 0) {
		applyActiveTheme();
	}
});
```

- [ ] **Step 2: Simplify appearance.state.ts**

Remove the individual signal effects that set CSS variables (they are now handled by `applyThemeConfig`). Keep the setter functions as thin wrappers that update the active theme config and call `applyThemeConfig`. The exact diff depends on the current file — the key change is that individual localStorage keys like `mu_ui_accent_color` are no longer the source of truth; the theme config is.

- [ ] **Step 3: Add fetchThemes to app.tsx init**

In `packages/client/src/app.tsx`, alongside existing init calls:
```ts
import { fetchThemes } from '@/state/themes.state';
// In useEffect:
fetchThemes();
```

- [ ] **Step 4: Build and verify**

Run: `cd src && pnpm build`

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/state/themes.state.ts packages/client/src/state/appearance.state.ts packages/client/src/state/theme.state.ts packages/client/src/app.tsx
git commit -m "feat: add client theme state with apply logic"
```

---

## Task 7: Settings UI — Theme Editor

**Files:**
- Modify: `packages/client/src/pages/Settings.tsx`

This is the largest UI task. Replace the Appearance tab content with:

- [ ] **Step 1: Move Overlay Hide Timeout and Show Recently Played to General tab**

Move the `OverlayTimeoutSetting` and `show_recently_played` toggle from the Appearance section to the General section in Settings.tsx.

- [ ] **Step 2: Add theme mode selector + dropdowns**

At the top of the Appearance section:
- Keep existing Dark/Light/Auto radio buttons
- Add "Dark Theme" dropdown (filtered to mode='dark' themes) with Edit + Import buttons
- Add "Light Theme" dropdown (filtered to mode='light' themes) with Edit + Import buttons
- Dropdowns populated from `themesList` signal
- Selection updates `setSelectedDarkId` / `setSelectedLightId`

- [ ] **Step 3: Add inline theme editor**

When Edit is clicked, expand an editor section showing:
- Theme Name text input
- All existing appearance controls (accent color presets + picker, page bg, panel bg, item spacing dropdown, item radius slider, card border editor, disable hover toggle, font scale, subtitle appearance)
- These controls now read/write from the theme config being edited, not from individual localStorage keys
- Save button → `themesApi.update(id, { name, config })`
- Copy to New button → `themesApi.create({ name: 'Copy of ...', mode, config })`
- Export button → window.open(themesApi.exportUrl(id))

- [ ] **Step 4: Add import functionality**

Import button next to each dropdown:
- Opens a file picker (`<input type="file" accept=".json">`)
- Reads the file, parses JSON
- Calls `themesApi.importTheme(parsed)`
- On success, refreshes theme list and selects the imported theme

- [ ] **Step 5: Build and verify**

Run: `cd src && pnpm build`

- [ ] **Step 6: Manual test**

- Create a custom theme, edit it, verify CSS changes apply live
- Export it, delete it, re-import — verify round-trip works
- Switch between dark/light modes — verify correct theme applies
- Refresh page — verify selected themes persist

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/pages/Settings.tsx
git commit -m "feat: replace Appearance section with theme profile editor"
```

---

## Task 8: Final Integration + Cleanup

- [ ] **Step 1: Run migrate.js to create themes table on dev DB**

```bash
cd src && node scripts/migrate.js
```

- [ ] **Step 2: Full build**

```bash
cd src && pnpm build
```

- [ ] **Step 3: Lint and format**

```bash
cd src && pnpm check
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete theme system — DB, API, editor, import/export"
```

# Theme System Design

## Overview

Replace the current browser-local appearance settings with a database-backed theme profile system. Users can create, edit, import/export, and assign themes independently for dark and light modes.

## Database

### `themes` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL | Display name |
| `mode` | TEXT NOT NULL | `'dark'` or `'light'` |
| `config` | TEXT NOT NULL | JSON blob of theme properties |
| `isDefault` | INTEGER DEFAULT 0 | 1 for built-in defaults |
| `createdBy` | TEXT | User ID of creator (null for built-in) |
| `createdAt` | TEXT NOT NULL | ISO timestamp |
| `updatedAt` | TEXT NOT NULL | ISO timestamp |

### Theme config shape

```ts
interface ThemeConfig {
  accentColor: string;       // hex
  pageBg: string;            // hex
  panelBg: string;           // hex
  itemSpacing: string;       // 'none'|'minimal'|'compact'|'normal'|'comfortable'|'spaced'
  itemRadius: number;        // 0-40
  cardBorder: { width: number; color: string; opacity: number };
  disableHover: boolean;
  textScale: number;         // 0.9-1.3
}
```

### Seed data

Two built-in rows on first run:
- **Default (Dark)** — mode: 'dark', isDefault: 1, config from current dark defaults
- **Default (Light)** — mode: 'light', isDefault: 1, config from current light defaults

### User selection

Stored in existing `settings` key-value table:
- `theme_dark_id` → UUID of selected dark theme
- `theme_light_id` → UUID of selected light theme

## Server API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/themes` | List all themes |
| GET | `/api/v1/themes/:id` | Get one theme |
| POST | `/api/v1/themes` | Create theme |
| PUT | `/api/v1/themes/:id` | Update theme |
| DELETE | `/api/v1/themes/:id` | Delete (not defaults) |
| POST | `/api/v1/themes/import` | Validate + import JSON |
| GET | `/api/v1/themes/:id/export` | Export as JSON download |

Themes cached in-memory on server, invalidated on write.

## Client

### Theme loading flow

1. App boot → fetch `/api/v1/themes`
2. Read `theme_dark_id` / `theme_light_id` from settings
3. Based on current mode (dark/light/auto), apply matching theme config
4. Config applied via existing `document.documentElement.style.setProperty()` — no CSS variable mechanism changes

### Settings > Appearance UI

```
┌─ Theme Mode ──────────────────────────────┐
│  ○ Dark   ○ Light   ○ Auto                │
├───────────────────────────────────────────┤
│ Dark Theme:  [dropdown ▼] [Edit] [Import] │
│ Light Theme: [dropdown ▼] [Edit] [Import] │
├───────────────────────────────────────────┤
│ ▼ Theme Editor (when Edit clicked)        │
│  Name: [___________]                      │
│  Accent Color: [presets] [picker]         │
│  Page Background: [picker]                │
│  Panel Background: [picker]               │
│  Item Spacing: [dropdown]                 │
│  Item Radius: [slider]                    │
│  Card Border: [width] [color] [opacity]   │
│  Disable Hover: [toggle]                  │
│  Font Scale: [scaler]                     │
│  Subtitle Appearance: [collapsible]       │
│                                           │
│  [Save]  [Copy to New]  [Export]          │
└───────────────────────────────────────────┘
```

### Import/Export

- **Import**: File picker → validate JSON → POST to server → auto-select
- **Export**: GET `/themes/:id/export` → downloads `{theme-name}.json`
- **Copy to New**: Clone config, name as "Copy of {name}", save as new

### Settings moved to General tab

- Overlay Hide Timeout (stays in localStorage, global)
- Show Recently Played (stays in localStorage, global)

## Files

### New
- `server/src/database/schema/themes.ts`
- `server/src/themes/themes.module.ts`
- `server/src/themes/themes.service.ts`
- `server/src/themes/themes.controller.ts`
- `client/src/services/themes.service.ts`
- `client/src/state/themes.state.ts`

### Modified
- `server/src/database/schema/index.ts` — export themes
- `server/src/app.module.ts` — import ThemesModule
- `client/src/pages/Settings.tsx` — replace Appearance with theme editor
- `client/src/state/appearance.state.ts` — apply from active theme config
- `client/src/state/theme.state.ts` — integrate with theme selection
- `client/src/app.tsx` — fetch themes on init
- `scripts/migrate.js` — create themes table + seed defaults

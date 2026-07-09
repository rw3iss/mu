# Improvement Audit — 2026-06-09

## 1. Summary

- **Project:** Mu — self-hosted movie streaming platform
- **Working directory:** `/home/rw3iss/Sites/mu`
- **Scope:** the features implemented over the last ~2 days — share-at-time
  (right-click "Copy URL at Time"), share-token playback fix, muted-autoplay
  fallback, Download-for-Offline, profile/sidebar avatar, dashboard growth stat
  + reorganized layout (`HorizontalMoviePager`), sidebar narrowing, member
  presence (`last_progress_at` / `last_seen_at`), Settings scrollbar-gutter, and
  the sidebar collapse-icon fix.
- **Total findings:** 11 (UI: 3, styling: 5, architecture: 3)

The recent work is largely sound. The dominant theme is **styling
consistency**: the new player/portal overlays hardcode dark-theme colors,
shadows, and two *different* max-int z-index values, duplicating values that
already exist as design tokens or as the sibling player menus' styling. The
architecture findings are about consolidating small repeated patterns; they're
deferred to Phase C because they touch shared/pre-existing code.

---

## 2. UI & UX improvements

### 2.1 Share menu visual inconsistency with sibling player menus — `components/player/PlayerControls.module.scss` `.shareMenu`
- **Problem:** The right-click share menu hardcodes `background: var(--color-bg-elevated, #1b2030)`, `box-shadow: 0 10px 30px …`, `border-radius: 10px`, white text. The other player popups (`.menu`, `.volumePopup`) use a shared dark surface, `--shadow-overlay-*`, `backdrop-filter` blur, and `--surface-overlay-*` borders. The share menu looks subtly different (no blur, different shadow/radius) from its siblings.
- **Fix:** Match the established player-menu styling via tokens (see 3.x). **Risk: low.**

### 2.2 `HorizontalMoviePager` not `class`-customizable — `components/movie/HorizontalMoviePager.tsx`
- **Problem:** The new rail can't take a passthrough `class`, so a caller can't tweak spacing/margins without wrapping it. Limits reuse (the focus-area #2 "make custom controls more configurable").
- **Fix:** Accept an optional `class` prop appended to the root. **Risk: low.**

### 2.3 Arrow drop-shadow is a magic value — `components/movie/HorizontalMoviePager.module.scss` `.arrow`
- **Problem:** `box-shadow: 0 6px 18px rgba(0,0,0,0.4)` is a one-off; the app has `--shadow-lg` / `--shadow-overlay` for exactly this.
- **Fix:** Use `var(--shadow-lg)`. **Risk: low.**

---

## 3. Styling & design system

### 3.1 Two different max-int z-indexes for portaled overlays — `PlayerControls.module.scss` (`2147483000`) vs `PlayerControls.tsx` sprite portal (`2147483647`)
- **Problem:** Both portal to `document.body` to paint above the fixed video, but use different magic numbers. There is no token above `--z-player-controls: 600` for "portaled overlay that must beat the fixed video."
- **Fix:** Add `--z-portal-overlay` and use it in both places. **Risk: low.**

### 3.2 Repeated always-dark player-menu background — `.menu`, `.volumePopup`, `.shareMenu`
- **Problem:** `rgba(18, 18, 18, 0.97)` is written three times for the player's always-dark popups.
- **Fix:** Extract `--player-menu-bg` and reference it from all three. **Risk: low.**

### 3.3 Share menu uses raw white rgba instead of the `--on-dark-*` tokens — `.shareMenuLabel`, `.shareMenuBtn`
- **Problem:** `rgba(255,255,255,0.85/0.18/0.06)` and `#fff` are hardcoded; the app has `--on-dark-text-*` and `--on-dark-overlay-*` for fixed-dark chrome exactly like the player.
- **Fix:** Swap to the `--on-dark-*` tokens. **Risk: low.**

### 3.4 Hardcoded transition timings — `.shareMenuBtn` (`120ms ease`)
- **Problem:** One-off duration vs the `--transition-fast` (150ms) token used elsewhere.
- **Fix:** Use `var(--transition-fast)`. **Risk: low.**

### 3.5 Share-menu box-shadow magic value — `.shareMenu`
- **Problem:** `0 10px 30px rgba(0,0,0,0.55)` vs the existing `--shadow-overlay-strong` (`0 12px 32px -8px rgba(0,0,0,0.55)`).
- **Fix:** Use `var(--shadow-overlay-strong)`. **Risk: low.**

---

## 4. Architecture & code quality

### 4.1 Duplicated "dismiss on outside-click + Escape" logic — *Phase C*
- **Problem:** The share menu (`PlayerControls.tsx`), the volume-popup hover bridge, the settings menu, the mobile overflow menu, and `useMenuOpen` each implement variations of "close when you click outside / press Escape." 5+ near-identical effects.
- **Proposed refactor:** A single `useDismissable({ onDismiss, deferBind })` hook (or extend `useMenuOpen`) that owns the document listeners + deferred-bind trick. Migrate callers incrementally.
- **Files affected:** ~5. **Risk: medium-high** (behavioral surface across player popups). Plan separately.

### 4.2 `getLibraryGrowthStats` is single-window; the dashboard stat is meant to grow — *Phase C*
- **Problem:** `MoviesService.getLibraryGrowthStats` hardcodes the 24h window. The feature was explicitly designed to add week/month/year later, and `cachedCountSince` already supports arbitrary windows.
- **Proposed refactor:** Expose a `getGrowthWindows(userId, windows[])` returning a keyed map (`{ since, last24h, last7d, … }`), driven by a declarative window list, so new windows are config, not code. Keep the current shape as a thin adapter.
- **Files affected:** `movies.service.ts`, `movies.controller.ts`, client `movies.service.ts`, `Dashboard.tsx`. **Risk: medium** (changes a public response shape). Plan separately.

### 4.3 `parseDurationSeconds` lives in `auth.controller.ts` — *Phase C*
- **Problem:** A generic "7d"/"15m" → seconds parser sits in a controller; it's reusable (cookie maxAge today, token TTLs / cache TTLs tomorrow).
- **Proposed refactor:** Move to `@mu/shared` (e.g. `parseDurationSeconds`) and import where needed.
- **Files affected:** `shared`, `auth.controller.ts`. **Risk: low-medium** (cross-tier move). Plan separately.

---

## 5. Recommended execution plan

- **Phase A (low risk, applied automatically):**
  - Add `--z-portal-overlay` + `--player-menu-bg` tokens (3.1, 3.2).
  - Tokenize `.shareMenu` (bg, border, radius, shadow, z-index, blur, text) and
    `.shareMenuLabel` / `.shareMenuBtn` (on-dark tokens, transition) (2.1, 3.2–3.5).
  - Point `.menu` / `.volumePopup` backgrounds at `--player-menu-bg` (3.2).
  - Sprite portal z-index → `var(--z-portal-overlay)` (3.1).
  - `.arrow` box-shadow → `var(--shadow-lg)` (2.3).
- **Phase B (medium risk, applied — user pre-approved "all phases"):**
  - `HorizontalMoviePager` `class` passthrough (2.2).
- **Phase C (plan only — needs a dedicated session):**
  - `useDismissable` hook consolidation (4.1).
  - Windowed growth-stats API (4.2).
  - Move `parseDurationSeconds` to `@mu/shared` (4.3).

> Phase C items are left unapplied per the workflow's hard rules (they touch
> shared/pre-existing code or change a public response shape). Run `/implement`
> or the writing-plans skill to turn them into a proper plan.

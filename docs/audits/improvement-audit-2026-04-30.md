# Improvement Audit — 2026-04-30

## 1. Summary

- **Project:** CineHost (Mu) — self-hosted movie streaming and management.
- **Working directory:** `/home/rw3iss/Sites/mu`
- **Scope of this audit:** focused, evidence-based pass over the client (`packages/client/src`). The server has been touched less by recent work and has its own architecture (NestJS modules) that is reasonably consistent already; backend findings are limited to a few cross-cutting items.
- **Total findings:** 18 — UI/UX: 6, Styling: 4, Architecture: 6, Cross-cutting: 2.
- **Convention check:** project uses Biome (tabs, single quotes, trailing commas, semicolons). Findings respect those rules.

This audit favours fixes I can ground in specific files I have direct evidence for over speculative sweeps. It is not exhaustive; a follow-up `/improve` run after Phase A and B land will surface the next layer.

---

## 2. UI & UX improvements

### UX-1. Two pages still inline their own confirm-dialog markup instead of using the shared `ConfirmDialog`
- **Risk:** medium
- **Location:**
  - `packages/client/src/pages/ServerSettings.tsx:206` (Restart confirm) and `:841` (Clear job history confirm)
  - `packages/client/src/components/movie/SubtitlePanel.tsx:464` (delete-subtitle confirm)
  - Inline styles at `pages/ServerSettings.module.scss:537,547` and `components/movie/SubtitlePanel.module.scss:363,374`
- **Problem:** `components/common/ConfirmDialog.tsx` exists and is correctly used by `pages/AdminDashboard.tsx`. Three other places duplicate the overlay/modal markup with their own `confirmOverlay` / `confirmModal` SCSS rules, drifting in animation timing, padding, and background opacity.
- **Fix:** replace each inline confirm with `<ConfirmDialog isOpen onClose onConfirm title message variant=…/>`. Delete the now-orphaned `confirmOverlay` / `confirmModal` SCSS rules.
- **Why it matters:** keyboard focus trap, escape-key handling, scroll lock, animation, and dark/light tokens are already correct on `Modal`/`ConfirmDialog`. The inline copies miss subsets of those.

### UX-2. `MovieOptionsMenu` uses inline yes/no confirm rows for two destructive actions, but a third uses the proper `Modal`
- **Risk:** medium
- **Location:** `packages/client/src/components/movie/MovieOptionsMenu.tsx:249-263, :288-303` (Clear Metadata + Remove from Library use inline confirm rows; Delete from Disk at `:341` uses `Modal`).
- **Problem:** within the same component, two destructive actions confirm via tiny inline rows that re-use menu hover styles, while the third pops a proper modal. Inconsistent + the inline confirms are easy to miss.
- **Fix:** unify on `ConfirmDialog`. Bonus: a single `useDestructiveAction(title, message, fn)` hook collapses the boilerplate.

### UX-3. Effects panel's "toggle" buttons (`Spectrum`, `Visualize`) abuse `resetBtn` styling with an `Active` variant
- **Risk:** low
- **Location:** `components/player/EffectsPanel.tsx` Spectrum + Visualize button JSX, paired with `EffectsPanel.module.scss:resetBtn` + `resetBtnActive`.
- **Problem:** `resetBtn` semantically means "reset". We added a second style on top (`resetBtnActive`) to repurpose it as a toggle pill. Future readers will be confused when "reset" hugs an "active" state.
- **Fix:** add a small `<ToggleButton>` (or `<PillToggle>`) component: `pressed: boolean`, `onClick`, `children`. Use it for Spectrum, Visualize, and likely the future Sharpen/Crop bypass toggles. Keep `resetBtn` as a pure ghost button.

### UX-4. Three movie card variants (`MovieCard`, `MovieListItem`, `MovieLargeCard`) duplicate selection + click + play handlers
- **Risk:** low (extension), medium (refactor)
- **Location:** `components/movie/{MovieCard,MovieListItem,MovieLargeCard}.tsx`
- **Problem:** all three accept the same set of props (`onMovieUpdate`, `onMovieRemoved`, `selectionMode`, `selected`, `onToggleSelect`) and all three implement the same `handleClick` / `handlePlay` / `handleResume` behaviour with identical bodies — only the markup differs.
- **Fix:** extract a `useMovieCardBehavior(movie, props)` hook that returns `{ onClick, onPlay, onResume, onPointerDown, isSelected, ... }`. Each card component becomes pure markup over the hook's return. (Headless logic + presentational layer — exactly the pattern the command brief calls out.)

### UX-5. Audio diagnostic logs left over from device-debug session
- **Risk:** low
- **Location:** `audio/audio-engine.ts:137,180,184,401,424,490,500,505` and a few more — `[audioEngine] attached.`, `resume() resolved`, `setSinkId(default) ok`, etc. ~10 unconditional `console.log` lines.
- **Problem:** these were added during the OS-audio-device debugging session and never gated. Console is noisy in normal use. HLS logs already follow the right pattern: gated by `localStorage.getItem('mu_hls_debug') === '1'`.
- **Fix:** wrap audio-engine logs behind a `mu_audio_debug` localStorage flag, mirroring the HLS pattern. Keep the `console.error` for genuine failures.

### UX-6. `MovieCarousel` wires no movie-update callbacks
- **Risk:** low
- **Location:** `components/movie/MovieCarousel.tsx:74` — renders `<MovieCard movie={movie} />` with no `onMovieUpdate` / `onMovieRemoved`.
- **Problem:** delete-from-disk inside a card on the home/recent carousel won't refresh the carousel. Pre-existing inconsistency with the `MovieGrid` flow that we already fixed.
- **Fix:** pass through the same callbacks (default to `removeMovieFromList` / `updateMovieInList`). This is the small piece of "Drop deleted movies from parent list" that we deferred.

---

## 3. Styling & design system

### ST-1. Hardcoded `rgba(255, 255, 255, …)` (and similar) values scattered across SCSS modules
- **Risk:** low
- **Location:** at least 12 SCSS modules (`PlayerControls`, `EffectsPanel`, `TopBar`, `Sidebar`, `MovieCard`, `RecentlyPlayed`, `Toast`, `FontScaler`, `ColorPicker`, `Button`, `VideoPlayer`, `FileInfoGrid`).
- **Problem:** these break the app's theming story. The light theme defines new `--color-text-*` and `--color-border*` tokens, but a `rgba(255,255,255,0.06)` background in a player popup stays the same in light mode and reads as a pale-white smudge.
- **Fix:** introduce a small set of *surface* tokens — `--surface-overlay-1: rgba(255,255,255,0.06)`, `--surface-overlay-2: rgba(255,255,255,0.10)`, `--surface-overlay-3: rgba(255,255,255,0.15)` — with light-theme overrides (`rgba(0,0,0,…)`). Replace ad-hoc rgbas in player/menu/popup surfaces with the tokens. Don't try to convert *every* call-site — focus on backgrounds, hairlines, and hover/disabled states.

### ST-2. Multiple inline confirm-modal styles drift from each other
- **Risk:** low (deletion, after UX-1)
- **Location:** `pages/ServerSettings.module.scss:537+`, `components/movie/SubtitlePanel.module.scss:363+`.
- **Problem:** redundant once UX-1 lands; deletion is a Phase B follow-up.

### ST-3. Player `.menu` popup uses fixed colour values not tied to theme tokens
- **Risk:** low
- **Location:** `components/player/PlayerControls.module.scss:570-614` (we just touched this for the subtitles-row fix).
- **Problem:** background `rgba(18, 18, 18, 0.97)`, border `rgba(255,255,255,0.08)`, label colour `rgba(255,255,255,0.9)` etc. None of it follows the theme tokens. Light-theme support is broken in this popup.
- **Fix:** apply the new surface-overlay tokens from ST-1 + use `var(--color-text-primary)` for label text and `var(--color-text-muted)` for value text. Keep the dark scheme readable in fullscreen by adding a player-specific override (player surfaces stay dark in both themes if that's intentional).

### ST-4. SCSS uses `@import` rather than `@use` for partials
- **Risk:** medium (Sass deprecation path)
- **Location:** `styles/global.scss` (likely uses `@import 'reset'; @import 'variables'; @import 'mixins'`).
- **Problem:** `@import` is on the long deprecation timeline in modern Sass. Future bumps could break the build.
- **Fix:** migrate to `@use` + `@forward`. This is a small, mechanical change but every consumer that says `@include truncate(2)` becomes `@include mixins.truncate(2)`. Phase C — plan separately.

---

## 4. Architecture & code quality

### AR-1. `audio-effects.state.ts` is becoming a god-module (512 lines)
- **Risk:** medium
- **Location:** `state/audio-effects.state.ts`
- **Problem:** owns EQ state, Compressor state, Video Effects state, Spectrum visualizer state, Compressor visualizer state, Profiles CRUD, profile mutators, untitled-name generation, batch init from localStorage, and re-exports. SRP violation. The Video Effects part has nothing to do with audio at all (we kept it here historically because of the shared profile UI).
- **Fix:** split into:
  - `state/audio-effects.state.ts` — EQ + compressor + spectrum + comp visualizer + their shared init.
  - `state/video-effects.state.ts` — `VideoEffectSettings`, `videoEffects`, `videoEnabled`, `updateVideoParam`, `resetVideoEffects`.
  - `state/audio-profiles.state.ts` — profile signals + CRUD (load/save/update/delete/copy) for all three profile types. The shared `<ProfileControls>` UI moves to consume from here.
  - `audio-effects.state.ts` re-exports from the splits during the transition so call-sites keep working.

### AR-2. `MovieOptionsMenu` is doing too much (446 lines)
- **Risk:** medium
- **Location:** `components/movie/MovieOptionsMenu.tsx`
- **Problem:** owns menu open/close, raise-z-index trick, outside-click handler, refresh-on-action, hide/watched/rescan/refresh-metadata/clear-metadata/remove/delete-from-disk, plus the whole delete-from-disk modal markup. SRP+OCP issue: every new bulk action requires editing this file.
- **Fix:**
  - Extract a `useMenuOpen(ref)` hook for the open/outside-click/raise-z behaviour (also reusable for the Admin dropdown).
  - Move the delete-from-disk modal into its own `DeleteMovieModal` component (it's already a self-contained UI+state).
  - Expose the action set as a typed array (`type MenuAction = { id, label, icon, run(movie), confirm? }`) so the renderer maps over it. This makes adding actions an array entry, not a JSX edit (OCP).

### AR-3. `EffectsPanel.tsx` mixes Tab definitions, profile UI, and per-tab state in one 700+-line file
- **Risk:** medium
- **Location:** `components/player/EffectsPanel.tsx`
- **Problem:** EqTab, CompressorTab, VideoTab, ProfileControls, CollapsibleSettings, and the panel shell all live in one file. Two of those (ProfileControls, CollapsibleSettings) are obviously reusable on their own.
- **Fix:** split:
  - `components/player/effects/ProfileControls.tsx`
  - `components/player/effects/CollapsibleSettings.tsx`
  - `components/player/effects/EqTab.tsx`
  - `components/player/effects/CompressorTab.tsx`
  - `components/player/effects/VideoTab.tsx`
  - `EffectsPanel.tsx` becomes the shell (tabs + close + slot rendering).

### AR-4. The three movie card variants share interfaces but no base; props drift between them
- **Risk:** low (extension), medium (refactor)
- **Location:** see UX-4 (`MovieCard`, `MovieListItem`, `MovieLargeCard`).
- **Problem:** each component has its own copy of the props interface (`MovieCardProps`, `MovieListItemProps`, `MovieLargeCardProps`) — when we add `onMovieRemoved`, we touch all three. The next addition (e.g. `onPlayClicked`) will too.
- **Fix:** define `MovieDisplayProps` once in `components/movie/types.ts`. Three card components extend it. (Pairs naturally with UX-4's `useMovieCardBehavior` hook.)

### AR-5. `useCanvasAnimator` exists, but the player has a *third* hand-rolled rAF loop in `CompressorTab` for the gain-reduction meter
- **Risk:** low
- **Location:** `components/player/EffectsPanel.tsx:381-395`
- **Problem:** ad-hoc rAF + `setReduction(audioEngine.getCompressorReduction())`. We just unified canvas rendering on the new hook; this dB-value polling fits the same pattern at a different layer.
- **Fix:** add `useAnimationFrame(callback, enabled)` next to `useCanvasAnimator`. Both visualizers and the GR meter consume it.

### AR-6. JSON serialization scattered for movie payloads
- **Risk:** low
- **Location:** server side — recently fixed parsing bug in `Fix job history payload: parse JSON string before returning to client` (commit `f2cd92b`) suggests the same shape lives in multiple controllers.
- **Problem:** parse/stringify of `payload`, `subtitleTracks`, `audioTracks`, `extendedData`, `playSettings` happens at multiple seams. Easy to miss one and ship a stringified blob to the client.
- **Fix:** add a small `serializeMovie` / `deserializeMovieFile` pair in `server/src/movies/serializers.ts` that owns this. Every controller that returns these shapes calls through it. Phase C — touches multiple controllers.

---

## 5. Cross-cutting

### CC-1. No central client-side debug-flag registry
- **Risk:** low
- **Location:** `localStorage` keys scattered: `mu_hls_debug`, soon `mu_audio_debug`, plus `mu_no_hover` data-attribute, `mu_position_<id>`, `mu_is_playing`, etc.
- **Fix:** small `src/utils/debugFlags.ts` exporting `isDebug('hls' | 'audio' | 'subtitles')` and a `console.debug.tagged('hls', ...)` helper. Consumers stop reading localStorage directly.

### CC-2. Build-time config — biome schema mismatch warning every CI run
- **Risk:** trivial
- **Location:** `biome.json` first line — schema URL `https://biomejs.dev/schemas/2.4.6/schema.json` vs CLI version `2.4.8`.
- **Fix:** bump the schema URL. Pure cosmetic / removes a recurring warning.

---

## 6. Recommended execution plan

### Phase A — apply automatically (low risk)

These are mechanical and don't change observable behaviour:

- **CC-2** Bump `biome.json` schema URL to match the installed CLI version.
- **UX-5** Gate the `[audioEngine]` `console.log` lines behind a `mu_audio_debug` localStorage flag, mirroring the existing HLS pattern. `console.error` calls stay as-is.
- **UX-6** Pass `onMovieUpdate` and `onMovieRemoved` through `MovieCarousel` to its `MovieCard` children, with the `MovieGrid`-style defaults.
- **AR-4 (partial)** Define `MovieDisplayProps` in `components/movie/types.ts` and make the three card files extend it. No behaviour change; this is purely de-duplication of the prop interface.
- **ST-1 (partial)** Introduce `--surface-overlay-{1,2,3}` tokens in `_variables.scss` (with light-theme overrides). **Do not** rewrite consumers in this pass; tokens become available for new code immediately, and Phase B can convert call-sites with eyes on each one.

### Phase B — apply after user approval (medium risk)

Each of these can be picked individually:

- **UX-1** Replace inline confirm modals in `ServerSettings.tsx` (Restart, Clear Job History) and `SubtitlePanel.tsx` (delete-subtitle) with `<ConfirmDialog>`. Delete the dead SCSS.
- **UX-2** Unify `MovieOptionsMenu` destructive confirms on `<ConfirmDialog>` (Clear Metadata, Remove from Library). Delete-from-Disk keeps its richer modal because it has a radio + folder name preview.
- **UX-3** Add `<ToggleButton>` in `components/common/`, replace the `resetBtn + resetBtnActive` pattern in `EffectsPanel` Spectrum and Visualize buttons.
- **AR-5** Add `useAnimationFrame(callback, enabled)` and adopt it in `CompressorTab`'s reduction-meter loop.
- **ST-3** Apply the new surface-overlay tokens to `PlayerControls.module.scss .menu / .menuRow*` (light-theme support for the player popup).

### Phase C — plan separately (architectural / multi-file)

These deserve their own `/implement` or planning session:

- **AR-1** Split `audio-effects.state.ts` into the three suggested modules with re-export shim.
- **AR-2** Split `MovieOptionsMenu` into `useMenuOpen` + `DeleteMovieModal` + a typed action registry.
- **AR-3** Split `EffectsPanel.tsx` into per-tab files + extract `ProfileControls` / `CollapsibleSettings`.
- **UX-4 + AR-4 (full)** Extract `useMovieCardBehavior` hook to share click/play/resume logic across the three card variants.
- **AR-6** Centralise movie JSON (de)serialization on the server.
- **ST-4** Migrate Sass `@import` → `@use`/`@forward`.

---

## 7. Verification

Each Phase A change is followed by `pnpm check` (Biome lint) and `pnpm --filter @mu/client build` (Vite + tsc). Failures revert the offending edit.

**Phase A applied (2026-04-30):**

| # | Item | Files touched | Build |
|---|------|---------------|-------|
| A.1 | CC-2 — bump biome schema 2.4.6 → 2.4.8 | `src/biome.json` | ✓ |
| A.2 | UX-5 — gate audio-engine logs behind `mu_audio_debug` | `src/packages/client/src/audio/audio-engine.ts` | ✓ |
| A.3 | UX-6 — `MovieCarousel` forwards onMovieUpdate / onMovieRemoved | `src/packages/client/src/components/movie/MovieCarousel.tsx` | ✓ |
| A.4 | AR-4 (partial) — extract `MovieDisplayProps` shared type | new `components/movie/types.ts`; `MovieCard.tsx`, `MovieListItem.tsx`, `MovieLargeCard.tsx` | ✓ |
| A.5 | ST-1 (partial) — add `--surface-overlay-{1,2,3,strong}` tokens with light-theme overrides | `src/packages/client/src/styles/_variables.scss` | ✓ |

**Phase B applied (2026-04-30):**

| # | Item | Files touched | Build |
|---|------|---------------|-------|
| B.1 | UX-1 — replace inline confirms in ServerSettings (Restart, Clear Job History) and SubtitlePanel (delete subtitle) with `<ConfirmDialog>`. Extended dialog with `message: string \| ComponentChildren` and a `loading?: boolean` controlled-mode opt-in. Pruned orphaned `confirmOverlay/Modal/Title/Detail/Actions/Cancel/Delete` SCSS in both modules (kept SubtitlePanel's `.confirmDetail` and `.confirmWarning` body classes since they're rendered inside the dialog). | `components/common/ConfirmDialog.tsx`, `pages/ServerSettings.{tsx,module.scss}`, `components/movie/SubtitlePanel.{tsx,module.scss}` | ✓ |
| B.2 | UX-2 — `MovieOptionsMenu` Clear Metadata + Remove from Library now use `<ConfirmDialog>` instead of inline yes/no rows. Delete-from-Disk keeps its richer modal (radio + folder name preview). Dropped `confirmingRemove` and `confirmingClearMeta` state and the `.confirmRow / .confirmYes / .confirmNo` SCSS rules. | `components/movie/MovieOptionsMenu.{tsx,module.scss}` | ✓ |
| B.3 | UX-3 — new `<ToggleButton>` in `components/common/`. EQ Spectrum and Compressor Visualize buttons swapped from the `resetBtn + resetBtnActive` pattern. Removed the `resetBtnActive` SCSS rule. | new `components/common/ToggleButton.{tsx,module.scss}`; `components/player/EffectsPanel.{tsx,module.scss}` | ✓ |
| B.4 | AR-5 — new `useAnimationFrame(callback, enabled)` hook. CompressorTab's gain-reduction polling loop now uses it (drops the local `rafRef` + manual cancel). | new `hooks/useAnimationFrame.ts`; `components/player/EffectsPanel.tsx` | ✓ |
| B.5 | ST-3 — PlayerControls popup uses the new `--surface-overlay-{1,2}` tokens for hover background and panel border. Panel-background stays dark in both themes by intent (overlays the video). | `components/player/PlayerControls.module.scss` | ✓ |

**Phase C applied (2026-04-30):**

| # | Item | Files touched | Build |
|---|------|---------------|-------|
| C.1 | AR-1 — split `audio-effects.state.ts` (512 lines) into three focused modules. New `state/video-effects.state.ts` owns `VideoEffectSettings`, `videoEffects`, `videoEnabled`, `toggleVideoEffects`, `updateVideoParam`, `resetVideoEffects`. New `state/audio-profiles.state.ts` owns `profiles` signals + load/save/update/copy/delete CRUD for all three profile types. `state/audio-effects.state.ts` keeps just EQ + compressor + visualizer state and re-exports from the splits for backward compat. | new `state/video-effects.state.ts`, new `state/audio-profiles.state.ts`, `state/audio-effects.state.ts` | ✓ |
| C.2 | AR-3 — split `EffectsPanel.tsx` (711 lines) into shell + per-tab files. New `effects/ProfileControls.tsx`, `effects/CollapsibleSettings.tsx`, `effects/EqTab.tsx`, `effects/CompressorTab.tsx`, `effects/VideoTab.tsx`. Shell (`EffectsPanel.tsx`) now ~100 lines and just routes tabs. | new `components/player/effects/{ProfileControls,CollapsibleSettings,EqTab,CompressorTab,VideoTab}.tsx`; `EffectsPanel.tsx` slimmed | ✓ |
| C.3 | UX-4 + AR-4 (full) — extract `useMovieCardBehavior(movie, selectionMode, onToggleSelect)` hook returning `{ onCardClick, onPlayFromStart, onResume }`. All three card variants (`MovieCard`, `MovieListItem`, `MovieLargeCard`) now use the hook instead of duplicated `useCallback` blocks. | new `components/movie/useMovieCardBehavior.ts`; `MovieCard.tsx`, `MovieListItem.tsx`, `MovieLargeCard.tsx` | ✓ |
| C.4 | AR-2 — split `MovieOptionsMenu.tsx` (446 lines). New `components/movie/useMenuOpen.ts` hook owns open/close + outside-click + raise-z-index. New `components/movie/DeleteMovieModal.tsx` owns the delete-from-disk modal markup + flow. `MovieOptionsMenu` now ~280 lines and focused on the menu trigger + actions. Also fixed a stale `setConfirmingRemove(false)` reference left over from Phase B that esbuild didn't catch (no type-check at build time). | new `components/movie/useMenuOpen.ts`; new `components/movie/DeleteMovieModal.tsx`; `MovieOptionsMenu.tsx` rewritten | ✓ |
| C.5 | AR-6 — new `server/src/common/json-fields.ts` with `parseJsonArray`, `parseJsonObject`, `stringifyJsonArray`, `stringifyJsonObject`. Replaced ad-hoc `JSON.parse` / `try-catch` boilerplate at 10+ sites: `movies.service.ts` (two duplicate `parseJson` helpers, plus playSettings merge logic, plus genres aggregation), `library-jobs.service.ts`, `stream.service.ts`, `sharing.controller.ts` (three sites). | new `server/src/common/json-fields.ts`; `movies/movies.service.ts`; `library/library-jobs.service.ts`; `stream/stream.service.ts`; `sharing/sharing.controller.ts` | ✓ |
| C.6 | ST-4 — **N/A**. The codebase has already migrated: `vite.config.ts` injects `additionalData: '@use "..._variables.scss" as *; @use "..._mixins.scss" as *;'`, and `styles/global.scss` uses `@use 'reset'; @use 'animations';`. The only remaining `@import` is `@import url('...google-fonts...')` in `_variables.scss`, which is a CSS-level URL import (different language feature, not deprecated). The audit-author flagged this without confirming current state. No work needed. | — | — |

Final state after Phase A + B + C: `pnpm check` reports 1 warning (pre-existing `VideoPlayer.tsx:31` unused-param, not introduced by this audit). `pnpm --filter @mu/client build` and `pnpm --filter @mu/server build` both succeed.

Changes are staged in the working tree only — no commits.

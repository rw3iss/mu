# Improvement Audit — 2026-05-27

## 1. Summary

- **Project**: Mu — self-hosted movie streaming + management platform
- **Working directory**: `/home/rw3iss/Sites/mu/src`
- **Stack**: NestJS + Fastify + Drizzle/SQLite (server) · Preact + Preact Signals + SCSS Modules + Vite (client) · pnpm + Turborepo monorepo
- **Audit scope**: client UI, styling architecture, shared components, common helpers, SOLID structure
- **Total findings**: 18 (UI: 6, styling: 4, architecture: 8)
- **Phase A applied automatically**: 5 items
- **Phase B applied with judgment**: 2 items
- **Phase C planned**: 4 items
- **Build verification**: `pnpm --filter @mu/client build` green after each change

The codebase already has a mature design-token system (`packages/client/src/styles/_variables.scss`),
disciplined SCSS Modules per component, and a 21-component `common/` library — the
gaps are not foundational, they're around (a) tail-end duplication still living
inline alongside shared utilities, (b) a handful of common components whose
prop APIs diverged from the established convention, (c) a small number of
oversize files (Settings.tsx at 2887 lines is the prime offender) that have
accreted unrelated responsibilities.

This audit prioritises **extension** of what's already there — making custom
controls more reusable, completing the design-token coverage, closing
accessibility gaps — over restructuring.

---

## 2. UI & UX improvements

### UI-1. Modal lacks focus trap, initial focus, and return-focus on close
- **Where**: `packages/client/src/components/common/Modal.tsx`
- **Problem**: Keyboard `Tab` from inside any modal escapes back to the page underneath. No initial focus is set when the modal opens, so screen readers don't get a clean entry point. On close, focus is dropped on the page body rather than returning to the element that opened the modal.
- **Why it matters**: Real a11y regression — keyboard-only users can lose context. Affects every modal in the app (`ConfirmDialog`, `FolderBrowser`, `MoviePicker`, plus 30+ ad-hoc consumers).
- **Fix**: Trap Tab/Shift-Tab to the modal's focusables, set initial focus to first focusable on open, save `document.activeElement` on open and `.focus()` it on close.
- **Risk**: medium (new keyboard behavior). Mitigated by the focus trap being scoped to the keydown handler and the return-focus being guarded by `document.contains(opener)`.
- **Status**: **Applied in Phase B**.

### UI-2. ToggleButton prop API diverged from project convention
- **Where**: `packages/client/src/components/common/ToggleButton.tsx`
- **Problem**: Uses `className` (vs `class` used by 18 of 21 sibling common components), no `style` pass-through, no `...rest` for `data-*` attributes, no `loading` state for async toggles. Inconsistent with Button + IconButton.
- **Why it matters**: Callers can't supply inline `style` for one-off positioning; async toggles (the in-place Auto-EQ sampler in `EqTab` uses a custom CSS spinner inside the button because there's no loading prop) need ad-hoc workarounds.
- **Fix**: Rename `className` → `class`, add `style?`, `loading?: boolean`. Loading state replaces the icon slot with a small spinner and sets `aria-busy`.
- **Risk**: low — zero callers in the codebase pass `className=` (verified by grep).
- **Status**: **Applied in Phase A**.

### UI-3. Toast variant halo backgrounds bypass design tokens
- **Where**: `packages/client/src/components/common/Toast.module.scss:110,119,128,137,100`
- **Problem**: Each toast variant (success/error/warning/info) renders its icon halo with a hardcoded `rgba(...)` literal, and the close-button hover uses `rgba(255, 255, 255, 0.1)`. Border-left already uses semantic tokens; the rest doesn't.
- **Why it matters**: Light theme renders the halos with wrong contrast. Re-theming is impossible without editing this file.
- **Fix**: Add `--color-success-subtle / -error-subtle / -warning-subtle / -info-subtle` to `_variables.scss` (both dark + light blocks). Swap rgba literals for var() calls. Close hover uses `--surface-overlay-1`.
- **Risk**: low (additive tokens; visual delta is sub-perceptual on dark and a real improvement on light).
- **Status**: **Applied in Phase A**.

### UI-4. Tabs component can't carry per-tab badges
- **Where**: `packages/client/src/components/common/Tabs.tsx`
- **Problem**: Existing Tabs accepts `{id, label}` only. `EffectsPanel.tsx:95-129` and `Settings.tsx:720-755` roll their own tab markup because they need (a) a profile-name pill next to the tab label, (b) an "ON" badge for active effects, (c) disabled-tab styling.
- **Why it matters**: 2 pages are missing the existing `Tabs` component's keyboard handling, `role="tablist"`, focus-visible ring, and `aria-selected` annotation.
- **Fix**: Extend Tab type with optional `badge?: ComponentChildren` and `disabled?: boolean`. Render badge inline next to label. Disabled style: `opacity: 0.4, pointer-events: none`.
- **Risk**: low (purely additive — `Plugins.tsx`, the existing consumer, still works).
- **Status**: **Applied in Phase A**. Migration of Settings/EffectsPanel to the upgraded Tabs is **Phase C**.

### UI-5. Toast close button has no `:focus-visible` ring
- **Where**: `Toast.module.scss:87-103`
- **Problem**: All other interactive elements in the app render a 2px accent ring on `:focus-visible`. The toast close button doesn't.
- **Why it matters**: Tab-cycling through toasts skips the close button visually.
- **Fix**: 4 lines of SCSS.
- **Risk**: nil.
- **Status**: **Applied in Phase A**.

### UI-6. Caller-side spinner CSS duplicates Spinner component
- **Where**: `EqTab.tsx:201` `.autoSpinner`, `CompressorTab.tsx:377` `.recycleSpinner`, `JobsPanel.tsx:645` `.miniSpinner`, `ServerSettings.tsx:209`, `GlobalPlayer.tsx:1015-1051`, `VideoPlayer.tsx:203`
- **Problem**: Six locations re-implement a tiny CSS spinner instead of `<Spinner size="sm" />`. Different durations (700ms / 900ms / 800ms), slightly different border thicknesses.
- **Why it matters**: Inconsistent visual rhythm; no single place to tune the spin curve.
- **Fix**: Replace per-site `.foo-spinner` divs with `<Spinner size="sm" />`. With the new `ToggleButton` `loading` prop, EQ/Comp sites no longer need a custom spinner at all.
- **Risk**: low per-site, but 6 sites = scope creep. Defer to a follow-up sweep.
- **Status**: **Phase C planned**.

---

## 3. Styling & design system

### S-1. `formatBytes` duplicated 3× + inlined twice
- **Where**: `AdminDashboard.tsx:422`, `ServerSettings.tsx:42`, `Settings.tsx:140` (prefixed `_` = dead), `FileInfoGrid.tsx:123-126,173-175` (inline magic numbers)
- **Problem**: Slight variations in implementation (one uses constant `k`, another inlines `1024`, the inline version uses different cutoffs and unit names). The dead `_formatBytes` in Settings.tsx will quietly diverge over time.
- **Fix**: New `packages/client/src/utils/format-bytes.ts` — single export, `(bytes, fractionDigits = 1) => string`, base-1024 with B/KB/MB/GB/TB/PB suffixes. Whole-byte values get 0 decimals regardless.
- **Risk**: nil — every call-site behaves identically.
- **Status**: **Applied in Phase A**.

### S-2. Subtle semantic tints absent from token palette
- **Where**: `packages/client/src/styles/_variables.scss`
- **Problem**: `--color-accent-subtle` exists, but `success / warning / error / info` don't have `-subtle` siblings. Every place that renders a tinted halo / banner falls back to inline rgba.
- **Fix**: Add 4 tokens to both dark + light blocks. Default alphas tuned per theme (dark 0.2, light 0.15) for equal perceived weight.
- **Risk**: nil.
- **Status**: **Applied in Phase A** (alongside Toast refactor that consumes them).

### S-3. 237 raw hex colors in component SCSS files
- **Where**: grep `\#[0-9a-fA-F]{3,8}` outside `_variables.scss` / `themes/` = 237 hits
- **Problem**: Many of these are brand colors (IMDb yellow, RT red, MC green inside `MovieScoreChips.module.scss` — these are *correct* literals because they're brand-identity colors). But a significant chunk are reachable semantic colors that should reference tokens.
- **Fix**: Pass through the 237 hits manually, replacing semantic colors with tokens and leaving brand identifiers alone. Bulk find/replace is unsafe — needs per-site judgment.
- **Risk**: medium per-site, low value per-site, high cumulative value. Best executed as a focused sweep when paired with a theme audit.
- **Status**: **Phase C planned**.

### S-4. Tab strips in PlayerControls / EffectsPanel / Settings re-implement tablist markup
- **Where**: `EffectsPanel.tsx:79-114`, `Settings.tsx:720-755`. (PlayerControls does not roll its own tab strip — the agent corrected this earlier.)
- **Problem**: Each of these has identical structure (`<nav class={styles.tabs}><button class={styles.tab + active}>`) but with slightly different SCSS (gap, active indicator color, scroll behavior).
- **Fix**: With the badge-extended Tabs (UI-4), both can adopt the shared component. Settings can swap as-is; EffectsPanel uses the new `badge` prop for its profile-name pills and ON badges.
- **Risk**: medium (touches the page surface; user-visible).
- **Status**: **Phase C planned** alongside Settings.tsx decomposition.

---

## 4. Architecture & code quality

### A-1. Settings.tsx — 2887 lines, mixes ~10 unrelated sub-pages
- **Where**: `packages/client/src/pages/Settings.tsx`
- **Problem**: One file holds the General settings tab, Playback, Account, Library admin tab, Sources, Themes, Encoding, Notifications, plus shared helpers (OverlayTimeoutSetting, etc.). 25 inline `style={{}}` instances. Three pre-existing handlers for the same Tab keyboard navigation. Single Responsibility violated at the file level.
- **Fix**: Decompose into `pages/settings/General.tsx`, `pages/settings/Playback.tsx`, `pages/settings/Account.tsx`, etc. — each <300 lines. The existing `pages/settings/Matching.tsx` + `pages/settings/Users.tsx` already follow this convention.
- **Risk**: high (touches the most-used surface, must preserve every existing tab + setting). Needs a dedicated plan.
- **Status**: **Phase C planned**. Recommend `/implement` with a written plan.

### A-2. PlayerControls.tsx — 1524 lines, mixes seek bar / volume popup / settings menu / mobile-overflow / desktop controls
- **Where**: `packages/client/src/components/player/PlayerControls.tsx`
- **Problem**: Single component renders: time display, seek bar (desktop + mobile variants), VolumeIcon, volume popup, settings menu (quality / audio track / subtitle / theme / encoding submenus), mobile overflow menu, fullscreen button, plugin slots. The render function alone is ~700 lines. ~70 useRef / useState declarations at the top.
- **Fix**: Split into `SeekBar`, `VolumeControl`, `SettingsMenu`, `MobileOverflowMenu` — each handling its own state. Parent becomes a layout shell.
- **Risk**: high (player controls are the highest-traffic UI; regressions are immediately visible).
- **Status**: **Phase C planned**.

### A-3. MovieDetail.tsx — 1207 lines
- **Where**: `packages/client/src/pages/MovieDetail.tsx`
- **Problem**: Single page handles hero render, trailer modal, cast carousel, file info, cached versions, similar movies, watch progress, edit modal, group navigation. Most could be sub-sections.
- **Fix**: Extract `MovieHero`, `MovieTrailer`, `MovieEditModal`, `SimilarMoviesRow`. Parent orchestrates fetch.
- **Risk**: high.
- **Status**: **Phase C planned**.

### A-4. GlobalPlayer.tsx — 1206 lines
- **Where**: `packages/client/src/components/player/GlobalPlayer.tsx`
- **Problem**: One file holds the persistent overlay shell, mode switching (mini / full / split), DOM-move logic, overlay-fade controller, audio attach, HLS recovery, position persistence, watch-history reporting.
- **Fix**: Extract `useOverlayFade`, `useMiniSplitLayout`, `useWatchProgressReporter` hooks. Component itself becomes ~400 lines.
- **Risk**: high — this component is the spine of playback.
- **Status**: **Phase C planned**.

### A-5. Inline icon styles on every `<Icon>` instance
- **Where**: `Icon.tsx:321-326`
- **Problem**: Every `<Icon>` renders with inline `style={{ display:'inline-block', verticalAlign:'-0.15em', flexShrink:0 }}`. Inline beats CSS-module specificity, so any consumer trying to override these via SCSS needs `!important`.
- **Fix**: Move the three properties into a `.icon` class on the SVG; allow callers to override normally.
- **Risk**: medium (the inline-block / vertical-align values were calibrated for current layouts; small visual delta possible).
- **Status**: **Phase B deferred** — the gain is real but visual regression risk exists. Recommend separate verification pass.

### A-6. Cross-tier byte-format duplication
- **Where**: `packages/server/src/health/health.controller.ts` (server-side dirSize logging uses `(size/1e9).toFixed(2)`), `packages/client/src/utils/format-bytes.ts` (client formatter)
- **Problem**: Two formatters, no shared module across the boundary. Acceptable today; would benefit from a `@mu/shared/format` module if more cross-tier helpers accumulate.
- **Fix**: Defer until the second cross-tier helper appears.
- **Risk**: nil today.
- **Status**: **Not actioned**.

### A-7. Stream rate-control profile / encoder config could grow a registry
- **Where**: `packages/server/src/stream/transcoder/transcoder.profiles.ts`
- **Problem**: Four hardcoded quality profiles (480p / 720p / 1080p / 4k). Adding a new profile (e.g. 1440p, mobile-low) means editing one file — fine for now, but if profiles ever become user-configurable, the strategy-registry pattern (already used in `recommendations` + `providers`) would be a natural fit.
- **Fix**: When the need arises, introduce `ProfileRegistry` + `registerProfile` decorator.
- **Risk**: nil — speculative.
- **Status**: **Not actioned** (YAGNI).

### A-8. Tooltip / dropdown / popover behavior re-implemented in 4+ places
- **Where**: `MovieOptionsMenu.tsx` (full menu), `SubtitlePanel.tsx`, `EntitySearchInput`, `ServerSettings.tsx` disk-row tooltip (pure CSS hover), `PlayerControls.tsx` settings menu (click-outside detection)
- **Problem**: Each implementation has its own outside-click detection, focus behavior, positioning, transition. No shared `Popover` / `Menu` primitive.
- **Fix**: Introduce a headless `usePopover` hook that handles outside-click, escape-key, focus return. UI surfaces compose it.
- **Risk**: medium (touches 4+ consumers).
- **Status**: **Phase C planned**.

---

## 5. Recommended execution plan

### Phase A — applied automatically (5 items)
1. ✅ **S-1** — Consolidate `formatBytes` → `utils/format-bytes.ts`. 4 call sites migrated, 1 dead helper removed. Build green.
2. ✅ **S-2** — Add `--color-{success,error,warning,info}-subtle` tokens to both dark and light theme blocks of `_variables.scss`.
3. ✅ **UI-3** — Toast variant halos consume the new tokens; close-button hover uses `--surface-overlay-1`.
4. ✅ **UI-5** — Toast close gets `:focus-visible` ring.
5. ✅ **UI-4** — Tabs gains optional `badge` + `disabled` per tab + accompanying SCSS.

### Phase B — applied with confidence (2 items)
1. ✅ **UI-2** — ToggleButton prop API unified (`class` rename, `style`, `loading`, `aria-busy`). Zero callers used the removed `className` prop, so non-breaking in practice.
2. ✅ **UI-1** — Modal focus trap + initial focus + return focus on close. New a11y behavior; verified build.

### Phase C — Implementation-ready plans (use `/implement` for each)

These four items were analysed by structure-analysis sub-agents and have
file:line citations + ordering recommendations. The plans are
self-contained — hand each to `/implement` for execution.

#### C-1: Settings.tsx decomposition (2880L → ~180L orchestrator)

**Status: 2/8 sub-pages extracted** (About, Notifications). 6 remain.

Tabs to extract (in suggested commit order):

1. ✅ **About.tsx** — done. Static project info, no state.
2. ✅ **Notifications.tsx** — done. 2 toggles, localStorage only.
3. **General.tsx** — Settings.tsx:676-754. State: `showExternalRatings`,
   `showRecentlyPlayed`, `OverlayTimeoutSetting`. Save: `handleSaveRating`
   (Settings.tsx:628-640). Service: `api.put('/settings/rating')`.
4. **Appearance.tsx** — Settings.tsx:756-1538 (~470 lines). Includes the
   theme editor IIFE. State: signal-driven via `theme`/`themesList`/etc.
   Effects: `fetchThemes()` mount.
5. **Playback.tsx** — Settings.tsx:~1540-2014 (~540 lines). Includes
   Encoding subsection + Watch Tracking subsection. State: `defaultQuality`,
   `preferredAudioLanguage`, `autoplay`, `bufferSize`, `skipTimes`, all
   encoding state, `watchedThreshold`, `completedTail`. Save:
   `handleSavePlayback`. APIs: `/settings/playback`, `/settings/encoding`,
   `/settings/watchedThresholdSeconds`, `/settings/completedTailSeconds`.
   **Move `reEncodeOnScan` to Library before this commit** — it leaks
   across tabs today.
6. **Library.tsx** — Settings.tsx:~2017-2719 (~620 lines, largest).
   Subsections: Media Paths, Scan/Re-encode, Auto-scan, Thumbnail size,
   Extended metadata, Sharing, Connected Servers. State: many. Service:
   `sourcesService`, `/sources/scan`, `/settings/library`, `/settings/sharing`,
   `/remote/servers`. Save: `handleSaveLibrary` + `handleScanNow`.
7. **`_shared.tsx`** — `OverlayTimeoutSetting` from Settings.tsx:58-116.
   `CollapsibleSubtitleSettings` from ~157-200 (move inline to Appearance
   if not reused).

**Risk callouts** documented during analysis:
- `reEncodeOnScan` (Settings.tsx:311) is logically Encoding state but
  only read by Library scan. Move into Library.
- `totalMovies` prefetch (Settings.tsx:498-504) only serves Library's
  thumbnail estimate — move there.
- Each sub-page should fetch its own slice of `/settings` on mount;
  cheaper + more isolated than a single parent fetch.
- `_serverStats` polling + `_isLoadingSettings` dead state already
  removed in the cleanup pass.

#### C-2: PlayerControls.tsx decomposition (1524L → ~280-350L shell)

Extract into `packages/client/src/components/player/controls/`:

1. **Prep**: create `controls/` + extract `formatTime` (PlayerControls:193-204)
   to `controls/utils/formatTime.ts`. Extract `useIsMobile` hook from
   PlayerControls:230-255.
2. **VolumeControl.tsx** — PlayerControls:946-975 + the `VolumeIcon`
   sub-component at 481-562. State: `showVolume`, `volumeRef`,
   `volumeHoverTimer`. Callbacks: `handleVolumeChange/Enter/Leave`
   (414-427). Cleanup useEffect: 317-321. ~140 lines.
3. **MobileOverflowMenu.tsx** — PlayerControls:1339-1454. State:
   `showMobileOverflow`, `mobileOverflowRef`. Outside-click: 302-314.
   Imports `VolumeIcon` from VolumeControl. ~140 lines.
4. **SkipControls.tsx** — PlayerControls:690-871 (the back/forward IIFE
   + play button). State: `skipBackOpen`, `skipFwdOpen`, hide timers.
   Callbacks: `armSkip*AutoHide`, `skipBack`, `skipForward`. Parameterise
   `direction: 'back' | 'forward'`. ~200 lines.
5. **SeekBar.tsx** — PlayerControls:582-631. State: `seekHover`,
   `seekHoverX`, `seekBarRect`, `isDragging`, `seekBarRef`, `dragLastSeek`.
   Callbacks: 324-411. Move `renderSpritePortal` + `DRAG_THROTTLE_MS`.
   ~220 lines.
6. **SettingsMenu.tsx** — PlayerControls:977-1333 (heaviest at ~360
   lines). Five sub-panels: main, quality, subtitles, subtitle-manage,
   audio. The subtitle-manage panel (1148-1288) is itself a candidate
   for a further `SubtitleManagePanel.tsx` split.

**SCSS strategy**: Keep `PlayerControls.module.scss` as single source
and import into each child. Don't split SCSS — descendant selectors
(`.controls.miniMode .rightControls …`) would break.

**Risks**: VolumeIcon is shared between VolumeControl + MobileOverflow.
`isMobile` is shared — promote to hook. `session` prop flows into
SettingsMenu in 3 places.

#### C-3: MovieDetail.tsx decomposition (1207L → ~260L parent)

Extract into `packages/client/src/components/movie/`:

1. **PreviewActions.tsx** (already a sub-component in same file) —
   MovieDetail.tsx:1139-1207. Pure relocation.
2. **MovieTitleEditor.tsx** — lines 72-75, 326-372, 449-505. State:
   `editingTitle`, `titleDraft`, `isSavingTitle`, `titleInputRef`.
3. **MovieCastSection.tsx** — lines 261-264, 820-898. State: `showCast`.
4. **MovieFileInfoSection.tsx** — lines 254, 256, 1035-1116. Delegates
   to existing `FileInfoGrid` + `SubtitlePanel`.
5. **`useMovieMatchCandidates.ts` hook** — lines 78-117, 119-144,
   148-171. Encapsulates WS-driven candidate refresh + movie refetch
   callback contract.
6. **MoviePlaySettingsSection.tsx** — lines 254-255, 257, 266-318,
   934-1033. State: `showPlaySettings`, `audioProfiles`, three
   `selectedXProfile`. Effects: profile-load (271-277), sync-from-movie
   (280-289). Risk: `updatePlaySetting` mutates parent — clear callback
   contract `onPlaySettingsChange` required.
7. **MovieActionsBar.tsx** (biggest, do last) — lines 205-252, 588-711.
   State: `inWatchlist`, `showShareModal`, `transcodeProgress`. WS sub
   at 174-203 moves in. Includes the ShareMovieModal (1122-1129).

**Decisions to make up-front**: `onMovieUpdate(Movie)` vs
`onMoviePatch(Partial<Movie>)` — pick one and use uniformly.

#### C-4: GlobalPlayer.tsx decomposition (1206L → ~280L shell)

Extract into `packages/client/src/components/player/hooks/` (and 2
sibling components):

1. **`useOverlayFade.ts`** — GlobalPlayer.tsx:80, 93-123. Returns
   `{resetControlsTimer, cancelTimer}`. Used by SplitPanel below.
2. **`useGlobalPlayerKeybinds.ts`** — lines 134-165.
3. **`useGlobalPlayerEffects.ts`** (bundle of 4) — body scroll lock
   (714-725), document title (168-178), outside-click panel close
   (692-711), session heartbeat (364-374).
4. **`useSubtitleAppearance.ts`** — lines 380-425. Pure DOM-style
   injection.
5. **`useVideoEffectsApplier.ts`** — lines 428-471 + SVG filter
   constants at 754-767. Returns the slope/intercept/gamma/sharpen
   values for the SVG filter block.
6. **`useSubtitleTrackLoader.ts`** — lines 480-622. Refs:
   `cueOriginalsRef`, `cueListRef`, `currentOffsetMsRef`. **Critical**:
   Effect A + Effect B must stay in same hook (the cue WeakMap snapshot
   pairing).
7. **`useVideoElementInteractions.ts`** — lines 304-361. Refs:
   `videoWrapperRef`, `videoClickTimerRef`.
8. **`useFullscreenController.ts`** — lines 79, 625-684. Ref:
   `preFullscreenModeRef`. Returns `handleToggleFullscreen`.
9. **`PlayerHeader.tsx`** — lines 1079-1164. Pure markup.
10. **`SplitPanel.tsx`** — lines 62-71 (move module-level
    `splitWidthSaveTimer` into hook-local) + JSX 800-986. Owns drag-
    handle mouse-capture loop.
11. **`useStreamInitializer.ts`** (biggest, do last) — lines 75-76, 77,
    182-301. The single biggest behavioural concentration; do not
    split further. Touches `restoredAutoplay`, `forceStartPosition`,
    `currentSession`, `streamService.waitForReady`, audio engine.

**Caveat called out by analysis**: There's NO `useWatchProgressReporter`
to extract — that logic lives in `useVideoEngine` / `player.state`, not
in GlobalPlayer. Audit's original C-list mentioned this hook by name;
it doesn't exist here.

### Deferred items — status

- ✅ **UI-6** (caller-side spinner consolidation) — done in Round 1
  alongside the Icon cleanup.
- ✅ **A-5** (Icon inline-style cleanup) — done in Round 1.
- ✅ **A-8** (usePopover) — done in Round 2; migrated Select,
  ColorPicker, EntitySearchInput. CastPhoto + MovieOptionsMenu +
  GlobalPlayer settings menu deferred to the matching Phase C
  decomposition (they're being restructured anyway).
- 🔄 **S-3** (Hex-color sweep) — automated agent pass in progress.
  Targets *.module.scss only, leaves brand identifiers and ambiguous
  cases as literals.
- **A-6** (Cross-tier byte formatter), **A-7** (Profile registry) —
  still YAGNI / premature.

---

## 6. Documentation updates

Internal-only refactors — none touched public APIs, CLI surface, keybinds,
default values, or install/deploy procedures. **No documentation updates
required for Phase A or B items.**

If Phase C items are tackled, the `users-and-permissions.md` reference table
(which mentions Settings tab structure) may need a one-line update reflecting
the split sub-files.

---

## 7. Verification

After each Phase A / B item:
- `pnpm --filter @mu/client build` — passed all iterations.
- `npx tsc --noEmit` — server passed; client surfaced pre-existing cross-package `rootDir` warnings (not introduced by this audit).

No new dependencies were introduced. All edits preserve existing behavior
except where a deliberate improvement is documented above (Modal focus
behavior, ToggleButton API surface).

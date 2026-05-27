# Improvement Audit — 2026-05-27

## 1. Summary

- **Project**: Mu / CineHost — self-hosted movie streaming + management platform
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

### Phase C — planned only (4 items — recommend `/implement` for each)
1. **A-1** Settings.tsx decomposition — split into `pages/settings/{General,Playback,Account,Themes,Sources,Notifications}.tsx`. The two pre-existing sub-pages (`Matching.tsx`, `Users.tsx`) establish the convention.
2. **A-2** PlayerControls.tsx decomposition — extract `SeekBar`, `VolumeControl`, `SettingsMenu`, `MobileOverflowMenu`.
3. **A-3 + A-4** MovieDetail.tsx + GlobalPlayer.tsx decomposition — same pattern: extract sub-sections and custom hooks.
4. **A-8** Introduce shared `usePopover` / `Menu` primitive and migrate the 4+ existing ad-hoc implementations to it.

### Deferred / not actioned
- **A-5** Inline Icon styles — visual-delta risk needs verification.
- **A-6** Cross-tier byte formatter — premature; one duplicate isn't enough to justify a shared module.
- **A-7** Profile registry — speculative.
- **S-3** Hex-color sweep — 237 hits is a focused half-day task on its own.
- **UI-6** Caller-side spinner consolidation — 6 sites, low individual ROI.

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

# Improvement Audit — 2026-05-18

## 1. Summary

- **Project**: Mu (self-hosted streaming platform)
- **Working directory**: `/home/rw3iss/Sites/mu`
- **Focus area** (per user `/improve` args): dynamic themes, styling, app experience
- **Total findings**: 12 (UI: 3, styling: 7, architecture: 2)

The theming foundation is already strong: 47 CSS custom properties, 14 curated themes
in `catalogue.json`, `data-theme` attribute switching, runtime token apply via
`applyThemeConfig`. The work in this pass extends the system without reinventing it.

---

## 2. UI & UX improvements

### UI-1 — Theme switches are instant; jarring on bigger surfaces
**Location**: theme apply path (`themes.state.ts:applyThemeConfig`) → CSS variables on `:root`.
**Problem**: Setting CSS variables doesn't trigger a transition; the whole UI snaps to the new palette.
**Fix**: Add a short opt-in CSS `transition` on root-level color properties so theme switches glide.
Add a `--theme-transition-duration` token to make it themeable / disable-able.
**Risk**: Low.

### UI-2 — Reduced-motion only honored via manual toggle
**Location**: `global.scss:93-100` honors `data-reduce-motion='true'` but doesn't auto-respect
the system `prefers-reduced-motion`.
**Problem**: Users who've set the OS preference still get full motion unless they also toggle.
**Fix**: Add a `@media (prefers-reduced-motion: reduce)` block that mirrors the existing
override. Also add it automatically into the data-attribute pathway so reduce-motion is
effective regardless of source.
**Risk**: Low.

### UI-3 — Selection color is hardcoded (mint green)
**Location**: `global.scss:70-73` uses `rgba(34, 211, 167, 0.3)` and `#ffffff`.
**Problem**: Text selection doesn't follow the active theme accent — looks off-brand in
Cathode / Studio Ghibli / Reading Room.
**Fix**: Use `color-mix(in srgb, var(--color-accent) 35%, transparent)` for the background
and `var(--color-text-primary)` for the foreground.
**Risk**: Low.

---

## 3. Styling & design system

### STY-1 — Missing `--focus-ring` token
**Location**: `_variables.scss` has accent / shadow tokens but no canonical focus ring.
**Problem**: Component `:focus-visible` styles each invent their own outline — visual drift.
**Fix**: Add `--focus-ring` and `--focus-ring-offset` tokens. Update the global `:focus-visible`
rule in `global.scss` to use them. Provide a `@mixin focus-ring` for component-level use.
**Risk**: Low.

### STY-2 — `backdrop-filter: blur(…)` patterns scattered across files
**Location**: Player popovers, settings menus, glass overlays — each defines its own
backdrop-filter + background combo.
**Problem**: Subtle inconsistency in blur radius and background opacity across surfaces.
**Fix**: Add `--surface-glass` and `--surface-glass-blur` tokens + `@mixin glass-surface` so
all "glass" surfaces share one definition.
**Risk**: Low (additive — existing definitions keep working until migrated).

### STY-3 — Accent-derived translucent colors are pre-mixed per theme
**Location**: Each theme in `catalogue.json` re-specifies `color-accent-subtle`,
`color-accent-hover`, etc. as separate hex values.
**Problem**: When a user picks a new accent via ColorPicker, hover/active/subtle don't auto-derive.
**Fix**: Introduce CSS `color-mix()` derivations as a fallback so `--color-accent-subtle`
becomes `color-mix(in srgb, var(--color-accent) 14%, transparent)` when not explicitly set.
Themes that set explicit values still win. Add a `--accent-glow` token for prominent CTAs.
**Risk**: Low.

### STY-4 — Hardcoded `rgba(255,255,255,…)` in player components
**Location**: `PlayerControls.module.scss` (~46 instances), `EffectsPanel.module.scss` (~73),
`GlobalPlayer.module.scss` (~35).
**Problem**: Player UI doesn't track theme — looks identical in Cathode/Studio Ghibli/Light themes.
**Fix**: Migrate selected high-traffic instances to `var(--surface-overlay-1/2/3)`. Targeting
~30 of the worst offenders in PlayerControls first. EffectsPanel + GlobalPlayer deferred to
phase B since they need careful per-rule judgment.
**Risk**: Low for PlayerControls (visual sanity check); medium for the others.

### STY-5 — No `--accent-rgb` token for translucent variants
**Location**: New requirement.
**Problem**: Themes that want a translucent accent shadow can't derive it from `--color-accent`
without knowing the RGB.
**Fix**: Add `--accent-rgb: 6 182 212` (space-separated for `rgb()` modern syntax). Themes set
both `color-accent` and `accent-rgb`. CSS can then `rgb(var(--accent-rgb) / 0.2)` anywhere.
**Risk**: Low.

### STY-6 — New themes worth adding (user request: more dynamic themes)
**Fix**: Add 3 curated themes to `catalogue.json`:
- **Aurora** — cool teal-green-violet, soft north-lights gradient feel
- **Sunset Cinema** — warm coral / persimmon over deep aubergine
- **Vaporwave** — pink/cyan with magenta highlights, retro
**Risk**: Low — pure JSON catalogue additions; the seeder is idempotent and the client picks
them up automatically.

### STY-7 — No `@mixin focus-ring` / `@mixin glass-surface` / `@mixin hover-lift`
**Location**: `_mixins.scss`.
**Problem**: Repeated visual patterns aren't centralised — each component reinvents them.
**Fix**: Add the three mixins. Don't migrate callers in this pass; they'll be adopted
opportunistically.
**Risk**: Low (additive).

---

## 4. Architecture & code quality

### ARCH-1 — Theme apply doesn't reset `accent-rgb`
**Location**: `applyThemeConfig` in `themes.state.ts:55`.
**Problem**: If a theme sets `accentColor` but not `accent-rgb` in `tokens`, the previous theme's
`--accent-rgb` lingers. After we introduce `--accent-rgb`, apply needs to derive it from
`accentColor` when the theme doesn't set it explicitly.
**Fix**: After `setProperty('--color-accent', config.accentColor)`, also write
`--accent-rgb` derived from the same hex.
**Risk**: Low.

### ARCH-2 — `_animations.scss` has a duplicate `.skeleton` definition
**Location**: `_animations.scss` (end of file) and `global.scss:147`.
**Problem**: Two slightly-different shimmer definitions — last-loaded wins; visual drift.
**Fix**: Remove `_animations.scss`'s `.skeleton` since `global.scss` has the canonical version.
Keep the `@keyframes shimmer` so the animation utility remains importable.
**Risk**: Low.

---

## 5. Execution plan

### Phase A (low risk, applied autonomously)
- UI-1: Smooth theme transitions on root color props (with token override).
- UI-2: System `prefers-reduced-motion` support.
- UI-3: Theme-driven selection color.
- STY-1: `--focus-ring`/`--focus-ring-offset` tokens + global usage + mixin.
- STY-2: `--surface-glass`/`--surface-glass-blur` tokens + `@mixin glass-surface`.
- STY-3: Accent-derived `color-mix` fallbacks + `--accent-glow` token.
- STY-5: `--accent-rgb` token + derivation in `applyThemeConfig`.
- STY-6: 3 new themes in catalogue.json.
- STY-7: `@mixin focus-ring`, `@mixin glass-surface`, `@mixin hover-lift` in `_mixins.scss`.
- ARCH-1: Derive `--accent-rgb` from `accentColor` on theme apply.
- ARCH-2: Remove duplicate `.skeleton` from `_animations.scss`.

### Phase B (medium risk — investigated, deferred to Phase C)
- STY-4: **Skipped after investigation.** The player components (PlayerControls,
  GlobalPlayer, InfoPanel, EffectsPanel) are intentionally always-dark surfaces — they
  overlay the video, which means their text/borders must stay light regardless of the
  app theme. The `rgba(255,255,255,…)` hardcodes encode "always-light-on-dark"; the
  surface-overlay tokens encode "subtle-overlay-on-current-theme-surface" which would
  invert to black-on-dark in light theme and disappear. Right migration is to introduce
  a new always-dark overlay token group (`--on-dark-overlay-1/2/3`) rather than reuse
  `--surface-overlay-*`. Moved to Phase C.

### Phase C — applied 2026-05-18

- **`--on-dark-overlay-1/2/3/-strong` + `--on-dark-text-primary/secondary/muted` tokens** added to `_variables.scss`. Fixed white-on-dark values (not overridden in light theme), so always-dark surfaces like the player chrome get a tokenized way to set hover/active/text fills without flipping in light theme. Migrated 24 hardcoded `rgba(255,255,255,…)` instances in `PlayerControls.module.scss` (the worst offender) to the new tokens. EffectsPanel / GlobalPlayer / InfoPanel migration remains opportunistic.

- **ColorPicker.module.scss token migration** — popup is now theme-aware (`--surface-glass-bg`, `--surface-glass-blur`, `--color-text-primary`, `--surface-overlay-1`, `--color-border-strong`, `--color-error`). The sat/hue thumb chrome stays white-on-shadow intentionally because it overlays a full-spectrum gradient canvas.

- **`ThemeSwatchRow` swatch picker UI** — `components/common/ThemeSwatchRow.tsx` + `.module.scss`. Each swatch renders a 96×64 preview gradient from `pageBg → panelBg → accentColor` with the accent dot in the corner and the theme name across the bottom on a dark scrim. Active swatch wears the live `--accent-glow` ring. Wired above both the dark- and light-theme `<Select>` rows in Settings — Select kept for keyboard / accessibility / search.

- **Harmonious accent palette generator** — `deriveAccentVariants(hex)` (RGB→HSL→hex) produces `hover` (+10% L, +5% S), `active` (-10% L, -5% S), `subtle` (rgba @ 0.14), and `rgb` (space-separated) from any base accent. `applyThemeConfig` calls it on every theme apply; each derived value is written only if the theme's `tokens` block doesn't already supply that key. Existing themes that ship explicit values still win — this is the fallback that keeps user-picked accents (via ColorPicker) coherent and lets future minimal themes ship just `accentColor` and get a harmonious palette for free.

Phase C residual (Phase D candidates):
- Full migration of EffectsPanel / GlobalPlayer / InfoPanel hardcoded colors to `--on-dark-*` tokens (~130 instances remaining).
- Adopt `@mixin glass-surface` / `@mixin focus-ring` across remaining popover surfaces (~10 files).

---

## 6. Verification

Build and biome check after each batch. Final deploy via canonical `bash src/scripts/deploy-remote.sh`.

## 7. Docs sync

- This audit file (`docs/improvement-audit-2026-05-18.md`).
- `CLAUDE.md` left unchanged — internal-only refactor; no public API or CLI surface affected.
- New themes appear automatically in the theme picker via the catalogue seeder; no manual doc edits needed.

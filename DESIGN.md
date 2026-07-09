# DESIGN.md — Mu

Design rules for this app. **Every `design-build` request reads this file first.**
Keep it the single source of truth for how the product looks and *feels*. When a
build establishes a new design decision, record it here so later builds stay
consistent.

> **Aesthetic target: a dark cinema lounge — calm, cinematic, content-first.**
> The UI is the unlit room; the **content** (posters, backdrops, video) is the
> only thing that glows. Near-black surfaces with a hint of blue let artwork pop;
> a single cyan "nebula" accent carries every emphasis. Thin geometric type,
> generous air, glassy floating chrome, and motion that is *silky, never snappy*.
> The design/build target is the Preact client at **`src/packages/client`**. The
> runtime source of truth for every token is `src/styles/_variables.scss` (`:root`),
> mirrored by mixins in `src/styles/_mixins.scss`. **Never hard-code a value a
> token already covers, and never invent a new color, font, or radius.**

---

## Product context

Mu is a **self-hosted movie streaming + library manager** — think
a private, beautiful Plex/Jellyfin: browse a personal film library, see rich
metadata and artwork, and play with a persistent overlay player. Reference DNA
(directional only): a darkened theatre lobby, the Criterion Channel's restraint,
Letterboxd's content-forward grids, Apple TV's calm motion — explicitly **not** a
SaaS dashboard, not a dense data-table admin, not a neon gamer skin. Everything
serves the artwork: chrome recedes, posters and backdrops carry the color.

## Aesthetic — general look & feel

- **Dark theatre by default.** Near-black, faintly-blue surfaces (`#050709` → a
  short ladder of elevated greys) so poster art and video are the brightest thing
  on screen. The room is dim on purpose.
- **One accent, used like punctuation.** Cyan **nebula glow** (`--color-accent`)
  is the *only* structural accent — active states, focus rings, the resume/progress
  bar, primary CTAs, key numerals, selection. Structural, **not** decorative; keep
  it under **~10%** of surface area. A faint accent glow (`--shadow-glow`,
  `--accent-glow`) is the app's signature "lit" detail.
- **Soft realism, low contrast chrome.** Surfaces sit on tight, soft drop shadows
  (`--shadow-card`), hairline borders (`--color-border` ≈ 7% cool-grey), and lift
  gently on hover. Nothing is flat-digital; nothing is heavy.
- **Content over chrome.** Cards are poster-dominant; titles, meta, and ratings
  float **over** the artwork on a sharp bottom gradient scrim, not in a separate
  text box that steals height. Let the grid breathe.
- **Thin, cinematic type.** Outfit at light/normal weight, airy line-height. Type
  is quiet structure, not a billboard.
- **Quiet, eased motion.** Long, soft transitions; gentle hover lifts; a curated
  easing vocabulary shared app-wide. Nothing flashes, bounces gratuitously, or
  loops. Motion should read as *one* language (see [Motion](#motion)).
- **Two themes, and fully user-themeable.** Dark (default) and light are both
  first-class, and every palette/spacing/radius value is live-editable by the user
  in **Settings → Appearance**. Every new surface must look right in **both** themes
  and survive an arbitrary user palette — because it will get one.

## Layout & spacing

- **App shell:** a persistent left **sidebar** (`--sidebar-width` 240px, collapses
  to `--sidebar-collapsed-width` 64px), a slim **topbar** (`--topbar-height` 56px),
  and a scrolling content column. On mobile the sidebar gives way to a fixed bottom
  nav (`--mobile-nav-height` 56px) — pages pad their bottom by that amount.
- **The persistent player** is an overlay, not a route — a glassy bar
  (`--player-bar-height` 105px) docked bottom, or a floating mini-player
  (`--player-mini-width/height`). The video element stays mounted across
  mini ↔ full transitions; never tear it down to re-style.
- **Spacing scale only:** `--space-xs/sm/md/lg/xl/2xl` = 4 / 8 / 16 / 24 / 32 / 48px.
  Prefer `flex`/`grid` + `gap` over margins. Grid gaps use `--item-gap` (a
  user-tunable alias defaulting to `--space-lg`).
- **Generous, even rhythm.** Cards are poster-aspect tiles in a responsive grid;
  give rows room. Section headers are quiet (label color, medium weight), separated
  by hairline rules — not boxes.
- **Hairline dividers, not borders-as-boxes.** Use `--color-border` /
  `--color-border-strong` for separation; reserve full card borders for the
  user-tunable `--card-border`.

## Color

All color is **token-driven** CSS custom properties — consume `var(--*)` only; never
introduce a raw hex/rgb or a new hue. Derive tints with
`color-mix()` or the `rgb(var(--accent-rgb) / <alpha>)` pattern. The dark `:root`
block is the default; `[data-theme='light']` overrides the **same token names**, so
**component CSS never branches on theme.**

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--color-bg-primary` / `-secondary` / `-tertiary` / `-surface` / `-elevated` | Near-black→grey ladder. `#050709` page → `#10141e` elevated. `--panel-bg` is the sidebar/header fill (user-tunable). |
| Hover fill | `--color-bg-hover` | Highlight behind rows, nav/menu items on hover. User-tunable (`config.hoverBg`); sits a touch above elevated. |
| Ink (text) | `--color-text-primary` / `-secondary` / `-muted` / `-inverse` | `#d8dee9` primary → muted `#3d4560`. Plus semantic `--color-label`, `--color-hover-text`, `--color-input-text` (all user-tunable). |
| Accent (cyan) | `--color-accent` / `-hover` / `-active` / `-subtle` + `--accent-rgb` + `--accent-glow` | `#06b6d4`. `--accent-rgb` (space-separated) builds any-alpha fills; `applyThemeConfig()` re-derives accent variants from the user's accent so hover/active/subtle stay harmonious. |
| Secondary accent | `--color-accent-secondary` / `-hover` | Deep blue `#2563eb` — gradients, dual-tone marks (logo, avatars). |
| Status | `--color-success` / `-warning` / `-error` / `-info` (+ `-subtle` tints) | Green/amber/red/blue for state only — never as decoration. |
| Lines | `--color-border` / `-border-strong` | ~7% / ~15% cool-grey hairlines (flip to black-alpha in light). |
| Overlays | `--surface-overlay-1/2/3/-strong` | Theme-flipping translucent fills (rows, sliders, toggles) — use these instead of ad-hoc `rgba(255,255,255,…)`. |
| On-dark | `--on-dark-overlay-*`, `--on-dark-text-*`, `--shadow-overlay*` | **Stay dark in light theme** — for chrome that overlays video (the player bar/popovers). Player components use these, never the theme-flipping variants. |

- **Glow is the signature.** Prominent CTAs and focus emphasis carry a soft accent
  halo (`--accent-glow`, `--shadow-glow`); keep it subtle (low alpha) — a hint of
  light, never a neon ring.
- **Light theme = clean, near-white (never pure white) paper** — softer shadows,
  accent tilts slightly deeper. Test every new surface in both.
- **Respect user palettes.** Because users edit `accentColor`, backgrounds, text,
  hover, and inputs live, never assume a specific contrast — read from tokens so an
  odd palette still resolves to *something* legible.

## Typography

- **`Outfit`** (`--font-family`) — the entire UI: thin, geometric, cinematic. Loaded
  via a `<link>` in `index.html` (preconnect + parse-time link), **not** a blocking
  `@import`, so a late font swap can't reflow into an interaction.
- **`JetBrains Mono`** (`--font-family-mono`) — timecodes, durations, file/codec meta,
  numeric tickers. Tabular by intent.
- **Weights:** `--font-weight-light` 300 · `normal` 400 · `medium` 500 · `semibold`
  600 · `bold` 700. Default to **light/normal** for body and large display (the thin,
  airy feel); `medium`/`semibold` for emphasis, labels, and headings.
- **Sizes** scale off a single `--text-scale` multiplier (user-tunable per theme and
  globally): `--font-size-xs … -4xl` (`0.75rem … 2.5rem`, all `calc(_ * --text-scale)`).
  **Always size with these tokens**, never raw `rem`/`px`, so the user's font-scale
  works.
- **Line-heights:** `--line-height-tight` 1.2 (display) · `normal` 1.55 (body) ·
  `relaxed` 1.75 (long prose).
- Bind to the token (`font-family: var(--font-family)`), **never** a literal family.

## Shape, depth & borders

- **Radius scale:** `--radius-xs` 2 · `--radius-sm` 4 · `--radius-md` 8 · `--radius-lg`
  12 · `--radius-xl` 16 · `--radius-full` 9999. Plus **`--item-radius`** (user-tunable,
  default a crisp **3px**) for cards/tiles — restrained and modern, not pillowy. Pills
  and avatars → `--radius-full`.
- **Shadows, two families.** *Surface* cards use the soft, tight
  `--shadow-card` / `--shadow-card-hover` (negative-spread, barely-there). *Floating*
  panels use the deeper `--shadow-sm/md/lg/xl`. Player/overlay chrome uses the
  always-dark `--shadow-overlay*`. The accent halos (`--shadow-glow`, `--accent-glow`)
  are for emphasis only.
- **Borders:** the user-tunable `--card-border` on cards; hairline `--color-border`
  elsewhere. On hover, surfaces warm their border toward `--color-border-strong` (cards)
  — subtle, not a color jump.
- **Glass.** Floating chrome (player popovers, settings menus, the player bar) uses
  the `@include glass-surface` / `@include glass` backdrop-blur pattern (`--surface-glass-*`).
  Glass is for **overlays only** — never a default page surface.

## Motion

Motion is a first-class part of the feel — **calm, cinematic, and consistent.** Treat
the easing tokens below as a shared vocabulary; every new transition should pick one,
not invent a bespoke `cubic-bezier`.

- **Easing vocabulary** (use these, nothing else):
  - `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)` — soft landing. Panels, fades, reveals, hover lifts. **The default.**
  - `--ease-in-out` `cubic-bezier(0.4, 0, 0.2, 1)` — material movement. Position/size changes, drawers, the sidebar collapse.
  - `--ease-snap` `cubic-bezier(0.22, 1, 0.36, 1)` — crisp, decisive. Toggles, small state flips.
  - `--ease-spring` `cubic-bezier(0.34, 1.56, 0.64, 1)` — a single overshoot for **deliberate "pop" feedback only** (a confirmation, a count badge). Never on routine hovers.
- **Durations:** `--transition-fast` 150ms (hovers, color/bg) · `--transition-normal`
  250ms (cards, panels) · `--transition-slow` 400ms. Composed presets to drop straight
  into `transition:` — `--transition-pop` (220ms spring), `--transition-snap` (180ms
  snap), `--transition-panel` (280ms ease-out).
- **Hover feel.** Buttons/rows/nav items fade `background-color` + `color` over **150ms**
  with `--ease-*` (or the fast preset). Cards use `@include hover-lift` (a −2px
  translate + a soft shadow step via `--ease-out`) or `@include card`. Calm, never
  jumpy. Slow image zooms (`scale(1.02–1.05)`) on poster/backdrop hover read as
  "cinematic," not "snappy."
- **Hover must be silky — and these rules are non-negotiable** (hard-won):
  1. **An element's own `transition` must never be swapped mid-interaction.** If a
     global rule (e.g. the theme crossfade) forces a *different* transition timing
     onto an element while it's idle and then the element switches to its own timing
     on hover, the browser cancels + restarts the running transition — a visible
     first-hover *blink*. Component rules own their transition; global helpers must
     be **zero-specificity (`:where()`) and never `!important`**, so a component's own
     transition always wins and stays constant.
  2. **Don't transition inherited properties globally** (`color` / `fill` / `stroke`).
     A hover target animating its own `color` passes the animating value down to its
     children; a *second*, competing transition on the same inherited value on those
     children cancels/restarts and blinks. Crossfade only **non-inherited** props
     (`background-color`, `border-color`).
- **Theme crossfade.** Switching palettes glides the root color tokens over
  `--theme-transition-duration` (220ms) instead of snapping. It is **armed only after
  the initial load settles** — a page load **never** opens a transition window (that
  raced the first hover and caused intermittent blinks). It fires **only** on genuine
  user theme switches, and transitions only `background-color`/`border-color`.
- **Hover gating.** Wrap interactive `:hover` so it can be globally disabled:
  `:root:not([data-no-hover]) &:hover { … }`. The user's "disable hover" appearance
  setting sets `data-no-hover` on `<html>`.
- **Reduced motion.** Honor it: `@media (prefers-reduced-motion: reduce)` **and** the
  user's `data-reduce-motion="true"` attribute both zero out transitions/animations
  globally (and `--theme-transition-duration`). Never rely on a transition to reach a
  final state — the end-state must be valid with motion off.
- **Never block on motion.** Animate in, but render the final/usable state
  immediately; nothing should be stuck invisible waiting on an animation.

## Components

Design every recurring surface as a **self-contained, reusable block** — a Preact
component with a co-located `*.module.scss` that consumes shared tokens/mixins rather
than redefining them. If a pattern could appear elsewhere, build it liftable. Primitive
"common" controls live in `src/components/common/`; feature blocks in
`src/components/<feature>/`; route screens in `src/pages/<Page>/`.

**App shell**
- **Sidebar** — persistent left nav (`panel-bg`), collapsible; nav items fade
  `--color-bg-hover` / `--color-hover-text` on hover (150ms, gated). A bottom-anchored
  group (recently-played list + user/logout row) is pinned to the bottom via a single
  `margin-bottom: auto` on the nav list — never two competing auto-margins.
- **Topbar** — slim, with search and global actions.
- **Mobile bottom nav** — fixed, replaces the sidebar under `@include mobile`.
- **Global player** — persistent overlay (mini ↔ full), glassy on-dark chrome,
  scrubber + sprite-sheet seek preview; uses `--on-dark-*` tokens so it stays dark in
  light theme.

**Common primitives** (`src/components/common/`)
- **Button** — variants (primary = accent fill + halo, secondary = surface fill +
  hairline). `:active` parity for touch. `@include focus-ring`.
- **Select / Dropdown** — themed; **never a native `<select>`** (can't be themed
  cross-browser, breaks the aesthetic).
- **Modal / Portal / Tooltip** — `createPortal` to `document.body` to escape
  `overflow: hidden`; dark scrim, glass panel, scroll-lock.
- **ColorPicker, RatingBadge, Spinner, SmartImage** (lazy/skeleton image),
  **ConfirmDialog**.

**Content**
- **Movie card** — poster-dominant tile. Title, year, and a ratings row **float over
  the poster bottom** on a sharp gradient scrim (transparent → ~70% at the base) in a
  theme color; the user's personal rating leads the ratings row; an options
  (ellipsis) menu sits in a corner (portaled so it isn't clipped by the poster's
  `overflow`). A resume/progress bar hugs the bottom edge. Slow zoom on hover.
- **Group / collection / series tile** — same poster-overlay treatment; title + item
  count top, type badges bottom, options menu (Confirm / Ungroup / Delete) corner.
- **Movie detail** — backdrop hero, poster, metadata, ratings, cast, actions
  (Play / Watchlist / Share / Similar).
- **Theme editor** (Settings → Appearance) — live color pickers + range controls
  grouped into spaced sections (Backgrounds · Text · Items · Hover · Inputs · Text
  Size), each bound to a `ThemeConfig` field and applied to `:root` in real time.

## Standards — do NOT introduce

- **No raw hex/rgb, invented hues, fonts, or radii — tokens only.** An unresolved
  `var()` silently falls back and breaks the look; look the token up first.
- **No native `<select>`** — use the themed Dropdown.
- **No neon/loud glow, gradient text, or emoji in UI.** The glow is a hint, not a sign.
- **No glassmorphism as a default surface** — overlays only (player, popovers, menus).
- **No theme branching in components** (`if [data-theme=light]`) — override token
  *values*, never component rules.
- **No `transition: all`, no `!important` on shared/global transition rules**, and no
  global transitions on inherited properties (see [Motion](#motion)) — these cause the
  hover blink.
- **No layout that assumes a fixed palette/contrast** — it will get a user palette.

## Responsive

Mobile-first; layer up with the breakpoint mixins (auto-injected into every module via
Vite `additionalData`, so no `@use` needed):

- Breakpoints: **mobile** ≤767 (base) · **tablet** 768–1023 · **desktop** ≥1280
  (`$breakpoint-mobile/tablet/desktop`).
- Mixins (`src/styles/_mixins.scss`): `@include mobile` / `tablet` / `desktop` /
  `tablet-up` / `desktop-down`; plus `@include card`, `hover-lift`, `glass` /
  `glass-surface`, `flex-center`, `truncate($lines)`, `scrollbar`, `focus-ring`.
- The sidebar collapses → bottom nav on mobile; the player docks differently; grids
  reflow column counts. Touch gets `:active` parity and avoids stuck `:hover`.

## Theming

- **Dark by default; light via `<html data-theme="light">`.** Both are first-class.
- **Fully runtime-themeable.** `ThemeConfig` (`@mu/shared` `theme.ts`) carries the
  editable surface — `accentColor`, `pageBg`, `panelBg`, `hoverBg`, `labelColor`,
  `textColor`, `buttonBg`, `buttonText`, `hoverText`, `inputBg`, `inputText`,
  `itemSpacing`, `itemRadius`, `cardBorder`, `textScale`, plus a free-form `tokens`
  map for richer palette overrides. `applyThemeConfig()` writes these to `:root` and
  derives accent variants (`--accent-rgb`, `-hover`, `-active`, `-subtle`) from the
  chosen accent so the palette stays coherent.
- **Persisted + restored before paint** (theme choice via `useUiSetting` →
  localStorage; applied early to avoid FOUC). The crossfade is **armed only after the
  initial load** (see [Motion](#motion)).
- **Appearance attributes on `<html>`:** `data-theme`, `data-no-hover` (disable hover),
  `data-reduce-motion`, `data-theme-transitioning` (the crossfade window). Components
  react via tokens/gates, never by reading these directly (except the documented gates).

## Token / variable system — rules

1. **Consume, don't invent.** Every color, font, size, radius, shadow, easing, and
   z-index has a token in `_variables.scss`. Use `var(--*)`; never guess a name.
2. **Theme via tokens only.** Override token *values* (`:root` / `[data-theme]` /
   `applyThemeConfig`), never branch component rules on theme. Test new surfaces in
   light *and* dark *and* under a non-default user accent.
3. **Derive tints** with `color-mix(...)` or `rgb(var(--accent-rgb) / <a>)` from an
   existing token — don't add a near-duplicate.
4. **Size with `--font-size-*` and `--text-scale`** so the user's font scale works;
   never raw `rem`/`px` for type.
5. **Spacing & radius come from the scale** (`--space-*`, `--radius-*`, `--item-gap`,
   `--item-radius`); prefer `gap` layouts over margins.
6. **Motion is a vocabulary** (`--ease-*`, `--transition-*`); pick one, and gate it
   for reduce-motion + `data-no-hover`.
7. **Z-index from the scale** (`--z-dropdown` 100 → `--z-player-controls` 600) — never
   a raw magic z value.

## Engineering conventions

- **Preact 10 + TypeScript + SCSS Modules + Vite 6.** Use Preact `class=` (not
  `className`); state via **Preact Signals**, not React `useState` patterns.
- **One component, one folder-or-pair:** `Component.tsx` + co-located
  `Component.module.scss`. `_variables.scss` and `_mixins.scss` are **auto-injected**
  into every module (Vite `additionalData` `@use … as *`), so component SCSS uses
  `var(--*)`, `@include`, and `$breakpoint-*` **directly — no per-file `@use` of the
  shared files.**
- **Tokens are CSS custom properties in `:root`** (runtime-themeable). Mixins/breakpoint
  vars are the Sass layer.
- **Keep `COMPONENT_INDEX.md` current** — every new shared component, hook, util, or
  SCSS mixin/class gets a row (path · purpose · reuse-for). Consult it before building.

## Notes / migration

- `--item-radius` defaults to a sharp **3px** (modern, not rounded) — respect it for
  tiles; don't reintroduce heavily-rounded cards.
- Older code may use ad-hoc `rgba(255,255,255,…)` overlays — **new** work uses
  `--surface-overlay-*` (theme-flipping) or `--on-dark-overlay-*` (player/over-video).
- The hover/crossfade rules in [Motion](#motion) are the product of real bugs — treat
  them as load-bearing, not suggestions.

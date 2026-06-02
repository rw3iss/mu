# Improvement Audit — 2026-06-01

> Focus for this run (per request): **higher-class UI polish + suggested
> features.** Architecture/code-quality findings are carried forward from
> the 2026-05-27 audit rather than re-derived; this document concentrates
> on felt quality (motion, elevation, interaction states) and a feature
> roadmap.

## 1. Summary

- **Project**: Mu / CineHost — self-hosted movie streaming + management platform
- **Working directory**: `/home/rw3iss/Sites/mu/src`
- **Stack**: NestJS + Fastify + Drizzle/SQLite (server) · Preact + Signals + SCSS Modules + Vite (client)
- **Audit scope**: client UI polish, motion design, elevation system, reusable-component gaps, feature roadmap
- **Total findings**: 16 (UI/motion: 7, styling/tokens: 4, features: 5 roadmap items)
- **Phase A applied automatically**: 3 items
- **Phase B applied (user-approved)**: 5 items (M-2, M-3, M-4, M-5, M-6); **M-7 deferred** by choice
- **Phase C (features + decompositions) planned**: see §5
- **Build**: `pnpm --filter @mu/client build` green after Phase A and after Phase B

### Headline finding

The design system is **mature at the token layer and dead at the motion
layer.** `_variables.scss` ships a full easing/transition vocabulary
(`--ease-out`, `--ease-spring`, `--ease-snap`, `--transition-pop/snap/panel`)
and `global.scss` / `_animations.scss` define `slideUp`, `scaleIn`,
`.animate-fadeIn`, `.animate-slideUp`, `.press`, `.lift`, `.stagger`-ready
keyframes — **all of which are referenced zero times across the client.**
The four richest utility mixins (`focus-ring`, `hover-lift`, `card`,
`glass-surface`) are likewise defined and never `@include`-d.

Net effect: every page pops in fully-formed with no sequencing, hierarchy,
or tactility. That single gap is why a feature-rich app reads as "static"
rather than "premium." Closing it is unusually low-risk because the
infrastructure already exists and is already gated behind the global
`prefers-reduced-motion` / `data-reduce-motion` override — we are *wiring*,
not *inventing*.

---

## 2. UI & Motion improvements

### M-1. Content surfaces have no entrance choreography  ✅ Phase A
- **Where**: `pages/Dashboard.module.scss:1-3` (blunt whole-page `fadeIn`), every grid/row across the app.
- **Problem**: The dashboard fades the entire container as one opacity sweep; sections, rows, and cards all arrive simultaneously. No stagger, no rise, no sense of depth. The `slideUp` keyframe that would fix this exists and is unused.
- **Why it matters**: Sequenced entrance is the single biggest "expensive app" signal. Netflix/Plex/Apple TV all stagger content in. We have the keyframes; we just never called them.
- **Fix**: Add a reusable `.stagger-rise` utility to `global.scss` (direct children rise+fade with incremental `animation-delay`, `both` fill so they don't pre-flash). Apply to the Dashboard container so the welcome row + each section cascade in. Reduce-motion neutralises via the existing global override.
- **Risk**: low — additive utility, final state is identical to today, reduce-motion safe.
- **Status**: **Applied in Phase A.**

### M-2. Movie grids/rows do not stagger their cards  🔶 Phase B
- **Where**: `components/movie/MovieGrid.tsx:176-193` (`.grid`/`.largeGrid`/`.list`).
- **Problem**: Cards render all at once. On a 24-card library page that's a wall of content with no rhythm.
- **Why it matters**: Reuses the `.stagger-rise` primitive from M-1 for a coherent, app-wide motion language.
- **Fix**: Apply a capped stagger (first ~12 children get incremental delay, rest snap in) to the grid containers. Cap avoids long tail-delays on big pages, and gate re-animation so it only plays on first mount / route change, not on every filter/sort re-render.
- **Risk**: medium — grid re-renders on filter/sort; needs a guard so motion doesn't replay annoyingly. That guard is why it's Phase B, not A.
- **Status**: **Applied in Phase B.**

### M-3. No tactile feedback on click  🔶 Phase B
- **Where**: app-wide; `.press` utility defined at `global.scss:177-183`, used 0×.
- **Problem**: Buttons and cards have hover states but no active/press response. Modern UIs give a subtle scale-down on press.
- **Fix**: Add `.press` to the shared `Button`, `IconButton`, `MovieCard`, and primary CTAs (or bake the `:active { transform: scale(.97) }` into those components directly).
- **Risk**: low-medium (touches shared components; visual only).
- **Status**: **Applied in Phase B.**

### M-4. Silent load failures on the Dashboard  🔶 Phase B
- **Where**: `pages/Dashboard.tsx:38-39`.
- **Problem**: `Promise.allSettled` swallows rejected sections; failures only hit `console.error`. A user whose "Trending" call 500s sees an empty space with no explanation.
- **Fix**: On any settled-rejected slice, fire a `notifyError` toast ("Couldn't load trending") and/or render a per-section retry affordance. Keep the resolved sections rendering.
- **Risk**: low.
- **Status**: **Applied in Phase B.**

### M-5. Native `confirm()` breaks design coherence  🔶 Phase B
- **Where**: `pages/settings/Users.tsx:58,80`, `pages/GroupDetail.tsx:168` (3 real call sites; an earlier agent's History/Admin claims were false — verified).
- **Problem**: Destructive actions (delete user, ungroup) use the browser's native `confirm()` dialog — jarring against an otherwise custom-styled app, and unthemed.
- **Fix**: Route through the existing `ConfirmDialog` component (already used elsewhere). Async-await a promise-based confirm helper or local open-state.
- **Risk**: low-medium (behavioral; must preserve the cancel path).
- **Status**: **Applied in Phase B.**

### M-6. No `Tooltip` primitive — everything uses `title=`  🔶 Phase B
- **Where**: ~all icon buttons (player controls, card options, EQ help `?`, etc.).
- **Problem**: Native `title=` tooltips are slow (≈1s delay), unstyled, can't be themed, and vanish on touch. There is no shared `Tooltip` component despite a `usePopover` hook already existing.
- **Fix**: Add `components/common/Tooltip.tsx` (headless positioning via `usePopover` + styled surface using `--surface-glass-*` and `--shadow-overlay`). Wire it into a handful of high-traffic icon buttons as the first consumers; leave the long-tail `title=` migration as a follow-up sweep.
- **Risk**: low (new opt-in component; doesn't remove `title=` until each site migrates).
- **Status**: **Applied in Phase B.**

### M-7. Loading = bare centred spinner → layout shift  🔶 Phase B
- **Where**: `components/movie/MovieGrid.tsx:111-117` (one big `<Spinner>` for the whole grid).
- **Problem**: The grid shows a single centred spinner, then snaps to cards — a visible layout jump. The `.skeleton` shimmer utility (global.scss:240) exists and is unused here.
- **Fix**: Render N skeleton cards at the correct `aspect-ratio: 2/3` (poster ratio) during load so the layout is stable and the transition is seamless. Reuse the existing `.skeleton` class.
- **Risk**: low-medium (visual; per-view skeleton shapes for grid/large/list).
- **Status**: **Deferred — not selected this run.** (Ready to apply on request.)

---

## 3. Styling & design-system

### S-1. Card shadows hardcoded; don't soften on light theme  ✅ Phase A
- **Where**: `components/common/Card.module.scss:30` (`.variant_elevated`), `:63` (`.interactive:hover`); global `.lift:193`.
- **Problem**: `box-shadow: 0 4px 14px -10px rgba(0,0,0,0.35)` and `0 10px 24px -12px rgba(0,0,0,0.4)` are baked in. On the light theme (white surfaces) these dark drop-shadows are too heavy — the light block redefines `--shadow-*` but the Card never reads them.
- **Fix**: Add `--shadow-card` / `--shadow-card-hover` tokens to both theme blocks (dark = current values; light = softer, lower-alpha). Consume in Card. Point global `.lift` hover at the existing `--hover-lift-shadow` token (identical value, removes a literal).
- **Risk**: nil on dark (byte-identical); genuine improvement on light.
- **Status**: **Applied in Phase A.**

### S-2. No elevation/surface scale  🔶 Phase B / C
- **Where**: every component reinvents bg + border + radius + shadow.
- **Problem**: There is no `--elevation-1/2/3` mapping, so "a card", "a popover", and "a modal" each hand-roll their surface. The `@mixin card` exists and is used 0×.
- **Fix**: Define a small elevation set and migrate the obvious surfaces. Pairs naturally with the Tooltip/Popover unification (M-6).
- **Risk**: medium (touches many files). Best as a focused sweep.
- **Status**: **Phase C (carried forward, expands 05-27 S-3).**

### S-3. Hardcoded magic values long tail  🔶 Phase C
- **Where**: ~250 hits — opacity literals, letter-spacing, blur radii, intermediate font sizes (10/11px) and spacings that fall between tokens.
- **Problem**: No `--opacity-*`, `--tracking-*`, `--blur-*` scales; gaps in the font-size ramp incentivise hardcoding.
- **Fix**: Add the missing scales, then sweep per-site (bulk replace is unsafe — brand colours like IMDb yellow must stay literal).
- **Risk**: low value per site, high cumulative; medium risk in aggregate.
- **Status**: **Phase C (carried forward from 05-27 S-3).**

### S-4. Defined-but-unused mixins/utilities  ℹ️ Note
- **Where**: `_mixins.scss` (`focus-ring`, `hover-lift`, `card`, `glass-surface` — all 0 uses), `_animations.scss` `.animate-*` (0 uses), `global.scss` `.press`/`.lift` (0 uses).
- **Problem**: Either adopt them (M-1/M-3 begin this) or they bit-rot. Not dead code to delete (they're the intended API), but they need consumers.
- **Status**: **Being adopted incrementally** (M-1 wires motion; M-3 wires `.press`). Remainder tracked.

---

## 4. Suggested features (roadmap)

Each leverages infrastructure that already exists, so the lift is "surface +
wire", not "build from zero". Ordered by premium-impact ÷ effort.

### F-1. Command palette (⌘K / Ctrl-K)  ★ highest leverage
- **What**: A global fuzzy launcher to jump to any movie, person, page, or action ("Play X", "Add to watchlist", "Open settings", "Scan library").
- **Leverages**: the **federated search** module (movies+people, SSE streaming) is already built — the palette is mostly a new overlay + keybind over existing search + the route table.
- **Why premium**: it's the single most "pro app" affordance; turns a mouse-driven app into a keyboard-driven one.
- **Effort**: medium. **Risk**: low (additive overlay).

### F-2. "Skip Intro" / "Skip Credits" + autoplay Up Next
- **What**: A floating "Skip Intro" button during the opening, and an "Up Next" card that auto-advances within a group/playlist.
- **Leverages**: the **grouping** module (SxxExx / series detection) and **playlists**; the player already tracks position + has a chapter-capable seek bar.
- **Why premium**: the #1 expected feature of any modern streamer; binge-watching becomes frictionless.
- **Effort**: medium-high (needs intro/credit timestamps — manual markers first, content-detection later). **Risk**: medium.

### F-3. Keyboard-shortcut help overlay (`?`) + global shortcuts
- **What**: `?` opens a styled cheat-sheet; add `P` (play focused), `Esc` (close detail/modal), `←/→` (prev/next), `/` (focus search), `W` (watchlist toggle).
- **Leverages**: player already binds space/arrows/F; this formalises + documents them and extends to navigation.
- **Why premium**: rewards power users; pairs with F-1.
- **Effort**: low-medium. **Risk**: low.

### F-4. Trailer-on-hero + ambient "Now Playing" detail
- **What**: Auto-play the muted trailer behind the MovieDetail hero after a short dwell (with a mute/expand control); a cleaner cinematic detail header.
- **Leverages**: `TrailerSection` + TMDB trailer URLs are already stored; just surfaced minimally today.
- **Why premium**: instantly cinematic; matches Apple TV / Disney+ detail pages.
- **Effort**: medium. **Risk**: low-medium (bandwidth/autoplay-policy handling).

### F-5. "Your Movie Year" stats / insights
- **What**: A delightful insights view — hours watched, top genres/actors, most-rewatched, a Spotify-Wrapped-style recap.
- **Leverages**: **watch history** already records position + completion per user.
- **Why premium**: high-delight, shareable, zero new data plumbing.
- **Effort**: medium. **Risk**: low.

> Also worth noting as smaller wins: a manual **mark watched/unwatched** toggle
> (history infra exists; small gap), **user-created Collections / smart tags**
> (smart-playlist rule engine already exists), **PWA/installable** (no manifest
> today), and **mobile bottom-nav surfacing Discover** (currently buried).

---

## 5. Recommended execution plan

### Phase A — applied automatically (this run)
1. ✅ **M-1** — `.stagger-rise` utility added to `global.scss`; Dashboard sections cascade in. Reduce-motion safe.
2. ✅ **S-1** — `--shadow-card` / `--shadow-card-hover` tokens (dark + light); Card consumes them; global `.lift` points at `--hover-lift-shadow`.
3. ✅ (rolled into M-1/S-1) — removed the blunt whole-page `fadeIn` in favour of sequenced entrance.

### Phase B — applied this run (user-approved)
- ✅ **M-2** Grid/row card stagger via `.stagger-rise` on `MovieGrid`'s three containers. Stable `key={movie.id}` means surviving cards don't re-animate on sort/filter; only newly-mounted cards (page change, new results) reveal. Fill-mode switched to `backwards` so the entrance doesn't override card hover-lift.
- ✅ **M-3** Tactile press: `&:active { scale(.97) }` on shared `Button`; subtle `translateY(-4px) scale(.985)` on `MovieCard`. (IconButton already had `:active` scale — left as-is.)
- ✅ **M-4** Dashboard now surfaces a single consolidated `notifyError` listing any section(s) whose data failed (was silent `console.error`).
- ✅ **M-5** New promise-based `useConfirm()` hook (`hooks/useConfirm.tsx`) backs the styled `ConfirmDialog`; replaced all 3 native `confirm()` calls (`Users.tsx` ×2 demote/delete, `GroupDetail.tsx` ungroup).
- ✅ **M-6** New `Tooltip` primitive (`components/common/Tooltip.tsx` + module) — portalled, theme-aware, hover+focus, reduce-motion safe. First consumers: the Dashboard view-toggle buttons (replaced `title=`). Broader `title=` → `Tooltip` migration left as a follow-up sweep.
- ⏸ **M-7** Skeleton grid placeholders — deferred by choice; ready on request.

### Phase C — plan only
- **Features F-1…F-5** — each deserves its own `/implement` plan; F-1 (command palette) and F-3 (shortcuts overlay) are the cheapest high-impact starters.
- **S-2 / S-3** — elevation scale + magic-value sweep (expands 05-27 S-3).
- **Carried forward from 05-27** (still valid, untouched): Settings.tsx / PlayerControls.tsx / MovieDetail.tsx / GlobalPlayer.tsx decompositions (C-1…C-4 in that doc).

---

## 6. Documentation updates

Phase A is internal UI polish (motion utility + shadow tokens) — no public
API, CLI, keybind, or default-value change → **no docs update required.**
If Phase B M-3 (global keybinds, were it extended) or any Phase C feature
lands, the keybind/feature docs and `CLAUDE.md` client-architecture notes
should be updated in that change.

## 7. Verification

- `pnpm --filter @mu/client build` — green after Phase A (see run output).
- No new dependencies introduced. Phase A final states are visually
  identical on the dark theme; the only intentional visual deltas are the
  Dashboard entrance choreography (M-1) and softer card shadows on the
  light theme (S-1).

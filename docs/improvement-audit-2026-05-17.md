# Improvement Audit — 2026-05-17

## 1. Summary

- **Project:** Mu (CineHost) — self-hosted movie streaming
- **Working directory:** `/home/rw3iss/Sites/mu`
- **Scope:** UI normalization + common styling + Discover-page organization for actors/movies + mobile UX + global player mini-bar overhaul + subtle motion polish.
- **Phases:** A (auto), B (auto with my best calls per user's instruction), C (planned for follow-up).
- **Total findings applied:** 4 of 6 (2 planned for Phase C).

## 2. UI & UX improvements

### 2.1 Mobile mini-player toolbar is enormous *(user's primary pain point)*

**Where.** `src/packages/client/src/components/player/PlayerControls.module.scss` + `GlobalPlayer.module.scss`.

**Problem.** Shared `<PlayerControls>` uses `height: 100%; aspect-ratio: 1` on every `.controlBtn`. In mini mode the bar is `--player-bar-height: 105px`, so each button became ~100px square — half a phone viewport. The mini video thumbnail was also 100×178 on mobile, and the bar rendered 8+ buttons inline (skip back, skip fwd, play, info, volume, settings, effects, fullscreen, maximize, close).

**Fix (Phase A, applied).**
- New mobile @media block under `.miniMode` in `PlayerControls.module.scss`:
  - `.controlBtn` → 44×44 (W3C touch-target spec), 20px icons.
  - `.titleText` → 13px, single line; `.timingLabel` hidden (room for fingers, not numbers).
  - Skip popouts, volume slider, effects panel, settings menu hidden on mobile — they're hover-driven and unreachable on touch. Effects/settings remain accessible after Maximize.
  - Seek bar slimmed: 2.5px track, 16px hit area.
- `.playerBarMini` mobile height → 56px (was 105px).
- `.videoWrapperMini` and `.miniSpacer` → 96×56 on mobile (was 178×100).

**Risk.** Low. CSS-only, scoped behind existing `.miniMode` class. Desktop unaffected.

**Docs.** No public-API change. No README update needed.

### 2.2 No tactile feedback on most interactive elements

**Where.** Project-wide.

**Problem.** Cards/buttons lack the subtle "press" feel users expect on modern surfaces. Discover/Library/Favorites cards animate on hover but not on tap.

**Fix (Phase A, applied).** Added two opt-in utility classes in `styles/global.scss`:
- `.press` — 100ms scale(0.97) on `:active`, snaps back via `--ease-snap`.
- `.lift` — 180ms translateY(-2px) + soft shadow on `:hover` for cards that don't already do this.

Plus shared easing tokens in `styles/_variables.scss`:
- `--ease-out`, `--ease-in-out`, `--ease-spring`, `--ease-snap`.
- Composite presets `--transition-pop`, `--transition-snap`, `--transition-panel`.

`reduce-motion` global override (already shipped) neutralises all of these for accessibility.

**Risk.** Low. Opt-in classes; no existing class names changed.

**Docs.** No README change. Internal-only utility.

## 3. Styling & design system

### 3.1 Magic easing curves scattered across SCSS files

**Where.** Player, common components, modal animations.

**Problem.** Each animation reinvents `cubic-bezier(0.34, 1.56, 0.64, 1)` or `ease-out`. No central source of truth.

**Fix (Phase A, applied).** See 2.2. New `--ease-*` tokens in `_variables.scss`. Existing inline curves remain (deliberate — touching every animation would be a large blast radius); but **new** animations should use the tokens. The `QuickStartPanel` introduced in this pass uses them as the example.

**Risk.** None. Additive.

### 3.2 *(Phase C — planned)* Card pattern duplicated across MovieCard, DiscoverResultCard, FavoriteCard, PersonDetail credit cards

Each implements its own hover-lift, poster-wrap, fallback-image fallback. A shared `<Card>` (or headless `useCard()` hook + token-driven styles) would consolidate. Skipped here — touching every card simultaneously is high blast radius and the per-card divergences (rating badge, score chip, owned/not-owned flag) are real product distinctions. Worth a dedicated refactor session.

### 3.3 *(Phase C — planned)* IconButton extraction

`PlayerControls.tsx` has ~15 inline `<button class={styles.controlBtn}><svg>...</svg></button>` patterns; the same shape recurs in admin panels and the InfoPanel. Extracting a shared `<IconButton size variant title>` would simplify, but the player file is ~1160 lines and any refactor needs careful verification that fullscreen / settings menus / skip-extended overlays still behave correctly. Best done with a focused session.

## 4. Architecture & code quality

### 4.1 Discover page didn't surface user favorites as a quick-start path

**Where.** `src/packages/client/src/pages/Discover.tsx` sidebar.

**Problem.** The user had no way to say "give me recs based on my favorited movies and people" without manually opening each movie and re-seeding from `MovieDetail`. Friction against the whole point of Favorites.

**Fix (Phase B, applied — my call per user's "implement all" instruction).** New `<QuickStartPanel>` component in `components/discover/`:
- Lists favorite movies as chips → one-click `addSeed(movieId, title)`.
- Lists favorite people as chips → links to `/person/:key` (people aren't direct recommender seeds — the credit-bridge model lets the user pick a specific film of theirs to seed from).
- "Seed all" button consumes up to 5 favorite movies → multi-seed centroid recommendation.
- Lives above the filters in the sticky sidebar; auto-hides when the user has zero favorites.

**Risk.** Low. New component, additive integration, no existing API touched.

**Docs.** No README change required (Discover page already covered in features list).

## 5. Recommended execution plan

- **Phase A (applied automatically — low risk):**
  - 2.1 Mobile mini-player bar overhaul.
  - 2.2 Motion tokens + `.press` / `.lift` utility classes.
  - 3.1 New easing tokens in `_variables.scss`.

- **Phase B (applied by my call):**
  - 4.1 Discover favorites quick-start panel.

- **Phase C (deferred — planned, not auto-applied):**
  - 3.2 Card pattern consolidation (cross-cutting, needs design + product call on how much divergence is product-meaningful vs. visual drift).
  - 3.3 IconButton extraction (touches player internals; needs a focused verification pass).
  - Discover "seed by person" backend support — currently the recommender only seeds from movieIds. A future enhancement could accept person tmdb_ids and synthesise a seed set from their known-for. Requires backend change to `RecommendationsService`.
  - Overflow-menu pattern on mobile mini bar — user mentioned "expand to lists upward with more button options" as an alternative. Current pass shrank + hid; a future pass could add an overflow `⋯` button → upward popover with the hidden options. Requires PlayerControls JSX changes.

## 6. Documentation sync

- README — no user-visible API/CLI/keybind/install changes from this pass.
- CLAUDE.md — no architecture changes (Favorites and People modules already added in previous commit chain).
- This audit doc: `docs/improvement-audit-2026-05-17.md`.

## 7. Verification

- `pnpm exec vite build` — passes (multi-chunk rolldown build, 1.0 MB main, builds in ~2.7s).
- `pnpm exec biome check` — clean on all touched files.
- Reduce-motion respected globally (existing `html[data-reduce-motion='true']` rule from prior commit neutralises new transitions).

# Improvement Audit — 2026-05-17 (Phase C completion)

## 1. Summary

- **Project:** Mu (CineHost)
- **Scope:** Close the long-deferred Phase C item — generic Card-style primitive + migrating MovieCard, DiscoverResultCard, and Favorites cards to compose it.
- **Approach:** Composition over inheritance. New `<MediaCard>` primitive in `components/common/`; domain cards plug in their own badges / overlays via named slot props. No domain logic in the primitive; no shared inheritance hierarchy.

## 2. Architecture

### 2.1 SOLID principles applied

- **Single Responsibility.** `MediaCard` does one thing: poster + info + slot orchestration + hover/click/focus behaviour. It knows nothing about movies, people, or scores.
- **Open/Closed.** Every domain-specific affordance (rating badges, score, "Not in library", processing dim, watch progress, options menu, bookmark, etc.) goes through a *named slot prop* — adding a new affordance never requires modifying MediaCard.
- **Liskov / Interface Segregation.** No inheritance, no broad base class — consumers compose. The prop interface is granular: 12 optional slot/state props plus the bare poster + title. Cards that don't need a slot don't pay for it (no rendering, no className collision).
- **Dependency Inversion.** `SmartImage` is the only external dependency. State props (`processing`, `selected`, `hidden`, `dim`, `disabled`) are intent-tagged, not implementation-tagged — caller decides what they mean.

### 2.2 The slot taxonomy

```
┌─ posterWrap (border, aspect-ratio) ─────────────┐
│  topLeft slot ───────────────── topRight slot   │
│                                                 │
│              <SmartImage>                       │
│                                                 │
│  posterBadges slot (absolute, anywhere)         │
│  hoverOverlay slot (revealed on :hover)         │
├─────────────────────────────────────────────────┤
│  belowPoster slot   (e.g. WatchProgressBar)     │
├─────────────────────────────────────────────────┤
│  preInfo slot       (e.g. selection checkbox)   │
│  ─ info block ─                                 │
│     title       (string → wrapped in h3,        │
│                  VNode → rendered as-is)        │
│     subtitle    (meta row)                      │
│     extra       (e.g. plugin slot, options ⋮)   │
│  ─ caption ─    (full-width, e.g. discover      │
│                  explanation)                   │
└─────────────────────────────────────────────────┘
```

Five state props for cross-cutting visual flags: `dim`, `processing`, `selected`, `hidden`, `disabled`.

Four poster shapes: `poster` (2:3, default), `portrait` (1:1.4), `square` (1:1), `backdrop` (16:9).

## 3. Migrations applied

### 3.1 `MovieCard` → `<MediaCard>`

- Selection checkbox → `preInfo` slot.
- Remote-server badge + transcode-mode badge + `<RatingBadge>` → `topRight` slot.
- "Hidden" label → `topLeft` slot.
- Processing percentage overlay → `posterBadges` slot.
- Play + Resume buttons → `hoverOverlay` slot.
- `<WatchProgressBar>` → `belowPoster` slot.
- `<h3>` title (with hover-tooltip on long titles) → `title` slot (VNode path preserved verbatim — MediaCard skips its own h3 wrapper when title is a VNode).
- Year · runtime · rating · plugin · options-menu → `subtitle` slot.
- State flags: `processing`, `selected`, `hidden` mapped to MediaCard's same-named props.
- Per-card SCSS retained for badge styling (`RatingBadge`, `processingOverlay`, `hiddenLabel`, etc.) — only the shell logic moved.

### 3.2 `DiscoverResultCard` → `<MediaCard>`

- Score percentage + "Not in library" pill + "Enriching…" badge → `topLeft` slot.
- IMDB / TMDB rating badge → `topRight` slot.
- "See similar" + bookmark button → `hoverOverlay` slot.
- Year · rating pill · vote count · sources → `subtitle` slot.
- Explanation reason → `caption` slot.
- `dim` flag carries the "not owned" visual cue.
- Existing SCSS class names (`scoreBadge`, `ratingBadge`, `bookmarkBtn`, etc.) untouched.

### 3.3 Favorites `FavoriteCard` → `<MediaCard>`

- Person → `posterShape="portrait"`; movie → default `poster`.
- `<FavoriteButton>` (star icon) → `topRight` slot.
- Name → `title`.
- Role / department / year → `subtitle`.
- `FavoriteRow` left as a hand-built row — list rows are a different primitive (deferred; would benefit from a separate `<MediaRow>` shell down the line).

## 4. What this enables next

- **New card types take one file.** Recommendations / Library Phase-2 / actor filmography grids can spin up a card by composing MediaCard, no new SCSS shell needed.
- **Visual state tokens are uniform.** "Selected" / "processing" / "dim" / "hidden" frames look the same everywhere — touch one CSS rule to retheme.
- **Hover + focus + a11y centralised.** `role="button"`, `tabIndex`, `aria-disabled`, focus-visible outline — implemented once.

## 5. What stays deferred

- **`FavoriteRow` and any future list-row card.** Would benefit from a `MediaRow` sibling primitive. Out of scope here.
- **Pre-existing per-card SCSS** (e.g. MovieCard's 291 lines) still carries hover transforms that overlap with MediaCard's. They coexist via CSS source-order (consumer rule wins); a future cleanup can prune the duplicates once we're confident no visual regressions slipped through.

## 6. Verification

- `pnpm exec vite build` — passes (1.03 MB main bundle, ~3s).
- `pnpm exec biome check` — clean on all touched files.
- No new tests required: the migration is composition-only; existing behaviour preserved by passing every prop through the same slots that previously held inline JSX.

## 7. Documentation sync

- No public API / CLI / keybind changes.
- This audit at `docs/improvement-audit-2026-05-17-pt3.md`.

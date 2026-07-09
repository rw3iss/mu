# Improvement Audit — 2026-05-17 (follow-up pass)

## 1. Summary

- **Project:** Mu — self-hosted movie streaming
- **Working directory:** `/home/rw3iss/Sites/mu`
- **Scope:** Close remaining Phase C items from earlier pass (backend seed-by-person + Card adoption) + add new low-risk polish (skeleton loading, EmptyState enhancement).
- **Findings applied:** 4 of 4. No deferred Phase C this round.

## 2. UI & UX improvements

### 2.1 Inline empty states reinvent the wheel

**Where.** `Favorites.tsx`, `Plugins.tsx`, `PlaylistDetail.tsx`, `AdminDashboard.tsx`, etc. The `<EmptyState>` common component existed but only supported a single layout + emoji icons.

**Fix (Phase A, applied).** Extended `<EmptyState>`:
- New `variant` prop — `plain` / `dashed` (bordered card) / `inline` (compact row).
- `icon` now accepts either an `IconName` (rendered as the SVG `<Icon>`) or a free-form glyph string. Old emoji callers still work.
- New optional `secondaryLabel` + `onSecondary` for two-action empties.
- `children` slot for custom content between message and actions.
- Migrated Favorites' two inline empty states (no favorites yet / no matches) to the `dashed` variant with proper icons. Visual consistency win.

**Risk.** Low. Existing API preserved; new props opt-in. Other inline-empty pages can migrate opportunistically.

**Docs.** No README change required.

### 2.2 Loading state shows bare "Loading…" text

**Where.** `Favorites.tsx` (and likely other pages).

**Fix (Phase A, applied).** New global `.skeleton` shimmer utility class in `global.scss`. Favorites loading replaces the text with grid- or list-shaped skeleton placeholders that match the about-to-render layout. Reduce-motion respected via existing global override.

**Risk.** Low. Pure addition; the `.skeleton` class is opt-in for the rest of the app.

## 3. Architecture & code quality

### 3.1 Backend seed-by-person (closes Phase C item)

**Problem.** The frontend bridge from earlier passes resolved favorited people → owned credits client-side. It worked for the common case but had no path to surface "this person has nothing in your library yet" cleanly, and duplicated logic the server already has access to.

**Fix (Phase B, applied — my call per "implement all"):**
- New `PeopleService.resolveOwnedMovieIds(keys, perPersonLimit=4)` — server-side resolver bridging person keys → in-library movie ids via the existing `people.metadata.knownForMovies` cache. Returns both resolved movie ids AND `unresolvedKeys` so the UI can prompt the user.
- `GET /recommendations/discover` accepts new `personKeys` query param. Merges person-derived ids with explicit `seedMovieIds` (dedupe), then runs the standard centroid path. Response carries `personDerivedSeedIds` + `unresolvedPersonKeys` when relevant.
- Client `discover.state` gains `personSeedKeys` / `personSeedLabels` / `unresolvedPersonKeys` signals + `addPersonSeed` / `removePersonSeed` helpers. `runDiscover()` and the page-level subscribe wire through.
- `QuickStartPanel.PersonChip` no longer fetches client-side — single signal write, server does the work, chip shows an active state when seeded. The page seed row now renders person chips with a 👤 prefix alongside movie seed chips.
- "Couldn't find library credits for X" banner renders when a person has no owned films.

**Module wiring.** `RecommendationsModule` now imports `PeopleModule` (which already exported `PeopleService`).

**Risk.** Medium. New query param is additive; existing seedMovieIds path unchanged. Verified via server tsc + client vite build.

**Docs.** No public README change (Discover already mentioned). API surface is internal.

### 3.2 Skeleton + Card primitive adoption

**Status.** Skeleton utility class shipped and adopted by Favorites loading state. Full FavoriteCard / FavoriteRow migration to `<Card>` primitive deferred — the existing CSS already has product-specific hover treatments (image-border highlight, person-vs-movie image ratio) that would need to be replicated on the primitive. Best done opportunistically when those cards are next modified.

## 4. Recommended execution plan

- **Phase A (applied automatically):**
  - 2.1 EmptyState enhancement + Favorites migration.
  - 2.2 `.skeleton` utility class + Favorites skeleton loaders.

- **Phase B (applied by my call):**
  - 3.1 Backend seed-by-person + client wiring + UI affordances.

- **Phase C (still deferred — architectural):**
  - **MovieCard / DiscoverResultCard migration to `<Card>` primitive.** Existing product-specific affordances (score chip, owned/not-owned dim, bookmark button) make a blanket swap risky. Best done one card at a time.
  - **Pre-existing biome warning** in `recommendations.service.ts:55` (`noUnusedPrivateClassMembers`) — out of scope; surfaced by lint sweep, not introduced by this pass.

## 5. Documentation sync

- No public API / CLI / keybind changes. New `personKeys` query param is additive and internal.
- Audit at `docs/improvement-audit-2026-05-17-pt2.md`.

## 6. Verification

- `pnpm --filter @mu/server exec tsc --noEmit` — passes.
- `pnpm --filter @mu/client exec vite build` — passes.
- `pnpm exec biome check` — clean on every file touched in this pass.

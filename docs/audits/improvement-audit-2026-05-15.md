# Improvement Audit — 2026-05-15

## 1. Summary

- Project: Mu (CineHost) — self-hosted movie streaming + management platform
- Working directory: `/home/rw3iss/Sites/mu/src`
- Scope: focused pass on the *newly-landed* metadata-matcher / candidate
  feature (commit `95a3db7`) plus adjacent cross-cutting opportunities
  it surfaced. Not a full-repo audit.
- Total findings: **6** (UI/styling: 2, architecture: 3, DX: 1)
- Applied this pass: **3 Phase A** ✅, **3 Phase B** ✅, **1 Phase C** ✅
- Pending approval: 0
- Build status after Phase C: ✅ `pnpm build` 3/3 successful, `pnpm test` 62/62 passing

## 2. UI & styling

### 2.1 `MatchCandidatesPanel.module.scss` ignores the design token system — Phase A ✅ applied
- **Where:** `client/src/components/movie/MatchCandidatesPanel.module.scss` (entire file)
- **Problem:** Brand-new component but uses *nonexistent* CSS variables
  (`--text-muted`, `--accent-color`, `--card-border-color`,
  `--card-border-radius`) with hex fallbacks. Real tokens are
  `--color-text-muted`, `--color-accent`, `--card-border`,
  `--item-radius`. Ad-hoc `rgba(255,255,255,…)` instead of the
  `--surface-overlay-1/2/3` scale established in `_variables.scss:43-48`.
  Hardcoded font sizes (`0.95rem`, `0.8rem`) and `120ms ease`
  transitions where token equivalents exist.
- **Why it matters:** Panel renders correctly in dark mode by accident
  (the fallback hexes happen to look right), but in light mode the
  background overlays don't invert (they keep `rgba(255,255,255,…)`
  white-on-light), text contrast collapses, and the "Best" badge
  fallback hex `#06b6d4` doesn't track theme accent changes.
- **Fix:** Mapped all values onto the existing token set. No structural
  changes; visual output in dark mode is byte-identical (modulo the
  surface-overlay tweak which goes from 0.02 → 0.06 to match
  `--surface-overlay-1`).
- **Risk:** Low. Visual only.

### 2.2 `MatchCandidatesPanel` API is rigid — Phase B ✅ applied
- **Where:** `client/src/components/movie/MatchCandidatesPanel.tsx`
- **Problem:** Component accepts `candidates`, `onApply`, `onDismiss`,
  `heading`. No way to pass through a `class`, customise the apply
  button label, or render an empty/loading state without an outer
  conditional in each consumer. The current call sites
  (`MovieDetail.tsx`, `GroupDetail.tsx`) both gate the render with
  `candidates.length > 0`, which is duplication.
- **Why it matters:** Cards/panels in `components/common/` follow a
  convention of accepting `class`, `style`, optional render slots.
  Bringing this component in line opens it up to reuse from settings
  pages, admin pages, or a future "needs review" dashboard.
- **Fix (proposed):** Add `class`, `style`, `applyLabel`,
  `dismissLabel`, `confidenceFormatter` props. Move the
  `candidates.length === 0 → return null` check internal so consumers
  can render the panel unconditionally.
- **Risk:** Low–medium. Affects two call sites in the same commit.

## 3. Architecture & code quality

### 3.1 Matcher → candidate mapping duplicated across services — Phase A ✅ applied
- **Where:**
  - `server/src/metadata/metadata.service.ts:192-204` (movie path)
  - `server/src/metadata/group-metadata.service.ts:174-186` (group path)
- **Problem:** Both services take `MatchResult.ranked`, slice to
  `MAX_PERSISTED_CANDIDATES`, and map identically to `NewCandidate[]`.
  The structure differs only by the candidate's `overview` field, which
  both already expose as a `MatchCandidate` extension.
- **Why it matters:** Two-place edits whenever the persisted shape
  changes; the `MAX_PERSISTED_CANDIDATES = 8` constant is also
  duplicated across both files.
- **Fix:** Added a `replaceFromRanked()` helper to
  `MatchCandidatesRepository` that takes a scored ranking + an
  `overviewExtractor` and writes the top-N rows in one call. Both
  services now call this helper; the constant lives in one place.
- **Risk:** Low. Pure refactor — same data ends up in the same rows.

### 3.2 OMDB `OmdbData` / `OmdbSearchResult` parsing was duplicated — already fixed in commit `95a3db7`
- **Status:** Listed here for the record. Cross-lookup-from-TMDB
  silently lost runtime/year because the by-imdbId path didn't parse
  them. Fixed by extracting `parseOmdbResult()` and giving both shapes
  the same fields.

### 3.3 `fetchForMovie` / `fetchForGroup` share the same control flow — Phase B ✅ applied
- **Where:** `metadata.service.ts:140-235`, `group-metadata.service.ts:81-205`
- **Problem:** Both implement the same three-way decision tree
  (no-match / ambiguous / confident → apply). The differences are the
  *candidate sources* and the *post-match apply* step. Today the
  decision tree is copy-pasted.
- **Why it matters:** Future strategy work (e.g. adding TVDB or Letterboxd
  candidates) means editing both files. The matcher is the project's
  one true ranking engine; the decision-tree-and-persistence shell
  around it should follow the open/closed principle.
- **Fix (proposed):** Extract a generic `resolveMatch<TCand, TResult>()`
  in `matching/resolve.ts` parameterised by `(entityType,
  entityId, candidates, onApply)`. The two services become thin
  adapters that build candidate lists and supply an `onApply`
  callback. ~80 lines saved, more importantly: one place to log /
  persist / emit events / clear stale candidates.
- **Risk:** Medium — touches the two highest-value services in the
  metadata module. Needs careful manual testing of both movie and
  group flows.

### 3.4 Flip the grouping ↔ metadata module dependency — Phase C ✅ applied
- **Was:** `MetadataModule` imported `GroupingModule` so
  `GroupMetadataService` could inject `GroupsRepository` and write to
  `movie_groups`. The reverse edge (auto-trigger on new parent) ran via
  the job queue — half-decoupled, half-not.
- **Now:** `MetadataModule` no longer imports `GroupingModule`. The
  direction is `grouping → metadata`, the natural one for a domain
  module that *consumes* enrichment.
- **What changed:**
  - `GroupMetadataService` is now a pure resolver. It returns a
    `ResolvedGroupMetadata` patch instead of writing to
    `movie_groups`. No `GroupsRepository` injection. Two methods:
    `resolveForGroup(group)` and `resolveByCandidate(provider, id)`.
  - `GroupingService` owns the writeback: a new `applyMetadataPatch`
    private writes the patch onto its own row via `GroupsRepository`.
    Two new public methods, `refreshGroupMetadata(groupId)` and
    `applyGroupMatchCandidate(...)`, drive the resolver + writeback.
  - The `group-metadata` job handler moved from
    `GroupMetadataService.onModuleInit` to
    `GroupingService.onModuleInit`. The auto-trigger from
    `persistDetection` (enqueue on new parent) is unchanged.
  - The four `groups/:id/match-candidates*` and
    `groups/:id/refresh-metadata` endpoints moved from
    `MetadataController` to `GroupingController` so the controller
    that *writes to groups* lives in the module that *owns groups*.
- **Files affected (6):**
  `metadata/group-metadata.service.ts`,
  `metadata/metadata.module.ts`,
  `metadata/metadata.controller.ts`,
  `grouping/grouping.module.ts`,
  `grouping/grouping.service.ts`,
  `grouping/grouping.controller.ts`.
- **Behavioural delta:** Zero. Same endpoints at the same URLs; same
  auto-trigger on new parent; same WS event semantics. Client
  service methods (`groupsService.refreshMetadata`,
  `applyMatchCandidate`, etc.) work without changes.
- **Verification:** `pnpm exec tsc --noEmit` clean, `pnpm build` 3/3,
  62/62 tests pass.
- **Residual coupling:** `metadata/matching/title-normalizer.ts`
  still imports `grouping/title-sanitiser.ts` for the
  `sanitiseRawTitle()` utility. It's a pure function (no
  `@Injectable`) so it does not affect the NestJS DI graph, but it
  would be cleaner to relocate to `@mu/shared` since both modules
  consume it. Not blocking — recorded for a future cleanup.
- **Risk applied:** Medium (refactored two services + module wiring),
  mitigated by no API/URL changes and full test coverage of the
  matcher.

## 4. Developer experience

### 4.1 No unit tests for the matcher — Phase B ✅ applied
- **Where:** `matching/matcher.ts`, `matching/title-normalizer.ts`,
  `matching/year-extractor.ts`
- **Problem:** Title-similarity, year scoring, and
  confidence-composite logic are all pure functions begging for
  property tests, but ship without any. The fuzz cases that justified
  the matcher (year-off-by-1, roman numerals, "Bond, James" vs "James
  Bond") aren't pinned down.
- **Why it matters:** When someone tweaks the weights to fix a
  regression, there's nothing stopping a different regression. Tests
  would catch confidence drift across cases.
- **Fix (proposed):** Add `matching/__tests__/` with vitest cases
  covering: identical titles, casing, punctuation, roman numerals,
  word-order swaps, year-off-by-N proximity buckets, missing-year
  weight rebalancing.
- **Blocker:** Server doesn't currently have a vitest setup. Either
  add one (Phase B-with-deps) or scope the tests to `node:test` which
  ships with Node 20+ (no new deps).
- **Risk:** Low (new file only).

## 5. Recommended execution plan

### Phase A — applied automatically ✅
- 2.1 Token-align `MatchCandidatesPanel.module.scss`
- 3.1 Extract candidate-mapping helper into `MatchCandidatesRepository`
- Build verification: `pnpm build` → 3/3 successful

### Phase B — applied after approval ✅
- 2.2 ✅ Opened up `MatchCandidatesPanel` API (`class`, `style`, `applyLabel`, `dismissLabel`, `confidenceFormatter`, internal empty-check). Both `MovieDetail.tsx` and `GroupDetail.tsx` simplified to render the panel unconditionally.
- 3.3 ✅ Extracted `resolveMatch()` into `matching/resolve.ts`. Both
  `MetadataService.fetchForMovie` and `GroupMetadataService.fetchForGroup`
  now go through it. Eliminates the duplicated three-way decision tree;
  ~80 lines collapsed.
- 4.1 ✅ Added `matching/__tests__/matcher.spec.ts` with 10 cases via the project's existing vitest setup (no new deps). All 62 server tests passing.

### Phase C — applied ✅
- 3.4 ✅ Flipped the module dependency: `MetadataModule` no longer
  imports `GroupingModule`. `GroupMetadataService` is now a pure
  resolver returning patches; `GroupingService` owns the writeback to
  `movie_groups`. Group candidate + refresh-metadata endpoints moved
  to `GroupingController` so URL ownership matches module ownership.
  Six files affected, zero behavioural delta, no API change.

## 6. Documentation impact

No public APIs / CLI surface / config keys changed in Phase A. The
`MatchCandidatesPanel` component is internal. The
`MatchCandidatesRepository.replaceFromRanked` method is new internal
API. **No README / docs updates required for Phase A.**

Phase B item 2.2 would add new component props (additive, backwards
compatible) — still no docs update needed since no public docs
surface the component API.

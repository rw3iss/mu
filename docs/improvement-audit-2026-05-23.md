# Improvement Audit — 2026-05-23

Scope: `/discover` page — movie/cast filtering, performance, depth, UI design and flow. Implementation of all phases.

## 1. Summary
- Project: Mu / CineHost (self-hosted movie streaming)
- Working dir: `/home/rw3iss/Sites/mu`
- Total findings: 27 (UI/UX: 11, performance: 6, server filtering: 5, code quality: 5)

## 2. UI & UX improvements

| # | Finding | Location | Risk |
|---|---|---|---|
| U1 | `language` filter declared in types + checked by `hasAnyFilter` but never rendered or applied | `DiscoverFilters.tsx`, `discover-filters.ts:75` | A |
| U2 | Result card shows only `explanation[0]`; rest of array discarded | `DiscoverResultCard.tsx:64,132` | A |
| U3 | Only first 2 `usedSources` shown; rest dropped silently | `DiscoverResultCard.tsx:113` | A |
| U4 | Filter changes fire `runDiscover` immediately — typing in person field fires N requests per N keystrokes | `discover.state.ts:144-157`, `DiscoverFilters.tsx` | B |
| U5 | No `AbortController` on overlapping `runDiscover` calls — N+1 in-flight responses race | `discover.state.ts:141-168` | B |
| U6 | Refresh button has no in-flight guard — rapid clicks queue requests | `Discover.tsx:186-209` | B |
| U7 | No skeleton/dim overlay during filter change — results jump silently | `Discover.tsx`, `Discover.module.scss` | B |
| U8 | No decade quick-shortcut buttons (1980s, 90s, etc.) — user manually types years | `DiscoverFilters.tsx` | B |
| U9 | No runtime-range filter (epic vs short film) — common search pattern absent | `DiscoverFilters.tsx`, server | B |
| U10 | Result cards have no resume bar / watched indicator — `watchPositions` signal already exists client-side | `DiscoverResultCard.tsx` | B |
| U11 | Cards don't surface runtime / genres even when data is available | `DiscoverResultCard.tsx`, `types.ts` | B |

## 3. Architecture / code quality

| # | Finding | Location | Risk |
|---|---|---|---|
| A1 | `IncludeToggle` (50-line inline component) lives inside `Discover.tsx` — duplicates how other modes are toggled | `Discover.tsx:44-75` | A |
| A2 | `imdbVotes` missing from `ScoredMovie` shape — server has it but never sends it | `recommendations/types.ts:48`, client `discover.service.ts:15` | A |
| A3 | `minVotes` filter checks only `tmdbVotes`; inconsistent with `minRating` which now checks all sources | `discover-filters.ts:44-48` | A |
| A4 | Hardcoded `limit: 36` no pagination contract — feels truncated for large libraries | `discover.state.ts:151` | C |
| A5 | Genre chip list capped at 40 visible (`DiscoverFilters.tsx:122`); large libraries lose tail genres | `DiscoverFilters.tsx` | A |
| A6 | `Discover.tsx` 344 lines — IncludeToggle extraction would drop it under 300 | `Discover.tsx` | A |
| A7 | No WebSocket auto-refresh on `enrichmentsQueued → 0` — user must manually refresh after enrichment | `Discover.tsx`, `processing.state.ts` pattern | B |
| A8 | `loadAllCandidates` called twice when `include !== 'owned'` (before + after harvest) | `recommendations.service.ts` | C |

## 4. Filter / server pipeline depth

| # | Finding | Location | Risk |
|---|---|---|---|
| F1 | `language` filter field exists end-to-end but never actually compared in the filter loop | `discover-filters.ts:75` | A |
| F2 | `minVotes` ignores `imdbVotes` (see A3) | `discover-filters.ts:44-48` | A |
| F3 | No runtime range filter at all | `discover-filters.ts`, `types.ts` | B |
| F4 | No "watched / unwatched" filter — relevant data is in `watchPositions` signal client-side already | new code | B |
| F5 | `ScoredMovie` lacks `runtimeMinutes`, `genres`, `imdbVotes` — server has them, client UI can't render them | `types.ts`, `recommendations.service.ts:705-727` | A |

## 5. Recommended execution plan

### Phase A — apply automatically (low risk, no behavior change)
- A1, A6: extract `IncludeToggle` to `components/discover/IncludeToggle.tsx`
- A2: add `imdbVotes` to `ScoredMovie` shape (server + client)
- A3, F2: `minVotes` checks `max(tmdbVotes, imdbVotes)`
- A5: lift the 40-genre visible cap
- F1: implement the language filter (UI + backend comparison)
- F5: add `runtimeMinutes`, `genres`, `imdbVotes` to `ScoredMovie`; populate at the annotate step
- U2: show full explanation array on card (hover/expand reveals extras)
- U3: tooltip shows all sources

### Phase B — apply with confidence (still scoped; uses existing patterns)
- U4, U7: debounce filter changes 250ms + dim grid while loading
- U5: `AbortController` on `runDiscover`
- U6: refresh in-flight guard
- U8: decade shortcut buttons (4–5 chips: '60s, '70s, '80s, '90s, '00s, '10s, '20s)
- U9, F3: runtime range slider (cheap — runtime already on MovieWithMetadata)
- U10: resume bar on cards via existing `watchPositions` + `useWatchPosition`
- U11: runtime + first-genre pills on card subtitle (now that data flows)
- F4: client-side "watched / unwatched" filter (gates results via watchPositions signal — no server change)
- A7: WS subscription — re-runDiscover when `job:completed` for enrichment jobs

### Phase C — plan only, separate session
- **A4 / pagination:** offset+limit endpoint contract, "Load more" UI or infinite scroll. ~6 files.
- **A8 / loadAllCandidates dedup:** refactor harvest flow to skip the redundant load. Server-only, isolated.
- **Seed reordering:** drag-to-reorder pills, server-side primary-seed semantics for centroid weighting. ~4 files + scoring tweak.
- **Shared `<FilterPanel>` component:** consolidate Discover + Library + Watchlist filter chrome into one composable. ~10 files; risky.

---

## Execution log

### Phase A (applied)
_Filled in as items land._

### Phase B (applied)
_Filled in as items land._

### Phase C (deferred)
Items listed above are planned only. Run `/improve` again or open a focused planning session for each.

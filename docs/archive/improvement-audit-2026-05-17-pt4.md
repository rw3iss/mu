# Improvement Audit — 2026-05-17 (pt4)

## 1. Summary

- **Project:** Mu
- **Scope:** Sibling list-row primitive (`<MediaRow>`), real a11y + lint warnings, leftover unused-code cleanup.

## 2. Architecture

### 2.1 `<MediaRow>` — sibling primitive to `<MediaCard>`

Same SOLID stance as MediaCard: composition, named slots, no domain logic.

Layout:

```
┌─────────────────────────────────────────────────────────┐
│ [leading] [thumb] │ title           │ [actions]         │
│                   │ subtitle        │                   │
└─────────────────────────────────────────────────────────┘
```

- Five thumb shapes — `square`, `circle`, `poster`, `backdrop`, `none`.
- Slots: `leading` (checkbox/handle), `actions` (right-side controls), `title`, `subtitle`, `extra`, `children` (escape hatch).
- States: `selected`, `dim`, `disabled`, `compact`.
- A11y: `role="button"` + `tabIndex`/`aria-disabled` only when `onClick` is supplied.

### 2.2 Migration: `FavoriteRow` → `<MediaRow>`

- Person thumb → `thumbShape="circle"`, movie thumb → `thumbShape="poster"`.
- Favorite-toggle button → `actions` slot.
- Name + role/year → default `title` / `subtitle` slots.
- Drops `SmartImage` direct import in Favorites.tsx (now handled inside MediaRow).

## 3. Lint + a11y cleanup

Cleared every biome warning from the prior pass that was a real issue.

### 3.1 Real a11y fixes
- **`MovieBreadcrumbs.tsx`** — `<span aria-label="…">` → `<nav aria-label="…">`. Spans don't carry navigation semantics; biome's `useAriaPropsSupportedByRole` flagged it. Bonus: `style` prop was destructured but never forwarded → now passed through.
- **`VideoEnhancer.tsx`** — `<canvas aria-hidden="true">` → `<canvas aria-hidden tabIndex={-1}>`. Canvases default to non-focusable but biome's `noAriaHiddenOnFocusable` flagged it conservatively; explicit `tabIndex={-1}` resolves.

### 3.2 Unused-code cleanup
- **`VideoPlayer.tsx`** — removed unused `movie = null` destructure.
- **`Sidebar.tsx`** — removed unused `import { Icon }` (the file has a local `Icon` line-helper function shadowing it; biome's `noRedeclare` was correct that this was confusing).
- **`bookmarks.service.ts`** — dropped unused `NotFoundException` import.
- **`embeddings.service.ts`**, **`rate-limit.service.ts`**, **`trakt.http-client.ts`**, **`recommendations.service.ts`** — removed unused `private readonly logger = new Logger(…)` declarations + their now-unused `Logger` imports. Re-add when logging actually lands.
- **`sxxexx-detector.ts`** — `computeConfidence(raw, normalised)` → `_raw` to mark intentional non-use (reserved for future heuristics; documented).

### 3.3 Style
- **`notifications.state.ts`** — `() => void | boolean` → `() => boolean | undefined`. Biome's `noConfusingVoidType` correctly flagged that `void | boolean` is ambiguous; the explicit `boolean | undefined` matches the actual behaviour (`true` keeps toast open; everything else closes).
- **`logs.controller.ts`** — `req.headers['authorization']` → `req.headers.authorization` (biome `useLiteralKeys`). The `x-mu-api-token` bracket access stays since hyphens require it.

## 4. What I deliberately did NOT do this pass

- **Loading-state extraction** across pages. Many pages have inline "Loading…" or Spinner usage. A unified `<LoadingState>` would consolidate, but every page wires fetch+loading slightly differently — risk/reward is poor.
- **try/catch+notifyError pattern extraction**. Same reasoning — pervasive but with subtle per-call-site copy.
- **MovieCard / DiscoverResultCard SCSS dedupe**. Hover transforms still exist in both their own `.card` and MediaCard's `.card`; CSS source-order keeps them visually correct. Worth doing as a focused cleanup once we've confirmed no visual regressions after a few days of use.

## 5. Verification

- `pnpm --filter @mu/server exec tsc --noEmit` — passes.
- `pnpm --filter @mu/client exec vite build` — passes.
- `pnpm exec biome check` — clean across client + server (zero warnings).

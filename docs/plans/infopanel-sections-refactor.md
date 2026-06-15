# Plan — De-duplicate InfoPanel inline/flyout branches

Status: **IMPLEMENTED 2026-06-15** — extracted MovieInfoContent (sections + header body); InfoPanel 710→423 lines. Both shells keep only their poster + outer chrome. Source finding:
`docs/improvement-audit-2026-06-15.md` §4.3.

## Problem

`packages/client/src/components/player/InfoPanel.tsx` renders the movie info in
**two near-identical trees**:

- **inline** (split-mode, below the video) — `inline === true`
- **flyout** (full-player slide-over) — the `<>` branch

Both render the same sections — title row, meta, **Added** row, genres, **Overview**
(collapsible), **Cast** (collapsible, "Load all"), **Comments** (collapsible),
**File Info** (collapsible) — differing only by:

- indentation / wrapper element (`.inlinePanel` vs `.panel`),
- a couple of click handlers (flyout also calls `minimizePlayer()` /
  `showInfoPanel.value = false` on navigation),
- poster size + a few token remaps.

Every section change this sprint (collapsible Overview, Collapse animation, cast
stagger, Added-row tweaks, director overlay) had to be **made twice**. This is the
single biggest maintenance hazard in the recent work.

## Goal

One source of truth for the section list, rendered by both modes.

## Approach (low-behavior-change extraction)

1. **Extract a `MovieInfoSections` subcomponent** (same file or a sibling
   `InfoPanelSections.tsx`) taking:
   ```ts
   interface Props {
     movie: Movie;
     variant: 'inline' | 'flyout';
     onNavigate?: () => void; // flyout passes the minimize+close side-effects
   }
   ```
   It owns the section state (`showOverview/showCast/showComments/showFileInfo`,
   `fullCast`, `loadingCast`) and renders Overview → Cast → Comments → File Info
   using the existing `Collapse`, `CopyButton`, cast stagger, etc.

2. **Variant differences** are expressed as props/branches *inside* the
   subcomponent, not by duplicating the whole tree:
   - poster size (`size={variant === 'flyout' ? 36 : 36}` — already equal; confirm),
   - navigation side-effects via `onNavigate`,
   - any wrapper class differences kept in the two parent shells only.

3. **Both parents** (`InfoPanel` inline shell + flyout shell) keep their own
   outer chrome (backdrop, close button, poster column, title/meta/Added/genres
   header) OR — stretch goal — the header also moves into the subcomponent with a
   `variant`-driven layout. Start with **sections only** (lower risk); the header
   can follow in a second pass.

4. **State that's currently shared across branches** (`showCast` etc. are single
   `useState` in the parent today) moves into the subcomponent. Since only one
   branch renders at a time, behavior is unchanged.

## Risk & mitigation

- **Risk: high** — large hot file, JSX-structure-sensitive (we already hit one
  mis-nesting this sprint).
- Mitigation: extract **sections only** first, keep the two header blocks as-is.
  Diff the rendered output by eye in both modes (flyout + split) before/after.
  No data-flow changes — pure structural extraction.
- Verify: `pnpm exec vite build` + manual check of both panels (expand/collapse
  each section, Load-all, comments, file info) in split and full-player modes.

## Out of scope

- No styling redesign; reuse existing `InfoPanel.module.scss` classes.
- No change to `MovieDetail`'s sections (separate layout).

## Suggested execution

Run `/implement` (or the `superpowers:writing-plans` → `executing-plans` flow)
against this document; it's a single-file, single-session refactor.

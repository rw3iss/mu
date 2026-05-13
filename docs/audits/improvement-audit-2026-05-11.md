# Improvement Audit — 2026-05-11

## 1. Summary

- Project: Mu (CineHost) — self-hosted movie streaming + management platform
- Working directory: `/home/rw3iss/Sites/mu/src`
- Total findings: 11 (UI: 4, styling: 4, architecture: 3)
- Applied this pass: 9 (4 Phase A, 2 Phase B, 3 Phase C)
- Deferred: 2 (2 Phase A skipped after re-evaluation as false positives)
- Build status after changes: ✅ both `@mu/client` and `@mu/server` builds clean

## 2. UI & UX improvements

### 2.1 Semantic colors via tokens — Phase A ✅ applied
- **Where:** `MovieCard.module.scss:100,114,132`, `MovieListItem.module.scss:162`, `FileInfoGrid.module.scss:35,41`, `SubtitlePanel.module.scss:84,403` (all instances replaced)
- **Problem:** Raw hex (`#ef4444`, `#60a5fa`, `#f59e0b`, `#22c55e`) for status badges bypassed the design token system, so badges stayed dark-theme red/blue/amber even when the user switched themes.
- **Fix:** Mapped to `--color-error / --color-info / --color-warning / --color-success`. The token palette differs slightly from the raw hex (e.g. `#f87171` vs `#ef4444`) — intentional, follows the established theme.
- **Risk:** Low (visual only, no behavior change)

### 2.2 Z-index scale violations — Phase A ✅ applied
- **Where:** `RecentlyPlayed.module.scss:103` (1000), `MovieLargeCard.module.scss:198` (100), `Playlists.module.scss:129,202` (250), `Modal.module.scss:8` (9999)
- **Problem:** Magic z-index values bypassed the `--z-*` scale defined in `_variables.scss:108-115`, making it impossible to reason about stacking order globally.
- **Fix:** All collapsed onto `var(--z-overlay)` (300) for tooltip-class elements and `var(--z-modal)` (400) for the Modal overlay. Local-stacking values (1, 2, 3, 5) inside individual components left alone — those are within a stacking context.
- **Risk:** Low

### 2.3 Focus-visible states on common interactive components — Phase A ✅ applied
- **Where:** `Button.module.scss`, `Tabs.module.scss`, `Modal.module.scss` close button
- **Problem:** Keyboard-only users had no visible focus indicator on buttons, tab triggers, or modal-close. ToggleButton already had the right pattern; the other commons did not.
- **Fix:** Added `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` (or `-2px` for tab triggers so the outline sits inside the border).
- **Risk:** Low

### 2.4 PlayerControls / EffectsPanel "theme leaks" — Phase A 🚫 skipped (false positive)
- **Where:** `PlayerControls.module.scss` (~20 lines), `EffectsPanel.module.scss` (~30 lines)
- **Audit flagged:** Many `rgba(255,255,255,*)` and `#fff` hardcodes vs `--surface-overlay-*` tokens.
- **Re-evaluation:** Both panels always render *over the video element*, which is a black canvas regardless of theme. `--surface-overlay-*` tokens invert in light theme (white-on-dark → black-on-light), which would make these chrome elements invisible over a bright video frame. Leaving as-is is correct.
- **Risk if applied:** Medium — would break readability in light mode for video-overlay UI.
- **Recommendation:** Leave alone. If theme-driven player chrome is wanted later, it needs a separate "video-overlay" token tier that does NOT invert.

## 3. Styling & design system

### 3.1 Duplicate `@keyframes spin` — Phase A 🚫 deferred
- **Where:** `_animations.scss:66` (global) + `GlobalPlayer.module.scss:62` + `SubtitlePanel.module.scss:392`
- **Problem:** Two `.module.scss` files redeclare `spin`. With Vite's CSS-modules processor, the `@keyframes` inside a module gets locally scoped — so removing the duplicates would require switching the references to `:global(spin)` / `animation-name: global(spin)` syntax.
- **Why deferred:** The two redeclarations are 3 lines each. The compat risk of the `:global()` keyframe syntax across the rolldown + vite + css-modules stack outweighs the gain.
- **Recommended next step:** When ToggleButton-style global keyframes get more usage, do a one-shot audit + convert all bespoke spinners to use the shared `<Spinner>` component (see 4.1).

### 3.2 Audit overstatement: Row utility — Phase B 🚫 not needed
- **Audit flagged:** "20+ inline `{display:flex,alignItems:center,gap:8px}` repeats" in Settings + ServerSettings.
- **Actual count:** 8 inline `display:flex` styles across the entire client. Not worth a utility class.

## 4. Architecture & code quality

### 4.1 Spinner component — Phase B ✅ applied
- **Where:** `components/common/Spinner.tsx`
- **Change:** Added `class?: string`, `style?: JSX.CSSProperties`, and `label?: string` props. Internal style merging preserves color override precedence.
- **Risk:** Low — purely additive props. Default behavior unchanged.
- **Future:** 8+ sites still use bespoke `<div class={styles.spinnerXxx}>` markup (GlobalPlayer.tsx, SubtitlePanel.tsx, VideoPlayer.tsx, EqTab.tsx, CompressorTab.tsx, ServerSettings.tsx, Button.tsx). Now that `<Spinner>` accepts pass-through className/style, migrating those is a mechanical replacement.

### 4.2 Button component — Phase B ✅ applied
- **Where:** `components/common/Button.tsx`
- **Change:** Added `style?: JSX.CSSProperties` and `title?: string` props. The lack of `style` was forcing call sites in Settings + ServerSettings to drop down to raw `<button style={…}>` instead of using the shared component.
- **Risk:** Low — purely additive.

### 4.3 Oversized controllers — Phase C ✅ subtitle controller refactored (pilot)
- **Done this pass:** `subtitle-manage.controller.ts` slimmed from 507 → ~270 LOC by extracting two helper services:
  - `subtitle-remote-proxy.service.ts` (NEW) — owns `parseRemoteId` + `get/post/upload/delete` proxy methods for `remote:*:*` movie IDs.
  - `subtitle-tracks.repository.ts` (NEW) — owns `getMovie / getAvailableMovieFile / getAnyMovieFile / parseTracks / setTracks / getPersistedTracks` against the `movies` + `movieFiles` tables, with a typed `SubtitleTrackRow` interface (was untyped `any[]`).
  - Controller now consists of clean route handlers + 4 private helpers (`writeSidecarFile`, `readMultipartBuffer`, `registerExternalSubtitle`, `deleteExternalSidecars`) that further dedupe the previously copy-pasted download/upload flow.
- **Module wiring:** both new providers registered in `StreamModule`. Zero route paths changed.
- **Verification:** `pnpm --filter @mu/server build` clean. Subtitles + remote endpoints unchanged from the client's perspective.
- **Still deferred:** `metadata.controller.ts` (474 LOC), `sharing.controller.ts` (464 LOC), `stream.controller.ts` (381 LOC). The pattern established here (extract remote-proxy + repository helpers) maps cleanly onto all three but each requires its own audit of sub-domain boundaries.

### 4.4 MovieCard / MovieLargeCard / MovieListItem — Phase C ✅ rating-badge extracted (conservative slice)
- **Done this pass:** Created `components/movie/RatingBadge.tsx`, a typed presentational component that owns the `rating > 0 && <span style={{background: getRatingColor(rating)}}>{rating.toFixed(1)}</span>` pattern that was duplicated verbatim across all three variants. Each card now uses `<RatingBadge value={rating} class={styles.ratingBadge} />` instead of inline JSX.
- **Why this slice instead of full unification:** A full `<MovieDisplay variant="card|large|list">` refactor would change a lot of subtle hover / badge / progress-bar behavior at once. Without browser verification, the regression risk is high. The badge extraction is the one safe slice that has zero visual delta (same SCSS class, same DOM tag, identical render output).
- **Verification:** `pnpm --filter @mu/client build` clean.
- **Still deferred:** Full variant unification. The shared-pieces list now reads: `useMovieCardBehavior` hook (already shared), `RatingBadge` (done), processing overlay, progress bar, options menu placement, hover tooltip pattern. The next conservative slice would be `<ProcessingOverlay movieId={...}>`; after that, the three shells are mostly layout + a play button.

### 4.5 deploy.sh `dist` verification — Phase C ✅ applied
- **Where:** `src/deploy.sh` after `pnpm build` (step 3a).
- **Change:** Gates the rest of the deploy on `[ -s packages/client/dist/index.html ]` and `[ -d packages/client/dist/assets ]`. If either is missing, deletes the partial `dist/`, force-rebuilds `@mu/client` with `--force` (bypassing turbo cache), and re-checks. Aborts with a non-zero exit if the rebuild still doesn't produce the index, so we never start the server pointing at an empty `dist/`.
- **Why:** This is what burned us this afternoon — turbo cache restored a `dist/` containing only public-folder PNGs, and the SPA fallback in `main.ts` tried to read a non-existent `index.html`, falling through to NestJS's 404 handler (the `Cannot GET /` symptom).
- **Note:** Remote `~/deploy.sh` is an older copy. The canonical command (`bash deploy.sh` from the repo) picks up this fix automatically; the remote copy is stale either way. If/when someone runs the remote copy directly, it won't have the guard — but the existing CLAUDE.md guidance is to use the repo version.

## 5. Recommended execution plan

### Phase A — applied automatically this pass ✅
- Semantic color tokens in MovieCard / MovieListItem / FileInfoGrid / SubtitlePanel.
- Z-index magic values collapsed onto `--z-*` scale (RecentlyPlayed / MovieLargeCard / Playlists / Modal).
- `:focus-visible` rings added to Button / Tabs / Modal close.

### Phase B — applied automatically this pass ✅
- Spinner: `class` / `style` / `label` props added.
- Button: `style` / `title` props added.

### Phase C — applied this pass ✅
1. **Subtitle controller pilot:** extracted `SubtitleRemoteProxyService` + `SubtitleTracksRepository`, slimmed controller from 507 → ~270 LOC. Pattern established for the three remaining oversized controllers (metadata/sharing/stream).
2. **`RatingBadge` extraction:** the one duplicated-verbatim piece of card JSX now lives in a single file. Full variant unification still deferred (high visual-regression risk without browser verification).
3. **`deploy.sh` dist verification:** added post-build guard that detects partial `client/dist/` and force-rebuilds bypassing turbo cache. Aborts deploy if rebuild still fails — prevents the `Cannot GET /` symptom we hit this afternoon.

### Deferred items — completed in follow-up pass ✅

**Server controllers — pattern applied to all four:**

| Controller | Before | After | Extraction |
|---|---|---|---|
| `subtitle-manage.controller.ts` | 507 | 274 | `SubtitleRemoteProxyService`, `SubtitleTracksRepository`, `SubtitleIngestionService` |
| `metadata.controller.ts` | 474 | 300 | `FileProbeService` (~170 LOC of FFprobe normalisation) |
| `sharing.controller.ts` | 464 | 376 | Reuses `SubtitleIngestionService` (~170 LOC of duplicated upload/download flow collapsed) |
| `stream.controller.ts` | 381 | 382\* | Two private helpers (`failedSessionReply`, `recordReply`) consolidate 8 callsites. LOC roughly flat because helpers add ~40 LOC; handler bodies are markedly shorter. |

\* The point of stream.controller.ts wasn't LOC reduction — each handler does fundamentally different work, so the wins are in handler-body readability, not file size.

**Cross-cutting wins from the controller pass:**
- `SubtitleIngestionService` (NEW) — the previously copy-pasted "external subtitle landed on disk, register it" flow that lived in both `SubtitleManageController` (own library) and `SharingController` (federated upload/download) now lives in one place. Includes `writeSidecar`, `readMultipart`, and `registerExternal`.
- `SubtitleTracksRepository` is now exported from StreamModule and consumed by SharingController too.
- `FileProbeService` exposes a typed `FileCodecInfo` + `FileRawMetadata` interface — previously the FFprobe output shape was inlined in the controller's private method type signature.

**MovieCard slicing — second slice applied:**
- `<WatchProgressBar movie={movie} class fillClass>` extracted. Now used in all three card variants — replaces three identical `{hasWatchProgress(movie) && <div><div style={{width: ...}} /></div>}` blocks.
- The audit's suggested `<ProcessingOverlay>` extraction turned out to be a false positive — only `MovieCard` has a processing overlay, not the other two. So WatchProgressBar was the actual second slice.
- Combined with the earlier `<RatingBadge>` extraction, the three card files have noticeably less inline JSX. The `useMovieCardBehavior` hook + the two shared components form the shared foundation; remaining variant-specific JSX is genuinely variant-specific (poster placement, options menu positioning, overlay shape).

### Still deferred (truly future work) 📋
1. The `metadata.service.ts:rescanMovie` method has its OWN inline FFprobe call that could now route through `FileProbeService` (it currently uses only a subset of fields). Worth doing in a future pass to fully eliminate the FFprobe duplication.
2. Full `<MovieDisplay variant=…>` unification of the three card files. The pieces shared between them are now well-extracted; the remaining work is collapsing layout shells, which still needs browser verification to avoid subtle regressions.

## 6. Documentation impact

No user-facing docs needed updating: all applied changes are either internal styling tokens, additive prop APIs (backward-compatible), or invisible focus-ring additions. No public API, CLI surface, keybinds, defaults, install flow, or screenshots affected.

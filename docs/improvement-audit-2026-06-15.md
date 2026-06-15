# Improvement Audit — 2026-06-15

## 1. Summary
- Project: CineHost (Mu) — self-hosted movie streaming platform
- Working directory: `/home/rw3iss/Sites/mu`
- Scope: features landed in the last ~2 weeks (snippet recorder, notifications,
  arbitrary-depth comments, director favorite overlay, discover seed fix, audio
  engine recovery, MusicBrainz soundtrack, animated `Collapse`, soundtrack
  copy/YouTube buttons, flyout tweaks).
- Total findings: 9 (UI: 3, styling: 3, architecture: 3)

## 2. UI & UX improvements

### 2.1 Cast "Load all" stagger not applied in the player Info panel — Risk: low
- Location: `components/player/InfoPanel.tsx` (both inline + flyout cast lists).
- Problem: MovieDetail animates newly-loaded cast members in (staggered fade/rise),
  but the flyout/split-mode cast lists pop in instantly — inconsistent.
- Fix: reuse the `castMemberIn` keyframe; tag members past the initial slice with a
  staggered entry class. **APPLIED (Phase A).**

### 2.2 Copy feedback color hardcoded — Risk: low
- Location: `pages/MovieDetail.module.scss` `.trackCopied` used `#22c55e`.
- Problem: violates the tokens-only rule; won't follow theme.
- Fix: use `var(--color-success)`. **APPLIED (Phase A)** via the shared CopyButton.

### 2.3 Soundtrack copy/open buttons duplicate styling — Risk: low
- Location: `pages/MovieDetail.module.scss` `.trackCopy` / `.trackOpen`.
- Problem: two near-identical rule blocks (reveal-on-hover icon button).
- Fix: shared selector list for the common base. **APPLIED (Phase A).**

## 3. Styling & design system

### 3.1 No shared "icon affordance" reveal pattern reuse — Risk: low
- The track row buttons re-implement reveal-on-hover that the global
  `data-reveal-host` pattern already provides. Left as-is for now (the row-scoped
  reveal is simpler than threading reveal-host here); noted for future unification.

### 3.2 Recording-indicator red is a literal — Risk: low (intentional)
- `PlayerControls.module.scss` uses `#ff4d4d/#d83a3a/#ff6b6b` for the snippet REC
  pulse. This is a deliberate, semantically-distinct "recording" hue (not an error),
  so it stays a literal; documented so it isn't mistaken for a stray magic value.

### 3.3 `Collapse` is now the canonical collapse primitive — Risk: low
- The new `components/common/Collapse.tsx` (grid-rows animation) should be the go-to
  for future collapsibles. Recent sections already use it. Noted for consistency.

## 4. Architecture & code quality

### 4.1 Duplicated clipboard logic across 9+ call sites — Risk: low→medium
- Locations: `ShareMovieModal`, `ColorPicker`, `SubtitlePanel`, `FileInfoGrid`,
  `PlayerControls`, `Settings`, `ServerSettings`, `MovieDetail` (soundtrack).
- Problem: each re-implements `navigator.clipboard.writeText` with an ad-hoc
  `execCommand` fallback and (in several) a transient "copied" flag.
- Fix: add `utils/clipboard.ts` (`copyToClipboard`) + a reusable `CopyButton`
  component (icon + 2s check). **APPLIED (Phase A)**: util + component created and
  adopted by the soundtrack rows; other call sites can migrate incrementally (kept
  working as-is — no behavior change).

### 4.2 `TrackCopyButton` was a one-off local component — Risk: low
- Location: `pages/MovieDetail.tsx`.
- Fix: replaced by the shared `CopyButton`. **APPLIED (Phase A).**

### 4.3 InfoPanel inline vs flyout branches are ~95% duplicated — Risk: HIGH (Phase C)
- Location: `components/player/InfoPanel.tsx` (two near-identical render trees for
  Overview/Cast/Comments/File Info, differing mainly by indentation + a couple of
  handlers).
- Problem: every section change must be made twice (as seen repeatedly this sprint);
  error-prone.
- Proposed refactor: extract a shared `<MovieInfoSections movie variant="inline|flyout">`
  subcomponent so both branches render one source of truth.
- **Deferred to Phase C** — touches a large, hot file; deserves a dedicated plan
  (`/implement` or superpowers:writing-plans).

## 5. Recommended execution plan
- **Phase A (applied now):** shared `copyToClipboard` util + `CopyButton`
  component (token-based success color), soundtrack rows adopt it; InfoPanel cast
  "Load all" stagger parity; consolidate `.trackCopy`/`.trackOpen` base styles.
- **Phase B (incremental, low risk, optional):** migrate the other 8 clipboard
  call sites to `copyToClipboard`/`CopyButton` one-by-one.
- **Phase C (plan separately):** de-duplicate InfoPanel inline/flyout branches into
  a shared sections subcomponent.

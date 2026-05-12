# Movie Grouping & Series — Design Spec (2026-05-12)

> **Status:** Draft for review. Nothing implemented yet.
> **Author/handle:** Claude session, captured from product conversation 2026-05-12.
>
> Mu's current data model treats every video file as a standalone "movie."
> TV shows, multi-part films, anthology series, and other multi-file
> media collapse into a flat list of unrelated entries, which is visually
> noisy and breaks browse / play-next intuition. This document specs a
> grouping system that detects related videos, organises them into a
> two-level **Parent Group → Subgroup → Movie** hierarchy, and surfaces
> them through a dedicated browse experience.

---

## 1. Goals & non-goals

### Goals
- Automatically detect that `Seinfeld - S03E01.mkv`, `Seinfeld - S03E02.mkv`, … belong to a season subgroup of a `Seinfeld` parent group.
- Handle multi-season shows: each season is a subgroup; the show is the parent.
- Handle single-season shows / one-off groupings: still create the parent so a future second season auto-attaches.
- Auto-apply *confident* groupings without bothering the user.
- Surface *uncertain* groupings in a confirmation UI so the user can confirm / reassign / split.
- Provide a per-library toggle to view items as groups (collapsed) or flat (expanded).
- Run grouping during scans, on manual admin trigger, and incrementally for newly-added items.
- Be conservative: never destroy data. Grouping is metadata layered on top of the existing flat list; un-grouping is always cheap.

### Non-goals (phase 1)
- Full TVDB / TMDB *TV* metadata integration (cast per-episode, episode plot, etc.). Phase 1 reads what's already on disk; phase 2 layers TV metadata on top.
- Complex multi-language / dub grouping. Multi-language releases of the same show stay separate for now.
- Cross-library / federation grouping (remote-library items don't merge with local groups).
- Renaming files on disk. Grouping is a virtual layer; files are never touched.

---

## 2. Concepts & terminology

| Term | Meaning |
|---|---|
| **Movie** | An existing `movies` row. The atom. Unchanged by this feature except for a new optional `groupId` FK. |
| **Subgroup** | A collection of movies that belong together — a season of a show, a film trilogy, the parts of a long film. Has a name, an order, an optional parent group. |
| **Parent group** | The "show" or "saga." Contains one or more subgroups. May be auto-created from a single subgroup if the detector can't yet prove other seasons exist. |
| **Group view** | UI mode where each subgroup collapses into a single card in browse views, showing the parent name + season count or episode count. |
| **Confidence** | Score 0.0–1.0 assigned by the grouping pipeline to each automatic decision. ≥0.85 → auto-applied. 0.55–0.84 → applied as *unsure*. <0.55 → not grouped. |

Subgroups and parent groups are **both rows in the same table** (`movie_groups`) — a parent group is just a group whose `parentGroupId` is null and whose role is "container for other groups." This keeps the schema and queries simple.

---

## 3. Data model

### New table — `movie_groups`

```ts
// packages/server/src/database/schema/movie-groups.ts
export const movieGroups = sqliteTable('movie_groups', {
  id: text('id').primaryKey(),                        // uuid
  type: text('type', { enum: ['parent', 'subgroup'] }).notNull(),
  name: text('name').notNull(),                       // "Seinfeld" or "Seinfeld - Season 3"
  // Subgroup → parent. null for top-level parents. Self-FK.
  parentGroupId: text('parent_group_id'),
  // Ordering within parent (season number for TV; part number for multi-part).
  // Null for parent groups themselves.
  ordinal: integer('ordinal'),
  // Optional external metadata IDs (phase 2 will populate these properly).
  tmdbTvId: integer('tmdb_tv_id'),
  imdbId: text('imdb_id'),
  // Cosmetic
  posterUrl: text('poster_url'),
  backdropUrl: text('backdrop_url'),
  overview: text('overview'),
  // Pipeline state
  status: text('status', { enum: ['auto', 'unsure', 'confirmed', 'rejected'] })
    .notNull()
    .default('auto'),
  // 0.0–1.0 — only meaningful for `auto` and `unsure` rows
  confidence: real('confidence'),
  // For "unsure" parent attachment: alternative candidates the user could
  // re-assign to. JSON array of { parentGroupId, confidence }.
  altParents: text('alt_parents'),
  // Audit
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // Provenance — which detector created it (for debugging)
  detectionSource: text('detection_source'),  // 'sxxexx-filename' | 'folder-tree' | 'fuzzy-title' | 'manual'
}, (t) => ({
  parentIdx: index('movie_groups_parent_idx').on(t.parentGroupId),
  typeIdx: index('movie_groups_type_idx').on(t.type),
  statusIdx: index('movie_groups_status_idx').on(t.status),
}));
```

### Modification — `movies` table

Add one nullable column:

```ts
// Migration
ALTER TABLE movies ADD COLUMN group_id TEXT REFERENCES movie_groups(id);
CREATE INDEX movies_group_id_idx ON movies(group_id);
```

A movie's `groupId` always points at a **subgroup**, never directly at a parent. The parent is reached via `subgroup.parentGroupId`. This keeps episode→season→show a clean two-hop traversal.

### Why two levels instead of N

For 99% of real-world content, depth-2 (show → season) is enough. Anthology shows with arcs, mini-series with parts of seasons, etc. fit into the same shape. Adding arbitrary depth (parent group of parent groups) doubles the complexity of every query and UI without solving a real problem. If we ever need it, the schema already self-references — we just allow `parent_group_id` to chain.

### Backfill

After schema migration, all existing movies have `groupId = NULL` — i.e., flat / ungrouped. A backfill job (admin-triggered or on first deploy of the feature) runs the detection pipeline on every existing movie. Idempotent — running it twice yields the same groups.

---

## 4. Detection pipeline

A movie (or set of movies) goes through detectors in priority order. The first detector that returns a result with confidence ≥0.55 wins; the others are recorded as `altParents` for re-assignment.

### Signal hierarchy (high → low confidence)

| Rank | Signal | Confidence floor | Notes |
|---|---|---|---|
| 1 | Filename `SxxExx` / `xXxx` pattern | 0.95 | `Seinfeld.S03E12.mkv`, `Seinfeld 3x12.mkv`, `seinfeld_s03_e12.mkv` — robust against case, separators. |
| 2 | Folder tree match | 0.85 | `<show>/Season N/file.mkv` or `<show>/S0N/file.mkv`. Episode order from filename if available, else alphabetic. |
| 3 | TMDB/TVDB TV metadata | 0.90 | Phase 2. If we can identify the file as a TV episode with definitive series+season+episode, this beats folder structure. |
| 4 | Multi-file folder heuristic | 0.65 | Folder contains 3+ video files with sequential numbering and no SxxExx? Treat as a subgroup; parent name from folder. |
| 5 | Fuzzy title similarity to existing group | 0.55–0.85 (scored) | Normalize title (strip year, quality tags, codec, group tags), compare against existing parent group names via Levenshtein + token Jaccard. |

### 4.1 Filename `SxxExx` detector (gold standard)

```
/(?:^|[\s._\-])s(\d{1,2})[\s._\-]?e(\d{1,3})(?:[\s._\-]|$)/i      // S03E12, s3e12, S03.E12
/(?:^|[\s._\-])(\d{1,2})x(\d{1,3})(?:[\s._\-]|$)/i                // 3x12
```

If a match is found:
- The text *before* the match becomes the candidate show name.
- Season + episode number are captured directly.
- Apply title normalisation (see 4.4) to the show-name candidate.
- Search existing parent groups by fuzzy match.
  - If a parent exists with similarity ≥0.92: attach to that parent.
  - Else: create a new parent group with the normalised name.
- Find or create a subgroup `<show> - Season N` under that parent.
- Attach the movie to the subgroup.

Confidence: 0.95 unless the show-name candidate is empty or one of a blocklist (`movie`, `the`, `1080p`, etc.) — then drop to 0.60 (becomes "unsure").

### 4.2 Folder-tree detector

Walks the movie's file path. Looks for these shapes (case-insensitive):

- `**/Show Name/Season 03/file.mkv`
- `**/Show Name/S03/file.mkv`
- `**/Show Name/Series 3/file.mkv`
- `**/Show Name/file.mkv` where the parent folder contains 3+ video files (treat the folder as a single-season subgroup).

For folder + season shape:
- Show name = parent folder above the season folder.
- Season number = parsed from the season folder name.
- Confidence 0.85.

For folder + many siblings shape:
- Show name = the folder name itself.
- Season ordinal = 1 (or null if we can't infer).
- Confidence 0.70.

### 4.3 Multi-file folder heuristic

When neither (1) nor (2) fire: if the movie shares a folder with N≥3 other video files, and the filenames contain sequential numbering (`Part 1`, `Part 2`, `1of3`, `01.`, `02.`), treat the folder as a subgroup of unknown TV origin. Confidence 0.65 — the user will likely confirm or split this.

### 4.4 Title normalisation (used by all detectors)

```
1. Lowercase.
2. Strip year markers: (1997), [1997], 1997 when surrounded by separators.
3. Strip quality/codec/source tags: 1080p, 2160p, x264, x265, hevc, h264, web-dl,
   bluray, remux, hdr, dts, ac3, aac, 5.1, etc.
4. Strip release-group tags: anything in [brackets] or after the final dash that
   matches a known group pattern (RARBG, YIFY, FGT, …).
5. Replace separators (._-) with spaces.
6. Collapse whitespace.
7. Strip leading "the".
```

Comparison metric for "are these the same show?":

```
similarity(a, b) =
  0.5 * (1 - levenshtein(a, b) / max(len(a), len(b)))
+ 0.5 * jaccard(tokens(a), tokens(b))
```

Token Jaccard handles word reordering and missing/extra qualifiers; Levenshtein handles typos and case variance. The 50/50 blend is empirically good for our use case but should be tuneable via a setting if testing reveals bias.

### 4.5 Confidence threshold settings

These thresholds become user-tweakable settings (defaults shown):

| Setting | Default | Range | Meaning |
|---|---|---|---|
| `grouping.auto_confirm_min` | 0.85 | 0.70–0.99 | Groups at or above this auto-apply silently |
| `grouping.unsure_min` | 0.55 | 0.30–0.85 | Below this, no grouping happens |
| `grouping.fuzzy_match_threshold` | 0.78 | 0.50–0.95 | Required similarity to attach to existing parent |

---

## 5. Triggers

### 5.1 During scan

`ScannerService.importFile()` already handles per-file import. After import succeeds, enqueue a `group-detect` job for that movie (priority normal). The job runs the pipeline on the single movie. If grouping is disabled in settings, the job is a no-op.

This keeps the scanner fast — the heavy fuzzy matching happens off the critical path.

### 5.2 Bulk re-grouping (admin button)

New button on `Admin → Admin` page: **"Group Similar Items"**. Calls `POST /api/v1/admin/grouping/rebuild`. The handler:
- Detaches every movie's `groupId` (sets to NULL), deletes all `auto` and `unsure` groups (keeps `confirmed` and `manual` groups intact).
- Enqueues a `group-detect-all` background job that runs the pipeline on every movie.
- Progress reported via WebSocket (`grouping:progress` event).

This is destructive of detector output but never of user confirmations — `confirmed` groups are preserved.

### 5.3 Settings

Per-server settings (new section in Settings page):

```
Grouping
├── ☑ Enable automatic grouping                            (grouping.enabled, default true)
├── ☐ View library as groups by default                    (grouping.default_view, default true)
├── Auto-confirm threshold:    [0.85 ▼]                    (grouping.auto_confirm_min)
├── Fuzzy match threshold:     [0.78 ▼]                    (grouping.fuzzy_match_threshold)
└── [ Group Similar Items Now ]
```

### 5.4 Per-session UI toggle

On the Library page toolbar, add a new view-mode button next to the existing
large/grid/list trio:

```
[ ⬜ ▦ ☰ | 🗂 Group ]
```

`Icon name="layers"` for the new toggle. When ON:
- The library shows each subgroup as a single card (poster from the first episode or from `movieGroups.posterUrl`).
- Clicking the card navigates to **Group Detail** (see §7).
- Standalone movies (no `groupId`) render normally alongside group cards.

State: stored in `useUiSetting('library_group_view', true)`. Persists per-user.

---

## 6. API surface

### Read

```
GET  /api/v1/groups                  → list of parent groups (paged, sortable)
GET  /api/v1/groups/:id              → group detail + child groups + movies
GET  /api/v1/groups/:id/movies       → just the movies under this group / subgroup
GET  /api/v1/groups/unsure           → list of all groups with status=unsure (for "needs review" admin badge)
```

### Mutate

```
POST   /api/v1/groups/:id/confirm    → mark as confirmed (status → confirmed, clears altParents)
POST   /api/v1/groups/:id/reject     → mark as rejected (detaches movies back to flat, removes group)
PATCH  /api/v1/groups/:id            → rename, move under different parent, change poster, etc.
POST   /api/v1/groups                → create a parent group manually
POST   /api/v1/groups/:id/attach     → attach a movie or subgroup to this group (manual override)
DELETE /api/v1/groups/:id            → ungroup everything under this group
```

### Admin

```
POST /api/v1/admin/grouping/rebuild  → kick off full re-detection job (returns jobId)
GET  /api/v1/admin/grouping/status   → job state, progress, current item
```

All routes go behind the existing `JwtAuthGuard` + `@Roles('admin')` where appropriate.

---

## 7. UI surfaces

### 7.1 Library view with grouping enabled

- Subgroups collapse into a single card per group. Card shows: parent poster (or generated grid of first 4 episode thumbnails), parent title, season count (e.g. "3 seasons · 67 episodes").
- Ungrouped movies render as normal cards alongside.
- The `[ 🗂 Group ]` toolbar button toggles the entire library between grouped + flat.

### 7.2 Group / Series detail page

New route: `/group/:id`. Component: `<GroupDetail />`. Extends the patterns from `<MovieDetail />`:

**Top section** (parent group view):
- Backdrop + poster (same layout as MovieDetail's hero).
- Title, year span (`1989–1998`), episode count, overview.
- Action buttons: **Play next** (resumes wherever the user left off in this show), **Watchlist toggle**, **Share**, **Edit group**, **Ungroup**.

**Body:**
- "Seasons" tab strip listing all child subgroups.
- Each season tab shows: season poster, season number, episode count, "Play all" button, episode list (uses the existing MovieListItem render).
- Episodes within a season are sorted by `ordinal` ascending (the episode number captured during detection).

**Confirmation banners** (when applicable):
- If the parent group has `status='unsure'`: yellow banner *"Mu thinks this group belongs under '[other parent]'. [Move there] [Keep it here]"*.
- If any child subgroup has `status='unsure'`: badge on the season card.
- If the parent has no children with `status='unsure'` and at least one is `auto`: a single subtle prompt *"Confirm this grouping?"* with one-click confirm-all.

### 7.3 Confirmation UX for individual subgroups

A subgroup in `unsure` state on either the Group Detail page or as a "Needs review" admin page entry shows:

```
┌─────────────────────────────────────────────────────────┐
│ Seinfeld - Season 4  (12 episodes)                      │
│                                                          │
│ Mu thinks this belongs to ▸ Seinfeld (90% sure)         │
│ Alternatives:                                            │
│   ○ Seinfeld Reunion Special  (40%)                     │
│   ○ Create new parent group                             │
│                                                          │
│ [ Keep here ]  [ Move ]  [ Split out ]                  │
└─────────────────────────────────────────────────────────┘
```

### 7.4 Manual operations

- **Reassign**: drag a subgroup card from one parent's Group Detail into another's. Or via the "Move" button → modal lists existing parents + "Create new parent."
- **Split**: separate a subgroup from a parent (detach, parent stays, subgroup becomes its own orphan or new parent).
- **Merge**: under two parents that should be one, "Merge into…" button moves all subgroups under the chosen parent and deletes the donor parent.

---

## 8. Backend module layout

```
packages/server/src/grouping/
├── grouping.module.ts
├── grouping.controller.ts          // routes from §6
├── grouping.service.ts             // orchestration + admin entry points
├── group-detect.job.ts             // background job handler
├── detectors/
│   ├── sxxexx-detector.ts
│   ├── folder-tree-detector.ts
│   ├── multi-file-detector.ts
│   └── fuzzy-title-detector.ts
├── title-normaliser.ts             // shared by detectors
├── confidence.ts                   // scoring + threshold logic
└── groups.repository.ts            // typed DB ops, parallels SubtitleTracksRepository
```

`GroupingService` orchestrates detector dispatch and group merging. Each detector is a pure class taking `(movie, context)` and returning a `DetectionResult` or `null`:

```ts
interface DetectionResult {
  parentName: string;
  parentMatch?: 'existing' | 'new';    // existing if a fuzzy match found
  parentGroupId?: string;              // populated when matched
  subgroupName: string;                // "Show - Season 3"
  ordinal: number | null;
  episodeOrdinal: number | null;
  confidence: number;                  // 0..1
  source: DetectionSource;
  alternatives?: Array<{ parentGroupId: string; confidence: number }>;
}
```

The service runs detectors in priority order, takes the first result above the unsure threshold, and persists. Lower-ranked alternatives are stored in `movie_groups.altParents` so the UI can offer re-assignment.

---

## 9. Edge cases & open questions

### Edge cases handled

- **Specials / E00**: SxxE00 maps to a subgroup ordinal of 0 (Specials). UI labels them "Specials" instead of "Season 0".
- **Movies in series folders**: a folder named "Lord of the Rings" containing 3 movies. Multi-file heuristic picks it up; subgroup ordinal = 1, episode ordinals = release order. The user can confirm it as a series or split into individual movies.
- **Same show in two libraries**: parent group names match → fuzzy detector merges into one parent. User can split if they intended them separate.
- **Already-imported movies that get a new season added**: scan adds new files, group-detect job runs on each new file, finds existing parent by fuzzy match, attaches to (or creates) the right season subgroup. Automatic.
- **A movie deleted from disk**: existing `purgeOrphanedMovies` removes the movie row → `groupId` FK cleanup deletes the row's group reference. If the subgroup ends up empty, a sweeping pass deletes the subgroup; if the parent ends up empty, delete the parent. (Or keep empty groups for one cycle in case files come back online?)

### Open questions

1. **Default view mode** — should new users see grouped or flat? Spec defaults to grouped; UX argument either way.
* Grouped.
2. **TV metadata fetch** — phase 2. Worth a separate spec for TVDB integration: episode-level metadata, per-episode posters, intro/outro detection. Out of scope here.
* Sure, spec it out for next phase.
3. **Parent-of-parent**: do we ever need it? (e.g., a "Marvel Cinematic Universe" parent containing "Iron Man" trilogy + "Avengers" series.) For now: no — the user can use Playlists for cross-series collections. Schema supports it via self-FK if we change our mind.
* K, later.
4. **Re-detection on metadata change**: if the user manually edits a movie's title, should grouping re-run for that movie? Probably yes — a config'd debounce of 30s after title edits, then re-detect just that movie.
* Sure.
5. **Plugin hook**: should the detection pipeline be plugin-extensible (so the TMDB-TV plugin or a custom user plugin can register an extra detector)? Worth opening up the registration API even in phase 1 — cheap to add, expensive to retrofit.
* yes.
6. **Empty parent retention window**: when the last subgroup of a parent is removed, do we delete the parent immediately or hold for 30 days in case more episodes arrive? Defaulting to immediate; revisit if it bites in practice.
* Can delete immediately, remake later.

---

## 10. Rollout plan

### Phase 1 — core (this spec)
- Schema migration (`movie_groups` table + `movies.group_id`).
- Detectors: SxxExx, folder-tree, multi-file, fuzzy-title.
- Scan integration (post-import job).
- Admin rebuild endpoint + button.
- Library `group view` toggle.
- Group Detail page (read-only display + confirm/reject buttons).
- Settings panel for enable/thresholds.

**Estimate:** 2–3 days of focused work. ~1500 LOC server + ~800 LOC client.

### Phase 2 — TV metadata
- TVDB or TMDB-TV provider that resolves a show name to a series ID and pulls season/episode metadata.
- Per-episode title + air date + plot on the Group Detail page.
- Series posters / backdrops from the provider instead of from the first episode.
- Confidence boost for matches that round-trip through real provider metadata.

### Phase 3 — power-user features
- Drag-and-drop reassignment in Group Detail.
- "Needs review" admin badge with count.
- Bulk operations from the unsure-list view (confirm all, reject all matching a pattern).
- Plugin detection hook (if not already in phase 1).

---

## 11. Existing architecture impact

| Surface | Change |
|---|---|
| `database/schema/index.ts` | Re-export new `movie_groups` table. |
| `database/schema/movies.ts` | Add nullable `groupId` column + index. |
| `library/scanner.service.ts:importFile` | After successful insert, enqueue `group-detect` job for the new movie ID. |
| `library/library-jobs.service.ts` | Register `group-detect` and `group-detect-all` handlers. |
| `library/watcher.service.ts` | Unchanged — already routes through `importFile`. |
| `admin/server.controller.ts` | Add `POST /grouping/rebuild` + `GET /grouping/status`. |
| `app.module.ts` | Import the new `GroupingModule`. |
| `client/state/library.state.ts` | Add a `groupView` signal + `groups` cache. |
| `client/pages/Library.tsx` | Toolbar adds the "Group" view-mode button; render path branches on `groupView`. |
| `client/pages/GroupDetail.tsx` | NEW. |
| `client/components/movie/MovieGrid.tsx` | When `groupView` is on, render group cards interleaved with ungrouped movies. |
| `client/pages/Settings.tsx` | New "Grouping" section with the three settings + admin button. |
| `client/services/groups.service.ts` | NEW. Mirrors `movies.service.ts` shape. |

No existing routes change. No movies are migrated destructively. The feature is layered on top.

---

## 12. Things to nail down before implementation

These are the questions I'd most want answered before writing code:

1. **Auto-confirm threshold default** — confirm 0.85 is the right line. If you've seen the corpus (your `D:\Movies` library), would you expect most TV to land above 0.85?
* this is fine, configurable in settings.
2. **"Auto" vs "unsure" UI prominence** — do auto groups show any visual hint at all (a small dot? nothing?), or only unsure ones?
* Both: if a movie or series is grouped, show the indication somewhere, and a link to the group page, and if it's unsure, indicate that in a special icon/flag.
3. **Group poster source** — first episode's poster, or auto-generated 2×2 grid of first four episode thumbnails, or pulled from TVDB/TMDB later? Phase 1 default: first episode's poster.
* For series... multiple episode is preferable, but maybe allow the option in the component somehow for now.
4. **Should grouped movies stay browsable individually in flat view?** I think yes — the toggle just changes presentation, never gates access.
* Yes, just presentation.
5. **TMDB TV phase 2 priority** — is it within the next few weeks of work, or further out? Affects whether to design phase-1 schema with TV-provider IDs already present (current spec does — `tmdb_tv_id`, `imdb_id` columns are there ready).
* yes, will be in this phase, sooner, can do it.
6. **Confirm naming** — "Group" / "Series" / "Show"? Spec uses "Group" as the data-model term and "Series" as the user-facing word in some places. Pick one for consistency.
* Eh, can we be smart about it? Some indication eventually to help the UI? Fallback to group, but the group should have some column or indication of 'group_type', maybe there we can allow 'series', 'show', 'collection', I don't know, anything. The grouping algorithm can try to detect it and set this, and the user can change it if they want.

---

*End of spec.*

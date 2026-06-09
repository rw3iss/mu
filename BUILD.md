# BUILD.md — Mu (CineHost)

Build rules for this app: structure, code quality, and tooling conventions.
**Every `design-build` request reads this file** (alongside `DESIGN.md`) and must
follow it. Record project-specific build decisions here so later builds comply.

Mu (CineHost) is a **real, self-hosted full-stack app** — a Preact client backed by
a NestJS API, in a pnpm + Turborepo monorepo. `design-build` operates on the
**Preact client** (`src/packages/client`); it does **not** write backend code or
tests. Client data flows through typed API services against the real backend (no
mock-only adapter layer here).

## Stack

- **Client:** **Preact 10 + Preact Signals + TypeScript (strict) + SCSS Modules + Vite 6**, with **HLS.js** for playback. The `design-build` target.
- **Server (out of scope for design-build):** **NestJS 11 + Fastify 5 + Drizzle ORM + SQLite (better-sqlite3)**, FFmpeg for transcoding.
- **Shared:** **`@mu/shared`** — types + utilities shared between client and server. Import shared shapes from here; don't redefine them per side.
- **Monorepo:** **pnpm 9 workspaces + Turborepo**. The workspace root is **`src/`** (`src/package.json`); packages live under `src/packages/*` and plugins under `src/plugins/*`.
- **Lint/format: Biome** (not ESLint, not Prettier) — tabs, single quotes, trailing commas, semicolons, line width 100.
- Node **≥ 20**. **pnpm is canonical** — use `pnpm add/install` for dependency changes.

### Commands

All commands run from **`src/`**:

```
pnpm install
pnpm dev          # server + client concurrently
pnpm dev:client   # Vite dev server only
pnpm dev:server   # NestJS API only (port 4000)
pnpm build        # Turborepo build (all packages)
pnpm check        # biome check --write  (lint + format)
pnpm lint:fix     # biome lint --write
pnpm format       # biome format --write
```

TypeScript **strict is on**. Biome is the linter/formatter — run `pnpm check` before
considering a change done.

### Config / location map

- Workspace root + top-level scripts: **`src/package.json`** (Turborepo + pnpm workspaces).
- Client app: **`src/packages/client/`** — `vite.config.ts`, `index.html`, `src/`.
- Server app: **`src/packages/server/`**.
- Shared: **`src/packages/shared/`** (`@mu/shared`).
- Plugins: **`src/plugins/<plugin-id>/`** (server `index.ts` + client `client/index.tsx`).
- Runtime data (DB, config, logs, cache) lives in **`<repoRoot>/data/`** — **not** in git.

## Project structure (client)

`design-build` works inside `src/packages/client/src/`:

```
src/
  pages/          Route-level screens (Library, MovieDetail, Settings, …) — src/pages/<Page>/
  components/     Reusable UI. Feature blocks → components/<feature>/;
                  primitives → components/common/<Component>/ (Button, Select, Modal, …)
  state/          Preact Signals global state (library, player, auth, theme, appearance, …)
  services/       Typed API client services (movies, auth, plugins, …) — the data layer
  audio/          Web Audio engine (EQ, compressor, dry/wet)
  hooks/          Custom hooks (useUiSetting localStorage persistence, …)
  plugins/        Client-side plugin system (slot manager, loader)
  styles/         Global SCSS: _variables.scss (tokens), _mixins.scss, global.scss
```

- **Place by role:** a **page** (route/screen) → `src/pages/<PageName>/`; a
  **feature/UI component** → `src/components/<feature>/`; a **primitive/common control**
  (Button, Input, Modal, Select, …) → `src/components/common/<Component>/`. Never dump
  everything flat into `src/components/`.
- **One component = one folder-or-pair:** `Component.tsx` + a co-located
  `Component.module.scss` (SCSS Modules). Reusable/stateful logic → `hooks/`; pure logic
  → a util module — never inline shared logic into a component.
- **`_variables.scss` + `_mixins.scss` are auto-injected** into every module via Vite
  `additionalData` (`@use … as *`), so component SCSS uses `var(--*)`, `@include`, and
  `$breakpoint-*` **directly** — do **not** add per-file `@use` of the shared style files.

## Component design — SOLID

Every component follows SOLID principles:

- **Single-purpose** — one component does one thing. If it grows two responsibilities, split it.
- **Open/extensible** — extend via props, `children`, and composition rather than editing internals or copying.
- **Substitutable** — variants honor the same prop contract (one card renders movie / group / collection through a shared shape).
- **Narrow interfaces** — minimal, specific props.
- **Depend on abstractions** — components consume the `services/` API layer, `state/` signals, and `hooks/`; never bespoke `fetch` or a backend detail directly.

## Code structure — hoist & centralize

- **Hoist within a file.** Order every file: imports → constants/config → types → helper functions → the component/export. No magic values or helpers buried mid-component.
- **Centralize.** Shared utilities/hooks live in `hooks/` (stateful) and util modules (pure); shared API access in `services/`; shared state in `state/`. Never duplicate a helper, constant, or type across files — define once, import everywhere. Cross-side shapes come from `@mu/shared`.
- **Tokens only.** Reference design tokens (`DESIGN.md`) — never raw color/space/radius/type values.
- **TypeScript strict.** Explicit prop types; no `any` in a component's public surface.

## Component behavior — intelligent, non-blocking

- **Never block rendering or interaction.** A component renders its shell immediately; never `await` data before first paint and never freeze the UI.
- **Lazy-loading states are the default.** Data-driven components progress through (1) an initial/empty shell, (2) a loader/skeleton, (3) the loaded data — render (1) instantly, then (2), then (3). Images use the lazy/skeleton `SmartImage`.
- **Use caching when available.** Where a client-side cache or Signals store already holds data, reads serve the cached value immediately and revalidate in the background; don't refetch what state already has.
- **Throttle bound input handlers.** Inputs with bound handlers (`onInput`, `onScroll`, `onResize`, `onMouseMove`, search-as-you-type, scrubber drags) are **throttled to 100ms by default**. Override only when a specific input needs it.

## Data & API — go through `services/`

**All client API access goes through the typed services in `src/services/`** — not
bespoke `fetch`/HTTP in components, and not new mock adapters.

1. **Reuse a service first.** Before adding a call, look for an existing
   `services/<area>.service.ts` method (movies, auth, plugins, search, …). Use it.
2. **Missing? Add to the service.** New endpoints get a typed method on the relevant
   service (or a new `services/<area>.service.ts`), typed with shapes from
   **`@mu/shared`** — so every screen benefits and the contract is one place.
3. **Components depend on the service**, hooks, and `state/` signals — never on the
   transport. Swapping how a call is made stays inside `services/`.
4. The backend is **real** (NestJS). `design-build` does **not** add backend
   routes/handlers — if a feature needs a new endpoint, note it for the server work;
   the client side codes against the typed service method that will back it.

> There is no mock-only `ApiClient`/`MockApiAdapter` layer in this project (that's the
> scaffold default for backend-less prototypes). Mu has a live API; the equivalent
> single seam is `src/services/`.

## Design tokens

- **Canonical source of truth: `src/styles/_variables.scss`** — emits the runtime CSS
  custom properties on `:root` (colors, spacing, radii, shadows, type, easing, z-index),
  with a `[data-theme='light']` override block. Sass-layer breakpoint vars live in the
  same file and in `_mixins.scss`.
- **Use `var(--*)` in component CSS** — never a raw color/space/radius/font value. An
  unresolved `var()` silently falls back and breaks the look; look the name up first.
- **Many tokens are user-tunable at runtime** (accent, backgrounds, hover, text, inputs,
  `--item-gap`, `--item-radius`, `--card-border`, `--text-scale`) via the theme editor —
  so read from tokens and never assume a fixed palette/contrast. See `DESIGN.md`.

## SCSS architecture — SCSS Modules, mobile-first

- **SCSS Modules** (`*.module.scss`), co-located per component; class names import as
  `styles.foo` and render via Preact `class={styles.foo}`.
- Base styles target mobile; layer up with the auto-injected mixins:
  `@include mobile` / `tablet` / `desktop` / `tablet-up` / `desktop-down`. Plus
  `@include card`, `hover-lift`, `glass` / `glass-surface`, `flex-center`,
  `truncate($lines)`, `scrollbar`, `focus-ring`.
- **Gate `:hover`** so it can be globally disabled: `:root:not([data-no-hover]) &:hover { … }`.
- **Wrap motion for reduce-motion** — `prefers-reduced-motion` and the app's
  `data-reduce-motion` attribute both zero transitions globally; never depend on a
  transition to reach a final state.
- New components **own their own module**; don't pile new styles into an unrelated one.
- **Motion rules are load-bearing:** no `transition: all`, no `!important` on
  shared/global transition rules, and no global transitions on inherited props
  (`color`/`fill`/`stroke`) — they cause the first-hover blink (see `DESIGN.md` → Motion).

## Theming

- **Dark by default; light via `<html data-theme="light">`.** Both first-class. All
  colors come from CSS custom properties, so components never branch on theme.
- **Fully user-themeable at runtime** — `state/themes.state.ts` `applyThemeConfig()`
  writes a `ThemeConfig` (`@mu/shared` `theme.ts`) to `:root` and derives accent variants.
  The theme choice persists via `useUiSetting` (localStorage) and applies before paint
  to avoid FOUC.
- **The theme crossfade is armed only after the initial load** and fires only on user
  theme switches — a page load must never open a transition window (it races the first
  hover). Keep that gating intact.

## Typography (do not substitute)

- **Outfit** — the entire UI (thin/geometric/cinematic), via `--font-family`.
- **JetBrains Mono** — timecodes, durations, numeric/codec meta, via `--font-family-mono`.
- The font loads via a `<link>` (preconnect + parse-time) in `index.html` — **not** a
  blocking `@import` — so a late swap can't reflow into an interaction. Size with
  `--font-size-*` / `--text-scale` (never raw `rem`/`px`) so the user's font scale works.
  Don't swap the stack without a design conversation.

## Routing

Client routing uses **`preact-router`** (`route(path)` to navigate, `<Link>`/`<a>` for
links). The **player is not a route** — it's a persistent overlay managed by
`state/globalPlayer.state.ts`; the video element stays mounted across mini ↔ full.
Pages live under `src/pages/<Page>/`.

## Reuse & documentation — keep it DRY

- **`COMPONENT_INDEX.md` is the source of truth.** Document every new page, component,
  hook, util, service, and SCSS module/mixin there: path · one-line purpose · reuse-for
  hint. **Consult it before building** — reuse or extend existing
  components/hooks/utils/services before creating anything new. (Generate it on the next
  build if it doesn't exist yet.)
- **Keep `CLAUDE.md` and `README.md` current** with major features or changes.
- **Never duplicate** a token, mixin, SCSS class, util, hook, service method, or
  component — extend the existing one (add a prop/variant/parameter) instead of cloning.

## Anti-patterns — do NOT introduce

- No bespoke `fetch`/HTTP in components — go through `services/`.
- No native `<select>` — use the themed Select/Dropdown (native can't be themed cross-browser).
- No raw hex/rgb or invented hues/fonts/radii — tokens only.
- No theme branching in components (`[data-theme=light]`) — override token *values*.
- **No `transition: all`, no `!important` on shared transition rules, no global
  transitions on `color`/`fill`/`stroke`** — they cause the hover blink.
- No glassmorphism as a default surface (overlays only); no gradient text, neon glow, or emoji in UI.
- No files dumped flat into `src/components/` — follow the page/feature/common placement.
- No `className` — Preact uses `class=`. No React `useState` patterns where a Signal fits.
- Don't redefine cross-side types — import from `@mu/shared`.

## Out of scope

- **No backend code** (NestJS server, Drizzle schema, transcoding) and **no tests** —
  `design-build` is client-only. If a feature needs a new endpoint or shared type, note
  it; the client codes against the typed `services/` method that will back it.
- No build/deploy/infra changes (those live in the repo's deploy scripts + `CLAUDE.md`).

# COMPONENT_INDEX.md — Mu client

The reuse manifest for `src/packages/client`. **Consult this before building** and
**update it after** — every new shared component, hook, util, service, or SCSS
mixin/class gets a row: `path · purpose · reuse-for`. Reuse or extend before
creating anything new. (Seeded with the Profile/Members feature + the primitives
it leans on; extend it as the app grows — it is not yet exhaustive.)

## Components

| Path | Purpose | Reuse for |
|---|---|---|
| `components/common/Avatar.tsx` | Round user avatar (photo or gradient initial fallback) | Anywhere a user is shown — profile header, member rows, sidebar |
| `components/common/Panel.tsx` | Titled surface panel (header + actions slot + body) | Sectioning any page into Deep-Space panels |
| `components/common/MediaCard.tsx` | Poster/portrait tile with title/subtitle/badge/overlay slots + href | Movie/person/collection tiles, favorites grids |
| `components/common/Button.tsx` | Button (primary/secondary/ghost/danger, sizes, loading) | Any action button |
| `components/common/ToggleButton.tsx` | Pressed/unpressed toggle with icon + loading | On/off settings, filter chips |
| `components/common/Select.tsx` | Themed dropdown (never a native `<select>`) | Any single-choice control |
| `components/common/Spinner.tsx` | Loading spinner (sizes) | Loading states |
| `components/common/SmartImage.tsx` | Lazy image with skeleton + fallback label/icon | Posters, backdrops, avatars |
| `components/common/Toast.tsx` + `state/notifications.state.ts` | Toasts via `notifySuccess/Error/Warning/Info` | Save/feedback notifications |
| `components/common/ConfirmDialog.tsx` (+ `hooks/useConfirm`) | Confirm modal | Destructive confirmations |
| `components/profile/ProfileFavorites.tsx` | Favorites grid + movies/cast/director filter toggles (earliest-first) | A user's favorites on a profile |
| `components/profile/ProfileHistoryList.tsx` | Recently-watched rows with per-movie resume position bar | A user's watch history |
| `components/profile/WatchingNow.tsx` | Backdrop-led "Watching Now" tout with live progress | Surfacing a user's active session |
| `pages/Profile/ProfilePage.tsx` | Social profile — `/profile` (edit) + `/profile/:username` (read) | The profile route |
| `pages/Members/MembersPage.tsx` | Members directory (gated by the system setting) | The `/members` route |

## Shared utilities & hooks

| Path | Purpose | Reuse for |
|---|---|---|
| `services/profile.service.ts` | Profile + Members + system-config API (`getMine`, `getByUsername`, `updateMine`, `getSystemConfig`, `setSystemConfig`, `listMembers`) | All profile/members data |
| `state/system.state.ts` | `showUsersInfo` signal + `loadSystemConfig()` / `setShowUsersInfoLocal()` | Reacting to the admin "Show Users Info" switch |
| `utils/time-format.ts` | `clockFromSeconds()` (m:ss / h:mm:ss), `relativeTime()` | Durations, positions, "watched X ago" |
| `hooks/useUiSetting.ts` | `useUiSetting(key, default)` — localStorage-backed signal | Persisted per-browser UI prefs |
| `services/api.ts` | `api.get/post/put/patch/delete` (the only HTTP seam) | Any backend call — go through a `services/*.service.ts` |

## Shared SCSS (mixins · classes · tokens)

| Path | Purpose | Reuse for |
|---|---|---|
| `styles/_variables.scss` | All design tokens (`:root` custom props + `[data-theme=light]`) | Every color/space/radius/shadow/easing/z-index |
| `styles/_mixins.scss` | `@include mobile/tablet/desktop`, `card`, `hover-lift`, `glass`/`glass-surface`, `flex-center`, `truncate($n)`, `scrollbar`, `focus-ring` | Layout + interaction patterns (auto-injected into every module) |
| `components/common/Avatar.module.scss` | `.avatar` gradient-initial style | (via the `Avatar` component) |
| `components/common/Panel.module.scss` | `.panel` titled surface | (via the `Panel` component) |

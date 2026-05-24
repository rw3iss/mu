# Users & Permissions — Design

**Date:** 2026-05-23
**Status:** Approved — ready to plan
**Scope:** Replace single-admin assumption with a real three-role user system, segregate per-user settings from app settings, gate every API endpoint with a permissions check, ship an admin Users page, and fix a critical role-escalation bug.

---

## 1. Goals

1. Support **multiple users** with three roles: `admin`, `contributor`, `viewer`.
2. **Segregate settings** into app-wide (current `settings` table) and per-user (new `user_settings` table). The client always sees a *merged* view; the server writes to the correct scope based on the key.
3. Provide **shared permission utilities** so every controller method declares its required capability in one place (decorator + service).
4. **Audit and gate every API endpoint** so contributors and viewers cannot escalate their privilege.
5. Add a **Users admin page** for CRUD on accounts.
6. Cache **JWT verification and user lookups** so the new permission layer doesn't add per-request DB latency.
7. **Fix the existing role-escalation bug** in `PATCH /users/:id` as a hard prerequisite (lands in Phase 0).

## 2. Non-goals

- No password reset / email verification flow — admin sets passwords manually.
- No 2FA, no SSO, no OAuth — username/password only.
- No invite-link flow for now — admin creates users directly.
- No "groups" or "tags" of users beyond the three roles.
- No per-movie ACLs — viewer/contributor see the same catalog.
- No audit log of who-changed-what beyond the existing `provider_events` machinery.

---

## 3. Role model

```
admin       — full control. Manages users, app settings, library, plugins, jobs.
contributor — can edit movies (metadata, posters, matches), but cannot touch
              app-level settings, library config, plugins, or other users.
              Reads admin-only settings as read-only.
viewer      — can view + search the library, play media, manage own watch
              history / favorites / playlists / ratings, and edit their own
              user-scoped settings. No write access to anything else.
```

Synthetic guard-only role: `share` (set by `JwtAuthGuard` when a share-token is presented). **Not stored in DB, not in the `UserRole` type.** `PermissionsService` treats `share` as having only `view:shared-movie`. Documented in `jwt-auth.guard.ts`.

### Action / capability vocabulary

The permissions layer is built around named **actions**, not raw roles. Controllers declare which action they require; only the service knows which roles satisfy each action.

| Action | Description | admin | contributor | viewer | share |
|---|---|---|---|---|---|
| `view:public` | Anonymous-OK endpoints (health, sharing handshake) | ✓ | ✓ | ✓ | ✓ |
| `view:library` | Browse, search, detail pages | ✓ | ✓ | ✓ | — |
| `view:own-data` | Own history, favorites, playlists, ratings | ✓ | ✓ | ✓ | — |
| `view:shared-movie` | Share-token-gated movie detail + stream | ✓ | ✓ | ✓ | scoped |
| `view:app-settings` | Read app-wide settings (some read-only-for-contributor) | ✓ | read-only | — | — |
| `edit:own-settings` | Write keys in the user-settings allowlist | ✓ | ✓ | ✓ | — |
| `edit:movie` | Metadata updates, refresh, match, override poster | ✓ | ✓ | — | — |
| `delete:movie` | Remove from library | ✓ | ✓ | — | — |
| `edit:app-settings` | Mutate app-wide settings (library, encoding, matching) | ✓ | — | — | — |
| `admin:users` | Create / list / update / delete users + role changes | ✓ | — | — | — |
| `admin:server` | Logs, transcode debug, restart, jobs admin | ✓ | — | — | — |
| `admin:plugins` | Enable / configure plugins | ✓ | — | — | — |
| `admin:datasets` | IMDB-datasets sync trigger + toggle | ✓ | — | — | — |
| `admin:any-user-setting` | Override any key in another user's settings (support) | ✓ | — | — | — |

### Self-target rule

For actions that operate on a user (`PATCH /users/:id`, `DELETE /users/:id`, `GET /users/:id/settings`), the service must check whether `targetUserId === currentUser.id`. Viewers and contributors can `PATCH` their own `username`, `email`, `avatar`, and `password` but **never** their own `role`. Only `admin:users` can change roles.

---

## 4. Settings model

### 4.1 Storage

Keep the existing `settings` table unchanged — it remains the **app-wide** store. Add a new `user_settings` table:

```sql
CREATE TABLE user_settings (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,       -- JSON-serialized, same shape as settings.value
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX user_settings_user_idx ON user_settings(user_id);
```

Rationale for a separate table (vs. nullable `user_id` on `settings`):
- Existing `settings` PK is `key`; making it composite is a destructive migration and rewrites every existing query.
- The two tables have different access patterns — app settings are read at boot and rarely change; user settings are read per-request hot path.
- Per-user cache is naturally keyed by `user_id` and lives separately from the app-settings cache.
- Easier `ON DELETE CASCADE` semantics when a user is removed.

### 4.2 Merge semantics

```
SettingsService.getForUser<T>(key: string, userId: string | null, defaultValue?: T): T
```

Resolution order:
1. If `userId` and key is in the user-settings allowlist (see §4.4): look up `user_settings(user_id, key)`. If present, return.
2. Else: look up `settings(key)`. If present, return.
3. Else: return `defaultValue` (or `undefined`).

`getAllForUser(userId)` returns the merged map: every app setting, with user overrides applied where they exist.

### 4.3 Write paths

- `setApp(key, value)` — writes to `settings`. Requires `edit:app-settings`.
- `setForUser(key, value, userId)` — writes to `user_settings`. Allowed if:
  - `key` is in the user-settings allowlist **and** `userId === currentUser.id`, **or**
  - `currentUser` has `admin:any-user-setting`.
- `deleteForUser(key, userId)` — drops the row, reverting to app default.

### 4.4 Key allowlist

A **hybrid allowlist** lives at `src/packages/shared/src/permissions/user-settings-keys.ts`:

```ts
export const USER_SETTING_KEYS = [
  // Playback
  'playback.preferredAudioLang',
  'playback.preferredSubtitleLang',
  'playback.autoplay',
  'playback.autoplayNext',
  'playback.bufferSize',
  'playback.skipIntroSeconds',
  'playback.skipCreditsSeconds',
  // Watch tracking (currently global at watchedThresholdSeconds /
  // completedTailSeconds — those become per-user-overridable keys with
  // app defaults preserved)
  'playback.watchedThresholdSeconds',
  'playback.completedTailSeconds',
  // Appearance
  'appearance.theme',
  'appearance.posterSize',
  'appearance.density',
  'appearance.cardLayout',
  // Notifications
  'notifications.toastDuration',
  'notifications.muted',
  // General
  'general.startPage',
  'general.dateFormat',
  'general.timeFormat',
] as const;

export type UserSettingKey = (typeof USER_SETTING_KEYS)[number];
export const isUserSettingKey = (k: string): k is UserSettingKey =>
  (USER_SETTING_KEYS as readonly string[]).includes(k);
```

Admin escape: `admin:any-user-setting` bypasses the allowlist (for support cases — pinning encoding for a single user). Used sparingly; surfaced in the Users admin page as "edit user's overrides" rather than via the main settings UI.

### 4.5 Cache

In-memory LRU per `userId`:

```ts
class UserSettingsCache {
  private cache = new Map<string, { map: Record<string, unknown>; expires: number }>();
  private static readonly TTL_MS = 5 * 60 * 1000;
  get(userId: string): Record<string, unknown> | null;
  set(userId: string, map: Record<string, unknown>): void;
  invalidate(userId: string): void;       // called on write
  invalidateAll(): void;                  // called when app settings change
}
```

App-settings writes invalidate all user caches (because user keys fall back to app values when unset).

---

## 5. Auth changes

### 5.1 localBypass — setup-only

`JwtAuthGuard` localhost-bypass path becomes:

```
if (request.is_localhost && config.auth.localBypass && noUsersExist()) {
   allow request, role = 'admin', sub = 'setup-bypass'
}
// otherwise: must present JWT cookie / header / share token
```

`noUsersExist()` is cached at module bootstrap and flipped to `true` permanently the first time `setup()` (or any direct user-creation path) succeeds. Once flipped, no localhost bypass — every request needs a JWT.

This means after first login, you stay logged in via cookie. The "first admin" lookup at line 107-112 of `jwt-auth.guard.ts` is removed entirely.

### 5.2 Token + user cache

```ts
class AuthCache {
  // JWT verification → payload, keyed by raw token string
  private tokenCache = new LruCache<string, JwtPayload>({ max: 1000, ttlMs: 60_000 });

  // User row by id, for role/permission checks
  private userCache = new LruCache<string, User>({ max: 500, ttlMs: 300_000 });

  invalidateUser(userId: string): void;  // called on role change, delete, password change
  invalidateAllUsers(): void;
}
```

`JwtAuthGuard` checks `tokenCache` first; on miss, verifies and stores. After a successful verify, fetches the User via cache, attaches both `request.user` (JWT payload) and `request.userRecord` (full user row).

User-mutation endpoints in `UsersController` MUST call `authCache.invalidateUser(id)` after each write. Same for `auth.service.ts` `setup()`.

### 5.3 PermissionsService

```ts
// src/packages/server/src/common/permissions/permissions.service.ts
@Injectable()
export class PermissionsService {
  // Role → allowed actions map (the table in §3)
  can(role: UserRole | 'share', action: Action): boolean;

  // Convenience methods used in services
  requireAction(user: JwtUser, action: Action): void;       // throws ForbiddenException
  isAdmin(user: JwtUser): boolean;
  canEditMovies(user: JwtUser): boolean;
  canEditAppSettings(user: JwtUser): boolean;
  canManageUsers(user: JwtUser): boolean;
  canEditOwnSettings(user: JwtUser, targetUserId: string): boolean;
  canEditUser(actor: JwtUser, targetUserId: string, field: 'role' | 'password' | 'profile'): boolean;
}
```

### 5.4 Decorator-first gating

Replace the existing `@Roles('admin')` decoration with a more expressive pair:

```ts
@RequireAction('edit:movie')        // exact action required
@RequireAdmin()                     // shorthand for @RequireAction('admin:server') ∪ admin role
@Public()                           // no auth required (currently @Public exists in jwt-auth.guard.ts)
```

`@Roles('admin')` is kept as a **back-compat alias** that maps to `@RequireAdmin()` so the audit doesn't have to land in one sweeping commit. The new `RequireActionGuard` runs after `JwtAuthGuard` + `RolesGuard` and:
1. Reads the `@RequireAction(...)` metadata.
2. Calls `permissions.can(request.user.role, action)`.
3. Throws `ForbiddenException` on miss.

Every controller method gets exactly one decoration at the new layer — no business logic peeks at `request.user.role` directly. Audit success criterion: `grep -r "request.user.role" packages/server/src` returns zero matches outside `permissions.service.ts` and `jwt-auth.guard.ts`.

---

## 6. Endpoint audit & gating table

The full mapping is generated and committed alongside the Phase 3 work (one row per HTTP handler). The phases below list the categories; the table appears in the plan as a checklist.

Notable category-level decisions:

| Endpoint category | Required action |
|---|---|
| `GET /movies`, `/movies/:id`, `/movies/search` | `view:library` |
| `PATCH /movies/:id`, `POST /movies/:id/refresh`, `/movies/:id/match`, `/movies/:id/clear-metadata` | `edit:movie` |
| `DELETE /movies/:id`, `/movies/refresh-all` | `edit:movie` (admin and contributor both) |
| `POST /movies/bulk/*` (mass mutations) | `edit:app-settings` (admin only — high blast radius) |
| `/library/sources`, `/library/scan`, `/library/rescan` | `edit:app-settings` |
| `/settings/playback` (read aggregate) | `view:library` — returns **merged** values for current user |
| `/settings/me` (NEW: read all merged for current user) | `view:library` |
| `/settings/me/:key` (NEW: write to own user_settings) | `edit:own-settings` |
| `/settings/:key` (existing app-settings write) | `edit:app-settings` |
| `/admin/*`, `/jobs/*` (mutating), `/imdb-datasets/*` | role-specific admin actions |
| `/users` GET (list) | `admin:users` |
| `/users` POST (create) | `admin:users` |
| `/users/:id` GET | `admin:users` OR self |
| `/users/:id` PATCH | `admin:users` for role; self for username/email/avatar/password |
| `/users/:id` DELETE | `admin:users` AND not-self AND not-last-admin |
| `/users/:id/settings` GET, PUT, DELETE | `admin:any-user-setting` OR self (allowlist enforced) |
| `/share-link/*` create | `edit:movie` |
| `/share-link/*` verify (handshake) | `view:public` |
| `/auth/login`, `/auth/setup`, `/auth/me`, `/auth/logout` | `view:public` (own session) |

---

## 7. Users CRUD

### 7.1 API

```
GET    /users                         → [User minus passwordHash]      requires admin:users
POST   /users         { username, password, email?, role }            requires admin:users
GET    /users/:id                     → User                           requires admin:users | self
PATCH  /users/:id     { username?, email?, avatar?, password? }       self (cannot change role)
PATCH  /users/:id     { role }                                        requires admin:users
DELETE /users/:id                                                     requires admin:users + guard
                                                                       (not-self AND not-last-admin)
GET    /users/:id/settings                                            self | admin:any-user-setting
PUT    /users/:id/settings/:key                                       self (if allowlisted)
                                                                      | admin:any-user-setting
DELETE /users/:id/settings/:key                                       same
```

### 7.2 Password handling

bcrypt rounds = 10 (existing convention from `auth.service.ts`). Password is required on POST. PATCH password is optional. The User shape exposed to the client never includes `passwordHash`.

### 7.3 Default settings on user creation

Per the user's instruction: prefer **lazy fallback** over eager clone. New users start with zero rows in `user_settings`; reads fall back to app defaults via §4.2. First time the user customizes a key, the row is written. This avoids:
- Drift when defaults change (existing users would keep old cloned values).
- Bloat (one row per user × per key with no value).
- Eager-clone race conditions during setup.

If a future migration needs cloned defaults (e.g., per-user theme that respects a system default), that's a one-off seed-on-create, not a general policy.

### 7.4 Last-admin protection

`DELETE /users/:id` and `PATCH /users/:id` (when role changes from `admin` to anything else) must check that **at least one admin will remain** afterwards. Otherwise throws `409 Conflict — "cannot remove the last admin"`. Same check on `setup()` re-runs.

---

## 8. Client changes

### 8.1 Auth context

`useAuth()` already exists and exposes `currentUser`. Extend with:

```ts
const {
  user,                       // existing
  isAdmin,                    // existing
  isContributor,              // new
  isViewer,                   // new
  can(action: Action),        // mirrors PermissionsService.can
  isSelf(userId: string),     // helper
} = useAuth();
```

`can()` consults a static role-action table mirrored from shared types (single source of truth in `@mu/shared/permissions`).

### 8.2 Settings page gating

`Settings.tsx` tab list becomes role-derived:

```
Always visible: General, Playback, Appearance, Notifications, About
Admin only:     Library, Encoding (read-only), Matching, Sources,
                Plugins, Jobs, Server, Admin, Users (NEW)
Contributor:    sees admin-only tabs as **read-only**
                (gates inputs with `disabled` + tooltip)
Viewer:         admin-only tabs hidden entirely
```

Each tab component reads its own readonly flag:

```ts
const readonly = !can('edit:app-settings');
<input disabled={readonly} ... />
```

The **Encoding** subsection on the Playback tab is admin-only read-only too (per your direction: "leave the encoding read only, as system settings, and show it only for admins"). For contributors and viewers it's hidden.

### 8.3 Settings reads — single endpoint

Client switches to a single boot-time read:

```
GET /settings/me  → { ...mergedSettings }
```

This replaces the current scatter of `/settings/playback`, individual key fetches, etc. The aggregate endpoint returns:
- All app settings (admin sees raw; contributor + viewer see only the keys they need — playback, watch tracking, appearance, notifications, general).
- All user overrides applied.

A `settings.state.ts` signal store holds this and exposes `useSetting(key)`. Writes go to `PUT /settings/me/:key` and optimistically update the signal.

### 8.4 New Users admin page

`src/packages/client/src/pages/settings/Users.tsx` — lists users in a table (username, email, role, created, last-login if available). Actions:

- **Add user** modal: username, password, optional email, role select.
- **Edit user** row: change role (admin only, with confirmation when promoting to admin or demoting last admin), reset password (admin sets new password), delete (with "are you sure" + last-admin block).
- **Edit user's overrides** (admin-only): drawer that shows the user's `user_settings` rows and lets admin add/remove keys for support purposes.

Wired into `Settings.tsx` as a new tab between `admin` and `connections`.

### 8.5 Routes

No new client routes. The Settings page already handles sub-pages by tab. Direct deep-link via `/settings/users` works through the existing tab-routing.

---

## 9. Migration plan

### Phase 0 — Security hot-fix (lands first, can ship alone)

1. Add `@RequireAdmin()` to `PATCH /users/:id` and `DELETE /users/:id` (existing methods).
2. Reject any `role` field in `PATCH` body when actor !== admin.
3. Add `@RequireAdmin()` to `GET /users` and `GET /users/:id`.
4. Tests covering: self-promote attempt → 403; admin updates role → 200; viewer reads someone else's profile → 403.

Goes to prod before any of the larger refactor.

### Phase 1 — Schema + permission primitives

1. Migration `025_user_settings.sql` — create `user_settings` table.
2. Migration `026_role_rename.sql` — rename `users.role = 'user'` → `'viewer'`. Backfill: any future seed should use new values.
3. Update `UserRole` shared type → `'admin' | 'contributor' | 'viewer'`.
4. Add `PermissionsService`, `Action` type, `USER_SETTING_KEYS`, `AuthCache`.
5. Add `@RequireAction()` decorator + `RequireActionGuard`. Wire into `app.module.ts` as global guard *after* `JwtAuthGuard` + `RolesGuard`.
6. Keep `@Roles('admin')` working (aliased) so the existing surface doesn't break.

### Phase 2 — Settings refactor

1. Extend `SettingsService` with `getForUser`, `setForUser`, `getAllForUser`, `UserSettingsCache`.
2. New controller `UserSettingsController` mounted at `/settings/me` + `/users/:id/settings`.
3. Update client `settings.state.ts` to use `GET /settings/me`.
4. Client `useSetting(key)` hook backed by signals.
5. App-settings writes invalidate the per-user cache.

### Phase 3 — Endpoint audit + decoration

1. Generate the full endpoint table (see §6) as a checklist in the plan.
2. Apply `@RequireAction(...)` to every controller method.
3. Remove all direct `request.user.role` checks in services; route them through `PermissionsService`.
4. Land in batches by module: `users`, `movies`, `settings`, `library`, `admin`, `jobs`, `plugins`, `imdb-datasets`, etc.

### Phase 4 — localBypass + auth cache

1. Replace localhost-first-admin lookup with the setup-only bypass (§5.1).
2. Add `AuthCache`; wire `JwtAuthGuard` to it.
3. Add cache-invalidation calls in every user-mutation path.

### Phase 5 — Client UI

1. Extend `useAuth()` with `can()` and role-helpers.
2. Re-gate `Settings.tsx` tabs by role.
3. Add read-only treatment to admin tabs for contributor.
4. Build `Users.tsx` admin page + add to tab list.
5. Build "Edit user's overrides" drawer.

### Phase 6 — Hardening + docs

1. Tests for every action × role combo (table-driven).
2. Update `CLAUDE.md` permissions section.
3. Doc: short `docs/users-and-permissions.md` describing the role model and how to add a new action.
4. Verify deploy via `bash src/scripts/deploy-remote.sh`.

Each phase is independently shippable. Phase 0 ships immediately. Phases 1–6 can stack into a single release or roll out one phase per deploy.

---

## 10. Risks

- **Existing `@Roles('admin')` callers** — 35+ endpoints already use this. Keeping it as an alias means no immediate cascade, but the old decorator stays around longer than ideal. Mitigation: explicit Phase 3 sweep that converts every `@Roles` to `@RequireAction`, then deletes the alias.
- **Client signal cache staleness** — when admin edits app settings, all clients' user caches must invalidate. Easiest: bump a `settings.version` value on app-settings write; client polls or re-reads on focus.
- **`auth.localBypass` users currently rely on it for dev convenience** — making it setup-only means dev must `pnpm db:seed` or run setup once. Acceptable; documented in CLAUDE.md.
- **Last-admin protection edge cases** — concurrent deletes by two admins could race past the check. Mitigation: wrap the check + delete in a `BEGIN IMMEDIATE` transaction.
- **Share-token role collision** — verified safe: share users will fail every action except `view:shared-movie`. Tests included.

---

## 11. Success criteria

- `grep -r 'request.user.role' packages/server/src` returns matches only in `permissions.service.ts` and `jwt-auth.guard.ts`.
- Every `@*Controller()` method has either `@RequireAction(...)` or `@Public()`. CI guard added.
- New viewer account can log in, view library, edit their playback prefs, and gets 403 on every admin endpoint (table-driven test).
- Admin can create, list, role-change, password-reset, and delete users — with last-admin protection.
- Settings UI tabs render the right subset for each role, with contributor seeing admin-only tabs as read-only.
- Hot-fix lands in prod within hours of the design being approved; full refactor lands in subsequent phases.

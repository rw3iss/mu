# Users & Permissions

Mu supports multiple users with three roles, plus per-user setting
overrides on top of app-wide defaults.

## Roles

| Role | What they can do |
|---|---|
| `admin` | Everything. Manages users, app settings, library, plugins, jobs. |
| `contributor` | View + search the library, play media, edit movies (metadata, posters, matches). Cannot touch app settings, library config, plugins, or other users. |
| `viewer` | View + search + play. Edits only their own user settings (autoplay, theme, audio language, …). |

A fourth synthetic role, `share`, is attached at request time when a
share-link token is presented. It's never stored in the database and
only grants `view:shared-movie` for the single movie the token covers.

## Permission actions

Controllers declare a required **action** rather than a role. The
role→action map lives in `@mu/shared/permissions/actions.ts` and is
mirrored on both server and client (so the client can hide tabs +
buttons the user can't reach).

| Action | admin | contributor | viewer | share |
|---|---|---|---|---|
| `view:public` | ✓ | ✓ | ✓ | ✓ |
| `view:library` | ✓ | ✓ | ✓ | — |
| `view:own-data` | ✓ | ✓ | ✓ | — |
| `view:shared-movie` | ✓ | ✓ | ✓ | scoped |
| `view:app-settings` | ✓ | read-only | — | — |
| `edit:own-settings` | ✓ | ✓ | ✓ | — |
| `edit:movie` | ✓ | ✓ | — | — |
| `delete:movie` | ✓ | ✓ | — | — |
| `edit:app-settings` | ✓ | — | — | — |
| `admin:users` | ✓ | — | — | — |
| `admin:server` | ✓ | — | — | — |
| `admin:plugins` | ✓ | — | — | — |
| `admin:datasets` | ✓ | — | — | — |
| `admin:any-user-setting` | ✓ | — | — | — |

## Decorating a new endpoint

Every controller method **must** carry exactly one of:

- `@RequireAction('<action>')` — gated by role
- `@Public()` — unauthenticated routes (health, setup, login, share handshake)

The global `RequireActionGuard` reads the metadata after `JwtAuthGuard`
and rejects the request with `403 Forbidden` if the role lacks the action.

The legacy `@Roles('admin')` decorator is still functional (back-compat
during the rollout) but new code should use `@RequireAction(...)`.

Example:

```ts
@Post('refresh-all')
@RequireAction('edit:app-settings')
async refreshAll() { … }

@Get(':id')
@RequireAction('view:library')
findOne(@Param('id') id: string) { … }
```

## Settings: app vs. user

Two tables back the settings system:

- `settings` — app-wide. PK `key`. Read by every user, writable only
  by admin.
- `user_settings` — per-user overrides. PK `(user_id, key)`. Lazily
  written when a user customizes a key; reads fall back to the
  `settings` row, then to the in-code default.

Allowlist of permissible user-setting keys lives in
`@mu/shared/permissions/user-settings-keys.ts`. Writes to a key not
on the allowlist via the user endpoint return `400 Bad Request`.
Admins can override any key on any user via
`PUT /users/:id/settings/:key` (skips allowlist).

### Client read path

The client fetches once on boot:

```
GET /settings/me  →  { mergedKey: value, … }
```

Components read with the typed hook:

```ts
const [autoplay, setAutoplay] = useSetting('playback.autoplay', true);
```

Writes go through `setMine(key, value)` which optimistically updates the
signal and persists via `PUT /settings/me/:key`.

## localBypass — setup-only

`auth.localBypass` (default `true`) lets a localhost request through
without a JWT **only when zero users exist** — for the initial
`/auth/setup` flow. Once any user exists in the `users` table, the
bypass is permanently disabled; every request must present a valid
JWT cookie.

To rotate this behaviour you must `pnpm db:reset` the database (or
manually drop all user rows). The guard caches the "setup complete"
flag in memory so the first DB hit per process lifetime decides the
behaviour for the rest of the run.

## Caches

Two in-memory caches sit on the hot auth path
(`src/packages/server/src/common/permissions/auth-cache.service.ts`):

- **Token cache**: verified JWT payloads, 60s TTL. Saves the
  `jwt.verify()` work on each subsequent request from the same client.
- **User cache**: `users` row by id, 5min TTL. Used when guards or
  services need to confirm a role hasn't changed under them.

Invalidation:

- `UsersService.update / delete` → `invalidateUser(id)`.
- `AuthService.setup()` → `invalidateAllUsers()` (also flips the
  setup-complete flag).
- App-settings writes → `SettingsService.userCache.invalidateAll()`
  (because every user's fallback view depends on the app values).

## Last-admin protection

Both `DELETE /users/:id` and `PATCH /users/:id` (when the role moves
from `admin` to anything else) check that at least one admin remains
after the change. The check is wrapped in the same SQLite transaction
so two simultaneous admin demotes can't race past it. Violations
return `409 Conflict`.

## Users admin page

`/settings/users` (admin tab) lists every user with controls for:

- **Add user** modal (username, password, optional email, role).
- **Role selector** per row — confirms when demoting an admin.
- **Reset password** modal.
- **Delete** — guarded by the last-admin rule + can't delete self.

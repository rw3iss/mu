# Shared Sessions — Implementation Plan

**Status:** Draft for approval · **Date:** 2026-08-03 · **Author:** Claude (with Ryan)

A "watch party" feature: any member can invite other members into their current
movie, sync playback across everyone, chat over WebSocket, and talk over voice
(WebRTC). One member is the **session admin** with a settings panel controlling
who can do what.

---

## 1. Design summary & refinements

**Core mental model.** A Shared Session is *not* a shared video stream. Each
member plays **their own** stream of the **same `movieId`** (their own
transcode/direct-play, their own buffer). The session only synchronises a
**logical playhead** (play/pause/seek/position) plus **chat** and **voice**.
This is the only workable model given per-user transcoding and is how every
watch-party product works (Teleparty, Discord Watch Together, etc.).

**Three independent planes:**

| Plane | Transport | Why |
|---|---|---|
| **Control/Sync** (play, pause, seek, position heartbeat, presence) | existing **WebSocket** (`session:<id>` channel) | tiny JSON, already realtime, already channel/room-capable |
| **Chat** | existing **WebSocket** (same channel) | tiny JSON messages |
| **Voice** | **WebRTC mesh** (Opus/SRTP over UDP), **signalled** over the WebSocket | real-time media needs UDP + jitter buffers + Opus; sockets relaying PCM would lag. Mesh is ideal for ≤~6 people; voice-only is light. |

**Key refinements / gaps I'm filling:**

1. **WebSocket authentication is currently absent** — `EventsGateway.handleConnection` ignores the `?token=`, and routing is by self-declared channel. Any socket can subscribe to `user:<anyone>` or relay into any `session:<id>`. **This feature makes WS auth a prerequisite** (see §6). Without it, anyone could hijack a party's controls or inject voice/chat.
2. **Session persistence.** Sessions are ephemeral but I'll persist a light record (`shared_sessions` + `shared_session_members`) so a member who **refreshes** rehydrates their membership and rejoins the room + re-negotiates voice, and so late invitees can accept from the bell later. Ended sessions are marked closed.
3. **Sync algorithm** must tolerate each member buffering independently — command-based (play/pause/seek) + a periodic **position heartbeat** from the controller that others use for **soft drift correction** (small seek or brief `playbackRate` nudge), not hard re-seeks. Details in §10.
4. **Notification placement.** The existing transient toasts are **top-right**; the brief wants **top-center slide-down**. I'll add a top-center toast variant for session events (invites + "X paused") while reusing the same signal store.
5. **Voice = a second audio engine.** The existing `AudioEngine` is a `<video>`-bound singleton. I'll refactor it to inject **source** + **sink**, then spin up a `MicAudioEngine` (source = `getUserMedia`, sink = `MediaStreamAudioDestinationNode` → WebRTC track) that reuses the entire EQ/Comp/analyser/auto machinery. `audioEngine.createRecordingAudioTrack()` already proves the processed-graph-→-track path works.

**Additional session settings I propose** (beyond the three requested):
- **Allow seeking** (part of the "control" permission; separate toggle so admin can allow play/pause but not scrubbing).
- **Allow members to invite others** (default off — admin-only invites).
- **Voice mode**: *Open mic* (default) vs *Push-to-talk*.
- **Session name** (optional label shown in menus/invites).
- **Max members** (default e.g. 8; guards mesh scaling).
- **On admin disconnect**: *auto-promote longest-connected member* (default) vs *end session*.

---

## 2. Plugin vs. core — verdict: **core feature**

I assessed the plugin system (`packages/server/src/plugins`, `packages/client/src/plugins`). A plugin gets:

| Plugin capability | Present? | Shared Sessions needs |
|---|---|---|
| Client UI slots (`PLAYER_BUTTON`, `INFO_PANEL`, page slots) | ✅ render-injection only | a toolbar button (OK) **but also** panels, play/pause interception, video-load control — ❌ not slot-expressible |
| Server REST endpoint | ⚠️ sandboxed `/plugins/:id/api/*`, handler is `(query,body,params)→unknown`, **no NestJS DI** | needs DI to reach `NotificationsService`, `ProfileService`, gateway, DB |
| WS gateway access (`@SubscribeMessage`, relay to channels) | ❌ plugin `events` is an **internal bus**, not the client WS | ❌ core to the whole feature |
| Relational DB tables + migrations | ❌ only a KV `cache` | ❌ needs `shared_sessions` tables |
| Player play/pause interception, disable button | ❌ | ❌ |
| Notifications / permissions integration | ❌ | ❌ |
| Web Audio / WebRTC | ⚠️ possible in client bundle but no host hooks | needs deep player integration |

**Conclusion:** Building this as a plugin would require adding ~6 major new
plugin extension points (WS handlers, DB schema, DI service access, player-control
hooks, notification API, media hooks) — more work than a core module, and it
would defeat the plugin sandbox. **Build as a core `shared-sessions` module.**
(Future: once built, a *thin* plugin could expose a "Start party" button via the
`PLAYER_BUTTON` slot that calls the core API — but the engine belongs in core.)

---

## 3. Architecture overview

```
                         ┌────────────────────────────────────────────┐
                         │              Mu server (NestJS)             │
                         │                                            │
   REST (create/invite/  │   SharedSessionsController ──┐             │
   join/leave/end/settings)──────────────────────────► │             │
                         │   SharedSessionsService  ◄───┘             │
                         │     • session + member state (DB + memory) │
                         │     • NotificationsService (invites)       │
                         │     • authorises WS relays                 │
                         │                                            │
   WS  session:<id>      │   EventsGateway (extended)                 │
   • sync commands  ◄───►│     • auth on connect (NEW)               │
   • chat           ◄───►│     • room join/leave                     │
   • WebRTC signaling◄──►│     • relay-to-room (authorised)          │
                         └────────────────────────────────────────────┘
        ▲   ▲   ▲                                   
        │   │   │  WebSocket (control+chat+signaling)                 
   ┌────┴─┐ │ ┌─┴────┐                                                
   │Member│ │ │Member│   Voice: WebRTC MESH (peer↔peer, Opus/UDP)     
   │  A   │◄──►│  B  │◄──── each mic → EQ/Comp graph → processed track 
   └──────┘   └──────┘      STUN + self-hosted coTURN for NAT         
```

- **Control/chat/signaling:** all over the one WS `session:<id>` channel.
- **Voice media:** peer-to-peer WebRTC, never touches the app server (only the
  TURN relay when NAT requires it).

---

## 4. Data model (server DB)

Two new Drizzle tables (schema files + `migrate.js` `CREATE TABLE IF NOT EXISTS`).
Sessions are light + reapable; membership + roles + settings live here so reloads
rehydrate.

**`shared_sessions`**
| col | type | notes |
|---|---|---|
| `id` | text PK (uuid) | session id (also the WS `session:<id>` room + `/session/:id` route) |
| `movie_id` | text FK→movies | the shared movie |
| `admin_user_id` | text FK→users | current session admin |
| `name` | text nullable | optional label |
| `settings` | text (JSON) | `SharedSessionSettings` (see §6) |
| `status` | text | `active` \| `ended` |
| `created_at` / `updated_at` / `ended_at` | text | |

**`shared_session_members`**
| col | type | notes |
|---|---|---|
| `id` | text PK | |
| `session_id` | text FK→shared_sessions (cascade) | |
| `user_id` | text FK→users | |
| `role` | text | `admin` \| `member` |
| `state` | text | `invited` \| `joined` \| `left` |
| `invited_by` | text nullable | |
| `joined_at` / `left_at` | text nullable | |

**`shared_session_messages`** (Q6 — chat persists for the life of the session)
| col | type | notes |
|---|---|---|
| `id` | text PK | |
| `session_id` | text FK→shared_sessions (cascade) | |
| `user_id` | text FK→users | author |
| `text` | text | |
| `created_at` | text | |

Chat is relayed live over WS **and** persisted here, so late joiners / reloaders
`GET /shared-sessions/:id/messages` to backfill history. Rows are removed when the
admin **ends** the session (cascade on session delete / a cleanup on `status='ended'`).

In-memory in the gateway/service: which sockets are in which room, presence,
voice-mute states, speaking indicators — transient, not DB.

---

## 5. Shared types (`@mu/shared`)

- **`WsEvent`** additions (`enums/index.ts`):
  ```
  SHARED_SESSION_JOINED   = 'session:joined'     // presence: a member joined
  SHARED_SESSION_LEFT     = 'session:left'
  SHARED_SESSION_COMMAND  = 'session:command'    // play|pause|seek|heartbeat
  SHARED_SESSION_CHAT     = 'session:chat'
  SHARED_SESSION_SIGNAL   = 'session:signal'     // WebRTC offer|answer|ice
  SHARED_SESSION_SETTINGS = 'session:settings'   // settings changed
  SHARED_SESSION_ADMIN    = 'session:admin'      // admin transferred
  SHARED_SESSION_ENDED    = 'session:ended'
  SHARED_SESSION_PRESENCE = 'session:presence'   // roster + voice/mute state
  ```
- **`NotificationType.SharedSessionInvite = 'shared-session-invite'`** +
  payload interface (`notification.ts`): `{ sessionId, hostUserId, hostName, movieId, movieTitle }`.
- **DTOs / types** (new `types/shared-session.ts`): `SharedSessionSettings`,
  `SharedSessionView` (session + roster + my role), `SharedSessionMemberView`,
  `SessionCommand` (`{kind:'play'|'pause'|'seek'|'heartbeat', positionSeconds, at, byUserId, byName}`),
  `ChatMessage` (`{id, userId, name, text, at}`), `SignalMessage`.

---

## 6. Server design

### 6.1 New module `shared-sessions`
`packages/server/src/shared-sessions/` — `shared-sessions.module.ts`,
`.controller.ts`, `.service.ts`, schema files. Registered in `AppModule`.
Injects `DatabaseService`, `NotificationsService`, `ProfileService` (member
lookups), `EventsService`/gateway, `PermissionsService`.

**REST endpoints** (all `@RequireAction('view:library')` = any member who can
watch; admin-only ones additionally check `session.admin_user_id === user.id`):
- `POST /shared-sessions` `{movieId, name?}` → create (caller becomes admin), returns `SharedSessionView`.
- `POST /shared-sessions/:id/invite` `{userIds:[]}` → admin (or members if allowed) invites; creates a `SharedSessionInvite` notification per invitee + an `invited` member row.
- `POST /shared-sessions/:id/join` → invitee accepts (invited→joined); returns view + STUN/TURN config.
- `POST /shared-sessions/:id/leave` `{newAdminUserId?}` → leave; if admin leaving, `newAdminUserId` required (transfer) unless last member (→ ends).
- `POST /shared-sessions/:id/transfer-admin` `{userId}` → admin only.
- `POST /shared-sessions/:id/end` → admin only; marks ended, emits `SHARED_SESSION_ENDED` to room, deletes notifications.
- `PATCH /shared-sessions/:id/settings` `{settings}` → admin only; emits `SHARED_SESSION_SETTINGS`.
- `GET /shared-sessions/mine` → the caller's active session (for reload rehydrate).
- `GET /shared-sessions/:id` → view (member-only).
- `GET /shared-sessions/ice-config` → `{ iceServers: [...] }` (STUN + short-lived TURN creds).

**Authorisation of WS relays.** The gateway must ask the service "is user U a
joined member of session S, and are they allowed to send command C?" before
relaying. The service exposes a fast in-memory check (`canRelay(userId,
sessionId, command)`), enforcing the "only admin can play/pause" setting
server-side (defence in depth — the client also disables the button).

### 6.2 `SharedSessionSettings`
```ts
interface SharedSessionSettings {
  allowMembersControl: boolean;   // play/pause — default true
  allowSeeking: boolean;          // default = allowMembersControl
  enableChat: boolean;            // default true (channel still open for sync)
  enableVoice: boolean;           // default true
  allowMemberInvites: boolean;    // default false
  voiceMode: 'open' | 'ptt';      // default 'open'
  onAdminDisconnect: 'promote' | 'end'; // default 'promote'
  maxMembers: number;             // default 8

  // ── Sync / catch-up (admin-tunable — see §10) ──
  syncMode: 'soft' | 'hard' | 'wait-for-all'; // drift handling — default 'soft'
  prebufferSeconds: number;       // buffer this much before playback (re)starts on
                                  //   join / play / seek, so members can catch up — default 5
  driftThresholdSeconds: number;  // soft-correct above this; hard-seek far past — default 1

  // ── Voice UX ──
  showSpeakingIndicator: boolean; // bottom "X is talking" popup — default true
}
```
Note: two things are deliberately **per-user client settings, not session settings**:
- **mute-on-join** — chosen in the accept modal (§7.3).
- **duck-movie-on-speech** (Q-C) — a `mu_voice_duck` local UI setting (default off) that
  lowers *only that user's own* movie volume while any peer is talking. Stored via
  `useUiSetting`, surfaced in the Voice config panel; never affects other members.

### 6.3 WebSocket gateway extensions — **authentication built in properly** (Q1)
The gateway will do real auth, enforced (not fail-open). Design:
- **Verify on connect** *(built, Phase 1)*: `handleConnection(client, request)` reads
  the JWT from the `?token=` query (already sent by the client) **or** the
  `mu_access_token` cookie and verifies it (HS256 against `auth.jwtSecret`) in a new
  `WsAuthService` (Node `crypto`, no extra dep). On success it stores `userId`+`role`
  on `ClientMeta`.
- **Channel-gating, not hard-close** *(refinement)*: rather than dropping
  unauthenticated sockets on connect (which would regress anonymous consumers such as
  the public `/watch` share pages that only ever receive *public* broadcasts), the
  enforcement is at `subscribe`: a socket may join `user:<id>` **only** if it equals
  its own verified id, and `session:<id>` **only** if authenticated (per-command
  membership enforced by the Phase-2 relay handlers). Public channels stay open. This
  closes the impersonation/hijack hole with zero regression risk to existing sockets.
- **Ops escape hatch:** `MU_WS_AUTH_ENFORCE` (default **on**) disables the gating for a
  one-release rollback if anything unexpected breaks; not a design compromise.
- **Client reconnect:** `websocket.service.ts` already appends `?token=`; a Phase-2
  task adds clean re-auth on token refresh.
- **New inbound handlers:**
  - `@SubscribeMessage(SHARED_SESSION_COMMAND)` → validate membership + control
    permission → `broadcastToChannel('session:<id>', ...)` (excluding sender).
  - `@SubscribeMessage(SHARED_SESSION_CHAT)` → validate + relay (gated by `enableChat`).
  - `@SubscribeMessage(SHARED_SESSION_SIGNAL)` → relay WebRTC offer/answer/ICE to
    the **specific** `user:<peerId>` channel (targeted, not broadcast).
- Server-originated events (invite pushed via `NotificationsService.create`,
  `SHARED_SESSION_ENDED`, `SETTINGS`, `ADMIN`, `PRESENCE`) go out via the
  existing `EventsService` → `deliverNotification`/`broadcastToChannel` path.

### 6.4 Voice infra: **self-hosted coTURN on the Fedora box** (Q2)
Everything stays on the prod box. The wrinkle is that the box routes **all**
outbound through the Mullvad WireGuard full-tunnel (kill-switch) — TURN must
**bypass the VPN** so (a) remote peers reach it on the box's real public IP and
(b) its relayed replies don't get shoved out the tunnel (wrong exit IP → dropped).

**Design — treat TURN exactly like the app's inbound path (which already works):**
- Install `coturn` (`scripts/coturn-setup.sh`, systemd unit, idempotent). Listen on
  `3478/udp`+`3478/tcp` (STUN/TURN), `5349/tcp` (TURNS/TLS), and a bounded **relay
  port range** (e.g. `49160–49200/udp`, ~40 ports → caps concurrent relays; enough
  for small parties).
- **coturn config:** `listening-ip=<LAN ip>`, **`external-ip=<public IP>`** (so the
  advertised relay candidate is the real public IP, not the VPN exit),
  `use-auth-secret` + `static-auth-secret=<turn.secret>`, `realm`, TLS cert (reuse
  the nginx/Let's Encrypt cert), `no-cli`, `min/max-port` = the relay range.
- **VPN bypass (the key part):** reuse the existing inbound-reachability mechanism —
  the box already has an NM dispatcher policy-routing table (200 → LAN gateway) + the
  wg conf's connmark PostUp rules that mark inbound flows so their replies skip the
  tunnel and go back out the LAN gateway. Extend that so **coturn's listener + relay
  ports are conntrack-marked the same way** (a couple more `iptables -t mangle`
  CONNMARK rules for `udp --dport 3478 / 5349 / 49160:49200` and the relay egress).
  This is the same fix documented for the app's 80/443/4000 reachability — TURN just
  adds its ports to it. Document it in the coturn setup script + CLAUDE.md.
- **Router:** forward `3478` (udp+tcp), `5349` (tcp), and the relay UDP range to the
  box. (Open question §14 flags the "how many UDP ports can the router forward / does
  the ISP allow it" risk.)
- `GET /shared-sessions/ice-config` returns STUN (our coturn + public Google/Cloudflare
  as free fallback) and **short-lived HMAC TURN credentials** (coturn `use-auth-secret`
  time-limited creds — never ship static TURN passwords to the client).
- Config keys (`config.yml`): `turn.enabled`, `turn.publicHost`, `turn.secret`,
  `turn.realm`, `turn.relayPortRange`, optional extra STUN URLs.
- **Fallback:** if TURN is unreachable, voice still works for same-LAN and
  friendly-NAT peers (STUN/host candidates); the client surfaces "voice couldn't
  connect to <peer>" rather than failing the whole session.

---

## 7. Client design

### 7.1 State — `state/shared-session.state.ts` (signals)
`activeSession` (`SharedSessionView | null`), `isSessionAdmin` (computed),
`sessionMembers`, `sessionSettings`, `myVoiceMuted`, `allVoicesMuted`,
`peerVoiceStates` (per-peer connected/speaking/muted), `chatMessages`,
`chatUnread`, `showSessionPanel`, `showSessionSettingsPanel`, `showVoicePanel`,
`showChatWindow`, plus `pendingInvite` (for the accept flow). Toggle helpers
mirror `audio-effects.state.ts`'s `showEffectsPanel` pattern.

### 7.2 Service — `services/shared-session.service.ts`
REST wrappers + all WS wiring: on join, `wsService.subscribe('session:<id>')`
and register `on(SHARED_SESSION_COMMAND/CHAT/SIGNAL/PRESENCE/ENDED/SETTINGS/ADMIN)`
handlers. Exposes `sendCommand`, `sendChat`, `sendSignal`. Owns the **sync
engine** and the **WebRTC mesh manager** (below).

### 7.3 UI integration (all seams mapped in the player audit)
- **"Start Shared Session"** entry:
  - Player cog menu (`PlayerControls.tsx` settings `main` block) — a `menuRow`
    (template: the existing "Record Snippet" row). Shown only when a movie is
    loaded and the user has **no active session**.
  - **Movie options menu** (`MovieOptionsMenu.tsx`) — a "Start Shared Session"
    item alongside "Mark as Watched". If a session already exists → error toast
    ("End your current session first"). Else → `playMovie(movieId)` **paused**
    (set `forceStartPosition`, then pause via engine) → open invite modal.
- **"Session" toolbar button** — new `controlBtn` to the **left of Info** in
  `rightControls` (copy the Effects button). Visible only when in a session.
  Shows a **chat-unread badge** (count) overlay. Also add to the mobile-overflow menu.
- **Session menu** (dropdown from the Session button): `Invite to Session`
  (admin/allowed), `Chat` (if enabled), `Voice Audio ▸` submenu (if voice
  enabled), `Settings` (admin only), `Leave Shared Session` (all), `End Shared
  Session` (admin only).
- **Panels** (slide-in, self-gating like `EffectsPanel.tsx`, mounted next to it
  in `GlobalPlayer.tsx`, added to the outside-click list):
  - `SessionSettingsPanel.tsx` — the settings toggles (admin only).
  - `VoiceAudioPanel.tsx` — mic device picker, volume, and **EQ + Compressor +
    auto + visualizers** for the mic input (see §11).
- **Modals** (reuse `Modal.tsx`/`ConfirmDialog.tsx`):
  - `InviteMembersModal.tsx` — lists members via the **invite-members endpoint**
    (§12, works regardless of the Show-Users-Info switch), row-click + checkbox
    multi-select, excludes already-invited/joined; "Send invites".
  - **Accept/Join modal** (Q9) — Zoom-style: shows the host + movie, a **"Join with
    mic on/off"** toggle (default **on**), and (if voice) a device picker preview;
    Join → §8 flow. Reachable from the bell notification and the flydown.
  - Leave-as-admin modal — pick the new admin from the roster, confirm.
  - End-session confirm modal.
- **Chat window** `SessionChatWindow.tsx` — portal (like `Modal`) + the split-panel
  drag math (`GlobalPlayer.tsx:857`) for **draggable / resizable / dockable**
  (top/right/bottom/left/floating). Backfills history from
  `GET /shared-sessions/:id/messages` on open (Q6 — persisted for the session).
  Close icon hides it (socket keeps receiving → unread badge grows). Docked-mode
  video resizing is explicitly **deferred**.
- **Speaking indicator** (Q10) — a small bottom-of-screen popup ("🎙 Alex is
  talking", including *you*), driven by per-peer voice-activity (WebRTC audio-level
  / an `AnalyserNode` threshold). Shown only while voice is active; **toggle in the
  Session Settings panel** (`showSpeakingIndicator`). The Voice config panel and
  chat roster also show inline speaking/mute dots.

### 7.4 Play/pause interception + admin gating
At the `GlobalPlayer.tsx` prop boundary (the one place the audit identified),
**wrap** `engine.togglePlay`/`engine.seek`:
```
onTogglePlay = () => {
  if (activeSession && !canControl()) return;          // gated
  sharedSession.sendCommand(isPlaying ? 'pause' : 'play', currentTime);
  engine.togglePlay();
};
onSeek = (t) => { if (canControl()) sharedSession.sendCommand('seek', t); engine.seek(t); };
```
`canControl()` = not in a session, or admin, or `allowMembersControl`. When
gated, pass `playbackLocked` to `PlayerControls` to **disable** the play/skip
buttons for non-admins. Remote commands call `engine.togglePlay/seek/
setIntendedPlaying` directly (a `applyingRemote` guard prevents echo).

### 7.5 Sync engine (in the service)
See §10.

### 7.6 Voice: mic engine + mesh (see §11).

### 7.7 Invite notifications
- **Persistent** (bell): server `NotificationsService.create(SharedSessionInvite,
  {...}, invitedUserId)` — renders in the bell panel via a new
  `notification-format.ts` case with an **Accept/Join** action linking to the
  join flow (loads the session movie + joins the room).
- **Transient centered flydown**: a new **top-center** toast variant fires on
  invite receipt and for session events ("Alex paused the movie", "Sam joined").
  Reuses the `notifications.state` signal store + `Toast` component with a
  position/animation variant. "Paused/joined" toasts are **not** persisted.

---

## 8. End-to-end flows

1. **Start (from player):** cog → Start Shared Session → `POST /shared-sessions`
   → become admin → InviteMembersModal → send invites.
2. **Start (from movie menu):** menu item → (no existing session) → load movie
   paused into player → InviteMembersModal.
3. **Invite received:** persistent bell notification **and** top-center flydown
   with Accept. Accept → `POST /:id/join` → unload current movie → `playMovie(sessionMovieId)`
   → subscribe `session:<id>` → request current position (server/admin heartbeat)
   → seek + match play state → connect voice (if enabled).
4. **Sync play/pause/seek:** controller taps button → local apply + broadcast
   command → peers apply (guarded) → everyone sees the transient "X paused".
5. **Chat:** type → `sendChat` → relay → all panels append; unread badge if window closed.
6. **Voice:** on join, mesh-negotiate with each existing member (offer/answer/ICE
   over `SHARED_SESSION_SIGNAL`); mic → EQ/Comp graph → track → `addTrack`.
7. **Leave (member):** confirm → `POST /:id/leave` → teardown peers + WS unsub.
8. **Leave (admin):** modal picks new admin → transfer → then leave.
9. **End (admin):** confirm → `POST /:id/end` → `SHARED_SESSION_ENDED` to all →
   everyone's session UI tears down (movie keeps playing solo).
10. **Reload:** on app load, `GET /shared-sessions/mine` → if active, rehydrate
    (rejoin room, re-load movie at heartbeat position, re-negotiate voice).

---

## 9. Session settings panel (admin)
Toggles from §6.2, live-applied via `PATCH …/settings` → `SHARED_SESSION_SETTINGS`
broadcast → all clients update (e.g. non-admins' play button disables the moment
`allowMembersControl` flips off). Chat-disabled still keeps the WS channel open
for sync/commands (per the brief).

---

## 10. Sync algorithm (details)

- **Commands** carry `{kind, positionSeconds, at: serverOrClientClock, byUserId}`.
  Play/pause/seek are authoritative events applied immediately by receivers
  (with an `applyingRemote` echo-guard).
- **Position heartbeat:** the *controller* (admin, or last actor) emits a
  `heartbeat` every ~3 s with its `positionSeconds` + `playing`. Receivers compute
  drift = `theirPos − (heartbeatPos + elapsedSinceHeartbeat)`.
- **`syncMode` (admin-tunable, Q5)** governs how drift is handled:
  - **`soft`** (default): drift < `driftThresholdSeconds` (default 1 s) → ignore;
    1–3× threshold → **`playbackRate` nudge** (0.95–1.05) until closed (no audible
    jump); far past → **hard seek**. Best-effort, never blocks anyone.
  - **`hard`**: any drift over the threshold → immediate hard seek to target
    (tightest sync, occasional small skips).
  - **`wait-for-all`**: the controller auto-pauses the whole party whenever **any**
    member reports `buffering`/`behind`, and resumes when everyone's ready. Tightest
    togetherness, but one slow member pauses everyone.
- **Pre-buffer / catch-up (admin-tunable, Q5):** on **join, play, and seek**,
  receivers wait until they have **`prebufferSeconds`** (default 5) buffered ahead of
  the target before (re)starting — giving slow/HDD/cold-transcode members a real
  chance to keep up without immediately underrunning. Members report a lightweight
  `ready`/`buffering` state back over the channel so the controller (and the
  `wait-for-all` mode) can see who's caught up. `prebufferSeconds`,
  `driftThresholdSeconds`, and `syncMode` are all in the Session Settings panel.
- **Buffering tolerance:** each member buffers independently; in `soft`/`hard` a
  `waiting` receiver lags then re-converges on the next heartbeat. The player's
  existing large buffer tiers + the new pre-roll already help here.
- **Play latency:** on a `play` command, receivers `seek(targetPos + smallLeadForDecode)`
  then play, to account for their own start latency.
- **Clock:** WS arrival + a server-stamped `at` estimates transit; sub-second is
  fine for video. No NTP needed.

---

## 11. Voice pipeline (details)

**Capture + process (per local user):**
`getUserMedia({audio:{echoCancellation:true, noiseSuppression:true,
autoGainControl:true, channelCount:1}})` → `createMediaStreamSource` →
**`MicAudioEngine`** (EQ biquads + compressor + analyser + auto, reusing the
existing DSP) → `createMediaStreamDestination()` → `dest.stream.getAudioTracks()[0]`
→ `pc.addTrack(track)` on every peer connection.

**`MicAudioEngine`** = refactor of `AudioEngine` to inject source/sink (the DSP,
`rebuildChain`, analyser accessors, and the auto-EQ/auto-comp algorithms are
source-agnostic and transplant directly). The `VoiceAudioPanel` reuses `EqTab`,
`CompressorTab`, `EqSpectrum`, `CompressorCurve` — those three visualizer/meter
components need a one-time refactor to accept an **engine instance** instead of
importing the singleton (currently they read `audioEngine.*` directly).

**Separate vs combined AudioContext — A/B behind a flag (Q7):** by default the mic
engine uses its **own** `AudioContext` (fully isolated from the movie graph — safest,
avoids the historical stuck-sink device-routing gremlin). A `mu_voice_shared_ctx`
feature flag (also surfaced in Settings → Audio for demoing) instead reuses the
movie's context so both graphs share one context/device. I'll instrument both paths
(CPU via `performance` + audio glitch counters) so we can compare overhead and pick a
default from real data. Two contexts is low-risk in Chrome; the flag lets us A/B it.

**Transport (mesh):**
- Per-member `RTCPeerConnection` to each other member (N·(N−1)/2 links; fine for ≤6).
- ICE config from `GET …/ice-config` (STUN + short-lived TURN).
- Signaling (offer/answer/ICE) over `SHARED_SESSION_SIGNAL` targeted to `user:<peerId>`.
- **Opus tuning** for "phone-call efficient but decent": mono, `maxaveragebitrate`
  ~20–24 kbps, **DTX on** (silence suppression), **inband FEC on** (loss
  resilience). Applied via `RTCRtpSender.setParameters` (bitrate) + SDP
  munging / `setCodecPreferences` for DTX/FEC.
- Remote tracks → `<audio>` elements (or a small mixing graph) → speakers,
  independent of the movie audio.

**Controls:**
- **Join with mic on/off (Q9):** mic is **on by default** on join; the accept modal
  exposes a Zoom-style toggle to join muted. Joining prompts the browser mic
  permission on first use.
- **Mute My Voice** → disable the local processed track (`track.enabled=false`) +
  UI state → menu text flips to "Unmute My Voice".
- **Mute All Voices** → mute local **and** set all remote `<audio>`.muted (so you
  only hear the movie). Reversible.
- **Push-to-talk (Q8):** when `voiceMode==='ptt'`, the local track is muted except
  while the PTT key is held. Default binding **`Ctrl+Space`** (hold), configurable in
  the Voice panel; chosen to avoid the bare `Space` = play/pause shortcut. Registered
  as a scoped keydown/keyup while in a session so it doesn't clash elsewhere.
- **Configure** → `VoiceAudioPanel`: device picker (`enumerateDevices` filtered to
  `audioinput` — labels require mic permission), input volume, EQ + Comp + auto +
  visualize (all as on the playback effects), noise-suppression/echo-cancel/AGC
  toggles (getUserMedia constraints), and the PTT key binding.

**Scaling note:** mesh is chosen for simplicity and the expected party size.
Past ~6 concurrent talkers, upstream/CPU degrade — a **future SFU** (mediasoup /
LiveKit) is the upgrade path, isolated behind the same signaling + `ice-config`
API so the client barely changes.

---

## 12. Security & permissions

- **WS auth is built in and enforced** (§6.3) — verify JWT on connect, bind
  `userId`, enforce channel-ownership + per-command authorization server-side.
- REST gated by `@RequireAction('view:library')`; admin-only actions verified
  against `session.admin_user_id`. (Optional: a dedicated `session:host`
  capability if we ever want to restrict who can *start* parties.)
- Server-side enforcement of `allowMembersControl` (never trust the client's
  disabled button alone).
- TURN uses **short-lived HMAC credentials**, never static secrets to the client.
- **Invitable-members endpoint (Q3):** a dedicated `GET /shared-sessions/invitable`
  returns the roster (id + display name + avatar) **regardless of the Show-Users-Info
  admin switch**, scoped to authenticated members and only exposing the minimal
  fields needed to invite. Keeps parties usable without flipping the global
  members-visibility setting.

---

## 13. Implementation phases (incremental, each shippable)

1. **Foundations:** WS auth (built + enforced, §6.3) + `ClientMeta.userId` +
   channel-ownership; shared types (`WsEvent`, `NotificationType`, DTOs); DB tables
   (`shared_sessions`, `shared_session_members`, `shared_session_messages`) + migration;
   invitable-members endpoint.
2. **Session lifecycle (control plane):** `shared-sessions` module + REST; gateway
   room join/leave + command relay; client state/service; **Start/Invite/Join/
   Leave/End/Transfer-admin** + invite notifications (bell + top-center flydown).
3. **Playback sync:** play/pause/seek interception + admin gating + disable button;
   heartbeat + drift correction; transient "X paused" toasts.
4. **Chat:** WS chat relay; draggable/resizable/dockable chat window; unread badge.
5. **Session settings panel** (admin) + live application.
6. **Voice:** coTURN infra + `ice-config`; `AudioEngine` source/sink refactor +
   `MicAudioEngine`; WebRTC mesh manager; `VoiceAudioPanel` (device + EQ/Comp/auto/
   visualize); Mute My / Mute All.
7. **Polish:** presence/roster + speaking indicators; reload rehydrate; mobile.

---

## 14. Resolved decisions & remaining questions

### Resolved (your answers — folded into the sections above)
1. **WS auth** → built in properly and enforced (§6.3), with a one-release ops
   rollback flag only, not a design compromise.
2. **TURN** → self-hosted `coturn` on the Fedora box, bypassing the VPN via the same
   conntrack/policy-routing mechanism the app's inbound already uses (§6.4).
3. **Members list** → dedicated `GET /shared-sessions/invitable` endpoint, ignores
   the Show-Users-Info switch (§12).
4. **Mesh cap** → default `maxMembers` 8, warn past ~6; SFU is the later upgrade.
5. **Sync** → best-effort, admin-tunable `syncMode` (`soft`/`hard`/`wait-for-all`) +
   `prebufferSeconds` + `driftThresholdSeconds` so members can catch up (§10, §6.2).
6. **Chat** → persisted per session (`shared_session_messages`), cleared when the
   admin ends it (§4).
7. **Audio contexts** → separate by default, `mu_voice_shared_ctx` A/B flag +
   overhead instrumentation to compare separate vs combined (§11).
8. **Push-to-talk** → `Ctrl+Space` (hold), configurable (§11).
9. **Mic on join** → on by default; accept modal has a Zoom-style mute-on-join toggle (§7.3, §11).
10. **Speaking indicators** → bottom "X is talking" popup (incl. self) + inline
    dots in the voice/chat panels; toggle in Session Settings (`showSpeakingIndicator`) (§7.3, §11).

### Resolved (second round)
- **A. Router UDP port range** → **the router can forward UDP ranges**, so the
  bounded relay UDP range (`49160–49200/udp`) is the default. TURN-over-TCP/TLS on
  5349 stays enabled as an automatic fallback for peers on restrictive networks.
- **B. TURN reveals the box's public IP to peers** → **acceptable** — the VPN is to
  mask the box's *own* outbound (downloads), not to hide it from trusted party
  members. TURN listens directly; no change needed.
- **C. Movie ducking** → **per-user client setting** (`mu_voice_duck`, default off),
  affects only that user's own movie volume. Moved out of session settings (§6.2, §11).
- **D. Sync controller** → **last-actor-wins** (last to play/pause/seek becomes the
  heartbeat source; falls back to admin). Confirmed (§10).
- **E. Late accept after end** → accept **fails gracefully** ("this session has
  ended"); invites aren't force-expired, they just no-op if the session is gone (§8).

*All open questions resolved. Plan is approved-to-build.*

---

*On approval I'll start with **Phase 1** (foundations: WS auth + types + DB +
invitable endpoint) — the load-bearing prerequisite — and check in before **Phase 3**
(playback interception/gating) and **Phase 6** (voice/TURN), the two highest-risk areas.*

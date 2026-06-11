# Mu on Smart TVs — Planning Document

Goal: run the existing Mu web client (Preact SPA) as an installable app on
smart TVs and TV-adjacent devices, so users can log in, connect to a Mu
server, browse, and play — the same experience as the browser, adapted for
the living room.

The strategic core: **every major TV platform except Apple's runs web apps.**
Samsung Tizen, LG webOS, Android TV/Google TV, and Fire TV can all host our
SPA (directly or in a thin wrapper). That means one codebase + a "TV mode"
layer, then per-platform packaging — not per-platform rewrites.

---

## 1. Platform landscape

| Platform | Market share (TVs) | App tech | Packaging | Store | Dev cost |
|---|---|---|---|---|---|
| **Samsung Tizen** | ~30% | Pure web app (HTML/JS/CSS) | `.wgt` via Tizen Studio | Samsung Apps (Seller Portal) | Free account; cert per app |
| **LG webOS** | ~20% | Pure web app | `.ipk` via webOS CLI | LG Content Store | Free account |
| **Android TV / Google TV** | ~20% (+ Chromecast w/ GTV) | Native shell + WebView, or TWA, or Capacitor | `.aab` via Android Studio | Google Play (TV track) | $25 one-time |
| **Fire TV (Amazon)** | ~10% US | Same Android app (Fire OS = Android) or "Web App" submission (hosted URL) | `.apk` / hosted | Amazon Appstore | Free |
| **Apple TV (tvOS)** | ~5-10% | **No web runtime.** Native Swift/TVML only | Xcode | App Store | $99/yr |
| **Roku** | ~35% US streaming devices | **No web runtime.** BrightScript/SceneGraph only | Roku pkg | Roku Channel Store | Free |
| Chromebooks / tablets / desktops | — | **PWA** (installable) | none — served from our domain | optional Play listing via TWA | free |

Key takeaway: Tizen + webOS + Android/Fire TV ≈ **80% of smart TVs** with the
web stack we already have. Roku and Apple TV require ground-up native apps —
recommend deferring both (or relying on casting for those users).

## 2. Shared work: the "TV mode" layer (the real project)

This is ~70% of the effort and benefits every platform at once.

### 2.1 D-pad / remote navigation (the big one)
TVs have no mouse. Everything must be reachable with ↑↓←→ / OK / Back.
- Adopt a **spatial navigation** library (`@noriginmedia/norigin-spatial-navigation`
  is the de-facto standard; framework-agnostic core works with Preact) or the
  W3C CSS spatial-navigation polyfill.
- Every interactive element gets focusable registration; visible focus ring
  (we already have `:focus-visible` styling — needs a bolder TV variant).
- **Back button semantics**: platform Back must walk our navigation stack
  (player → detail → library → exit-confirm). Tizen/webOS/Android each fire
  different key codes — small per-platform shim.
- Modals, flyouts, menus need focus traps that work with arrows, not Tab.

### 2.2 10-foot UI ("TV skin")
- A `tv` display mode (detected by user agent / platform shim / `?tv=1`):
  larger type (body ≥ 24px at 1080p), larger cards, higher-contrast focus,
  simplified chrome (no hover-dependent UI — every hover affordance needs a
  focus/OK equivalent; our card hover overlays, tooltips, and option menus
  all need focus-mode variants).
- Overscan-safe margins (~5%), dark theme default.
- Hide/replace mouse-centric features in TV mode: seek-bar right-click menu
  (→ long-press OK or a controls row), drag-resize split mode (drop split
  mode entirely on TV), comment bubbles (keep read-only via a button).

### 2.3 Playback engine on TV browsers
- Our direct-play MP4 (H.264/AAC) is universally supported. ✔
- HLS.js works on Tizen/webOS (MSE is present) — but older models (pre-2018)
  have buggy MSE; set a floor (Tizen 4+/webOS 4+).
- AV1: only newest TV chips decode it — the server's `?hevc=1`-style
  capability probing should extend to AV1/HEVC so TVs get a compatible
  stream (TVs often DO decode HEVC natively — opportunity: serve HEVC direct
  to TVs where the browser build exposes it).
- Web Audio (EQ/compressor) generally works but is CPU-heavy on TV SoCs —
  default effects OFF in TV mode.
- DRM: none needed (self-hosted content).

### 2.4 Login + server connection
- Typing on a TV is painful. Add a **pairing flow**: TV shows a short code,
  user visits `mu.../pair` on their phone, enters code while logged in →
  server binds a long-lived device token to the TV. (New `devices` table
  exists already; add `POST /auth/pair/start|claim` endpoints.)
- Server URL entry: for the public instance, bake the URL in; for
  self-hosters, a first-run screen with on-screen keyboard + QR code option.
- Long-lived refresh tokens for TVs (30–90d) so users aren't re-logging in.

### 2.5 Performance budget
TV SoCs ≈ 2015 mid-range phones. Targets: < 3s cold start, < 150MB heap.
- Code-split routes (already Vite — add manual chunks), lazy-load admin/
  settings surfaces entirely out of the TV bundle.
- Virtualize the library grid (1900-card DOM will crawl on a TV).
- Cap image sizes (TV mode requests smaller poster variants).

**Estimate for the shared layer: 3–6 weeks of focused work**, dominated by
spatial navigation + player-controls rework.

## 3. Per-platform packaging & publishing

### 3.1 Samsung Tizen (.wgt)
1. Install Tizen Studio (free) + create a Samsung (Seller Office) account.
2. Project = `config.xml` (privileges: internet, mediaplayback) + our built
   `dist/` output. The app IS the web app, running in the TV's Chromium.
3. Create an author + distributor certificate (per-TV-model device testing
   needs the cert installed on the TV in developer mode).
4. Test on a real TV via "Developer Mode" (enter host PC's IP) + `sdb`.
5. Submit through **Samsung Seller Portal**: app metadata, screenshots
   (1920×1080), age rating questionnaire, country list. Review ≈ 1–4 weeks,
   and Samsung's QA tests on real devices (focus handling and Back-key
   behavior are their most common rejections).

### 3.2 LG webOS (.ipk)
1. webOS TV SDK / CLI (`ares-*` tools), free LG Seller Lounge account.
2. Project = `appinfo.json` + web build. Test via Developer Mode app on the
   TV (`ares-install`).
3. Submit through **LG Seller Lounge**: metadata, screenshots, self-check
   list. Review ≈ 1–2 weeks. Same focus/Back-key QA emphasis.

### 3.3 Android TV / Google TV (.aab)
Options, in order of preference:
1. **Capacitor wrapper** (recommended): our SPA in a WebView with a tiny
   native shell — gives us key-event mapping, leanback launcher intent, and
   Play Store packaging. ExoPlayer is available later if WebView playback
   underperforms.
2. TWA (Trusted Web Activity): least work but Play's TV track has stricter
   requirements TWAs struggle with (leanback launcher, D-pad audit).
3. The same `.apk` ships to **Fire TV** via Amazon's Appstore (Fire OS is
   Android 9-ish; test WebView version!).
Play requirements: $25 account, TV screenshots, leanback intent, content
rating, D-pad-only functional review (they actually test this), privacy
policy URL. Review days-to-weeks.

### 3.4 PWA (Chromebooks, tablets, desktops, some TVs)
Nearly free: add `manifest.json` (icons, `display: standalone`), a service
worker (offline shell only — streams stay online), and installability is
automatic in Chrome/Edge on Chromebooks, Android tablets, desktops. This is
also the best "TV browser" fallback for platforms we don't package.
**Recommend doing this first regardless of TV plans.**

### 3.5 Roku & Apple TV (deferred)
Full rewrites (BrightScript / Swift). Realistic alternatives:
- **Casting**: add Chromecast sender support to the web client (Cast SDK;
  receiver can be the default media receiver for our MP4/HLS URLs with the
  share-token auth pattern) and AirPlay (Safari's built-in for `<video>`).
  This covers Roku-stick-less Chromecast users and Apple TV via AirPlay
  with ~1 week of work instead of two native apps.

## 4. Server-side work
- Pairing-code auth endpoints + long-lived device tokens (above).
- Capability-aware stream negotiation extended for TV codecs (HEVC/AV1
  probing per session).
- CORS/hosting: packaged apps load from `file://`/app origins → API needs
  the app origins allow-listed (or keep same-origin by serving the TV build
  from the server, which Tizen/webOS allow via hosted-web-app mode).
- Smaller poster/thumbnail variants endpoint (TV image budget).

## 5. Phased roadmap

| Phase | Scope | Effort |
|---|---|---|
| **0. PWA** | manifest + SW + install prompts; covers Chromebooks/tablets/desktop now | 2–4 days |
| **1. TV mode core** | spatial nav, focus UI, TV skin, player controls for remote, pairing auth | 3–6 weeks |
| **2. Tizen + webOS** | packaging, device testing, store submissions | 1–2 weeks + review time |
| **3. Android TV + Fire TV** | Capacitor shell, leanback compliance, Play + Amazon submissions | 2–3 weeks + review |
| **4. Casting** | Chromecast sender + AirPlay | ~1 week |
| **5. (Optional) Roku / tvOS** | native rewrites — only if demand justifies | 6–10 weeks each |

## 6. Open questions / risks
- **Store policy**: a "media player that connects to your own server" is
  store-acceptable (Plex/Jellyfin/Emby all do it), but stores reject apps
  that look like piracy tools — listing copy must emphasize *personal media
  server client*; screenshots must use innocuous content.
- **Old TV floor**: pick minimum OS versions (suggest Tizen 5.5+/webOS 4.5+,
  Android TV 9+) — supporting older MSE stacks balloons QA.
- **Who hosts**: packaged "bring your own server" app vs. hard-coded to
  mu.ryanweiss.net changes the login flow and the store review story; the
  Jellyfin-style "enter your server" first-run screen is the safer pattern.
- **QA hardware**: budget for at least one Samsung TV, one LG TV, and a
  Chromecast/Fire stick for real-device testing (emulators miss remote and
  performance issues).

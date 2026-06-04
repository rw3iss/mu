# Fedora Linux Migration Plan — Mu / CineHost

**Date:** 2026-06-04
**Author:** migration planning pass
**Status:** planning — execute when the new Fedora box is provisioned. Do NOT run any of this yet.

Move production from the current Windows host (`rw3iss@192.168.50.211`, home LAN, port 4000,
data on `D:\.mu_data`, NVENC walled off in Session 0) to a Fedora Linux box with an NVIDIA GPU,
and rewrite the install/deploy machinery for Linux.

---

## 1. Overview / why

### The problem we are killing

On Windows, the NVIDIA NVENC encoder (`h264_nvenc`, `av1_nvenc`) is only reachable from an
**interactive desktop session (Session 1)**. Windows walls the GPU off from Session 0, which is
where services, SSH-launched processes, and CI runners live. To make NVENC work, prod currently:

- Runs the server from `C:\Users\rw3is\start-mu.cmd` via a **Task Scheduler** task named "Mu Server"
  (Interactive, Highest), NOT a service. NSSM was deleted (see `~/.claude/.../memory/MEMORY.md`:
  "Prod runs via interactive Session-1 launcher").
- Falls back to software encoding globally via the `hwAccelBroken` flag whenever NVENC DLL init
  fails (exit `0xC0000142`) — which is exactly what happens in Session 0.
- Forces `-hwaccel none` on every ffmpeg input on Windows
  (`transcoder.service.ts:1885`, `thumbnail.service.ts:251`) to avoid the same DLL-init crash on
  the *decode* side.

**On Linux this entire class of problem does not exist.** A headless systemd service (or an SSH
session, or a CI runner) can use NVENC directly, provided:

1. The NVIDIA driver + CUDA libraries are installed.
2. The ffmpeg build actually has the nvenc encoders compiled in.
3. The process user is in the `video` and `render` groups (for `/dev/nvidia*` and `/dev/dri/render*`).

### What gets deleted / stops being needed on Linux

| Windows artifact | Fate on Linux |
|---|---|
| NSSM service (`nssm`) | gone — replaced by a systemd unit |
| `start-mu.cmd` interactive launcher | gone |
| Task Scheduler "Mu Server" task (`schtasks`, Session 1) | gone — systemd starts at boot in headless context |
| `C:/ffmpeg/ffmpeg.exe` auto-detection | not needed — distro ffmpeg on PATH / `/usr/bin/ffmpeg` |
| `taskkill /F /IM ffmpeg.exe` orphan sweeps | replaced by `pkill ffmpeg` (already branched) + systemd cgroup cleanup |
| `-hwaccel none` forced on every input | should be removed on Linux — HW decode is safe and desirable |
| base64 / CRLF transfer tricks for `.cmd` files | gone |
| `MSYS_NO_PATHCONV` / Git-Bash `//F //PID` path-mangling workarounds | gone |
| `netstat -ano` + `LISTENING` port reclaim | replaced by `ss` / `lsof` (already branched in scripts) |
| `D:\.mu_data` | `/var/lib/mu` (system service) or `~/.mu_data` (user service) |
| `C:/Certbot/live/...` | `/etc/letsencrypt/live/...` (already a fallback in `main.ts:94`) |

### What stays the same

- Node 20+, pnpm 9, Turborepo build, SQLite DB, the config.yml + `MU_*` env override model.
- Port 4000, external URL `https://mu.ryanweiss.net:4000`.
- The deploy invariants that bit us before: nuke `client/dist/` before build, force a direct
  `vite build` fallback, force git to `origin/main`, verify HTTP 200.

---

## 2. Windows-specific code & script inventory (verified, with file:line)

This is the authoritative list of every spot that assumes Windows. Items marked **CODE** need a
source change; items marked **CONFIG** are handled purely by config/env on the new box; items
marked **SCRIPT** are in the deploy/install shell layer being rewritten.

### 2a. FFmpeg path detection — mostly already Linux-aware (CONFIG, one CODE)

- `transcoder.service.ts:133-167` — reads `transcoding.ffmpegPath` / `transcoding.ffprobePath`
  from config (default `'ffmpeg'`), then auto-detects. **The non-Windows branch already exists**:
  ```ts
  process.platform === 'win32'
      ? ['C:/ffmpeg/ffmpeg.exe', 'C:\\ffmpeg\\ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe']
      : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']                              // transcoder.service.ts:154
  ```
  On Fedora, distro ffmpeg lives at `/usr/bin/ffmpeg`, so the default `'ffmpeg'` on PATH works and
  the fallback covers the rest. **No code change required** — just don't set `transcoding.ffmpegPath`
  in config (or set it explicitly to `/usr/bin/ffmpeg`). CONFIG.
- `sprite.service.ts:400-407` `detectFfmpeg()` — candidate list already includes `'ffmpeg'`,
  `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg` alongside `C:/ffmpeg/ffmpeg.exe`. Linux-safe as-is. CONFIG.

### 2b. `-hwaccel none` forced on every input (CODE — should change for Linux)

These exist *because* Windows Session-0 NVENC DLL init crashes even on the decode path. On Linux we
want hardware decode enabled.

- `transcoder.service.ts:1885-1887` — `createFfmpegCommand()` adds `-hwaccel none` when
  `process.platform === 'win32'`. Because it is `win32`-gated, **Linux is already unaffected** — but
  confirm we don't want to *enable* `-hwaccel cuda`/`nvdec` for decode acceleration (optional perf win).
- `thumbnail.service.ts:251-253` — same `win32`-gated `-hwaccel none`. Linux unaffected.

  **Verdict:** no *required* change (the guards are `win32`-only), but there's an optional Linux
  enhancement to add `-hwaccel cuda` for decode. Leave for a follow-up; not part of cutover.

### 2c. Process / orphan management (CODE — Linux branches already exist, verify)

- `transcoder.service.ts:1514-1521` `boostProcessPriority()` — `wmic ... setpriority` on Windows,
  `renice -n -5 -p` on Unix. Unix branch exists. CODE (already handled).
- `transcoder.service.ts:2191-2195` reset-and-clear path — `taskkill /F /IM ffmpeg.exe /T` on
  Windows, `pkill -9 ffmpeg` on Unix. Unix branch exists. CODE (already handled).
- `main.ts:137-149` `reclaimPort()` — `netstat -ano` + image lookup on Windows. **Check the Unix
  branch exists** (read continues past line 149; on Linux systemd owns the port so reclaim is
  largely moot, but confirm it no-ops cleanly rather than erroring). CODE — verify during cutover.

### 2d. GPU / NVENC handling (CODE — Linux-safe, but `hwAccelBroken` must be cleared once)

- `transcoder.service.ts:86,126-129` — `hwAccelBroken` boolean, restored from persisted settings on
  boot. **On the Windows box this flag is very likely currently `true`** (it flips whenever NVENC
  fails, which is constantly in Session 0 unless the interactive launcher is up). If we copy the
  SQLite DB / settings store to Linux, the flag comes along and would keep NVENC disabled.
  **ACTION at cutover:** clear it once on the new box (admin "Reset HW accel" action, or delete the
  `hwAccelBroken*` settings keys). See §4 and `transcoder.service.ts:2051-2062` / `2207-2213`.
- `transcoder.service.ts:2317-2345` `getEffectiveHwAccel()` / `getEncodingSettings()` — returns
  `'none'` when `hwAccelBroken`. Once the flag is cleared and config has `encoding.hwAccel: nvenc`,
  this returns `nvenc` and NVENC paths (`562 av1_nvenc`, `736/796/1143/2079/2527 h264_nvenc`) light up.
  No code change — config + clear-flag. CONFIG.
- `transcoder.service.ts:1942,2006-2013` `isGpuFailure()` matchers — Linux NVENC failure strings
  ("no nvenc capable devices", "cannot load nvencodeapi", etc.) are the same on Linux. No change. CODE (fine).
- `conversion.service.ts:93-94,156` `nvencActive()` gates HEVC→AV1 on `getEffectiveHwAccel()==='nvenc'`.
  Works unchanged once NVENC is live on Linux. CODE (fine).
- `server.service.ts:147-167` `getGpuInfo()` — runs `nvidia-smi` on both platforms (Windows vs
  `... 2>/dev/null`). Works on Linux as long as `nvidia-smi` is on PATH. CONFIG.

### 2e. TLS cert loading (CODE — Linux fallback already present)

- `main.ts:59-115` `loadTlsCredentials()`:
  - First honors `tls.certPath` / `tls.keyPath` from config (`main.ts:59-82`). Preferred explicit path.
  - Then auto-detects by hostname, searching **both** `C:/Certbot/live/<hostname>` *and*
    `/etc/letsencrypt/live/<hostname>` (`main.ts:89-96`). **Linux path already there.**
  - `main.ts:200-219` retries the cert read 5× (covers Certbot's atomic symlink swap on renewal).
  - **No code change.** On Linux either set `tls.hostname: mu.ryanweiss.net` (auto-finds
    `/etc/letsencrypt/live/mu.ryanweiss.net/`) or set explicit `tls.certPath`/`tls.keyPath`. CONFIG.
- `config.schema.ts:157-163` — `tls.{hostname,certPath,keyPath}` schema. Unchanged. CONFIG.

### 2f. Data dir / DB path resolution (CONFIG)

- `config.loader.ts:145` `resolve(process.env.MU_DATA_DIR ?? process.env.MU_DATADIR ?? './data')`
  + `:200-220` overrides DB/cache/logs paths when `MU_DATA_DIR` is set. Platform-agnostic. CONFIG.
- `config.schema.ts:165` `dataDir` default `'../../data'`. CONFIG.
- `migrate.js:39-52` anchors `PROJECT_ROOT` two levels up from `src/scripts/`, resolves
  `MU_DATA_DIR` (absolute or relative-to-root), DB at `<dataDir>/db/mu.db`. Platform-agnostic. CONFIG.
- `migrate.js:57-60` stray-DB warnings reference `src/data/db/mu.db` etc. — harmless on Linux. CONFIG.

  **Cutover:** set `MU_DATA_DIR=/var/lib/mu` (system service) and copy `D:\.mu_data` contents there.

### 2g. systemd-related logs reference (SCRIPT)

- `logs.controller.ts:11-12` maps `nssm-stdout` / `nssm-stderr` log names. These were NSSM's
  captured stdout/stderr files. On Linux there is **no NSSM and no such files** — logging goes to
  journald (and/or `<dataDir>/logs/server.log`). The two map entries become dead keys on Linux;
  harmless (they just won't resolve), but worth removing in a later cleanup PR. SCRIPT/CODE (cosmetic).

### 2h. Deploy / install shell layer (SCRIPT — being rewritten)

- `src/deploy.sh:13-17,39-46,52-73,144-148,203-205` — `IS_WINDOWS` detection, NSSM start/stop,
  `netstat`+`taskkill` port reclaim. Linux branches mostly exist (`stop.sh`/`restart.sh` source);
  rewrite to drop the Windows arms and call `systemctl`. See §6.
- `src/stop.sh:10-14,31-69,97-148` — NSSM stop, `taskkill`, `tasklist | grep ffmpeg`. Has full Unix
  branches (lsof/ss/fuser/pgrep). On Linux with systemd, `stop.sh` becomes mostly `systemctl stop mu`.
- `src/restart.sh:15-18,37-79` — NSSM service arm, else nohup. Replace with `systemctl restart mu`.
- `src/scripts/kill-orphans.sh:18-27` — **explicitly a no-op on non-Windows** (exits 0 at line 26).
  Can be dropped from the Linux deploy flow entirely. SCRIPT.
- `src/scripts/deploy-remote.sh:25,30-32,75-78` — `MU_REMOTE_PATH=/c/Users/rw3is/...`, Git-Bash-
  over-SSH comment, `bash deploy.sh` via stdin pipe. Repoint `MU_REMOTE_PATH` to the Linux clone and
  the stdin-pipe trick is no longer required (a normal `ssh box 'cmd'` works). SCRIPT. See §6.
- `src/scripts/install.sh` — already cross-platform with a `dnf` branch (`:170-174`, `:214`) and a
  full Linux systemd-service generator (`:789-825`) and firewalld branch (`:756-759`). Reusable on
  Fedora, but: (1) `install_ffmpeg` does `dnf install -y ffmpeg` (`:214`) which on a clean Fedora
  pulls `ffmpeg-free` (NO nvenc) — must be RPM Fusion's full `ffmpeg`; (2) the generated unit lacks
  `Group=`/`SupplementaryGroups=` for GPU access. See §3 and §5. SCRIPT.
- `src/scripts/install.ps1` — Windows-only installer. Untouched / irrelevant on Linux. SCRIPT.

### Summary: what needs actual CODE changes vs config

**No code change is strictly required to run on Linux** — every `process.platform === 'win32'`
branch already has a Unix counterpart, the ffmpeg fallback includes `/usr/bin/ffmpeg`, and the TLS
loader already searches `/etc/letsencrypt`. The migration is therefore **config + ops**, with these
optional/cleanup code touches:

- **Optional perf:** enable `-hwaccel cuda` for decode on Linux (remove/relax the win32-only
  `-hwaccel none`, add a Linux cuda path) — `transcoder.service.ts:1885`, `thumbnail.service.ts:251`.
- **Cosmetic cleanup:** drop `nssm-stdout`/`nssm-stderr` log keys (`logs.controller.ts:11-12`).
- **One-time data action (not code):** clear `hwAccelBroken*` settings after cutover.

---

## 3. Host prerequisites (Fedora)

Assume Fedora Workstation/Server with a GeForce/Quadro NVIDIA card.

### 3a. NVIDIA driver (RPM Fusion)

```bash
# Enable RPM Fusion free + nonfree (driver lives in nonfree)
sudo dnf install -y \
  https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm \
  https://mirrors.rpmfusion.org/nonfree/fedora/rpmfusion-nonfree-release-$(rpm -E %fedora).noarch.rpm

# Driver via akmod (rebuilds against new kernels automatically) + CUDA libs for NVENC
sudo dnf install -y akmod-nvidia xorg-x11-drv-nvidia-cuda

# Let the kmod build, then reboot
sudo akmods --force
sudo dracut --force
sudo reboot
```

After reboot, verify the driver:

```bash
nvidia-smi      # must list the GPU, driver version, and 0 running procs
```

> akmod rebuilds the kernel module on every kernel bump. After a `dnf update` that pulls a new
> kernel, **wait for the akmod build before rebooting** (or NVENC disappears until it builds). See §8.

### 3b. NVENC-capable ffmpeg (RPM Fusion full build — NOT ffmpeg-free)

Fedora's default repos ship `ffmpeg-free`, which is **compiled without the nvenc encoders**. You
must install RPM Fusion's full `ffmpeg`:

```bash
# Replace ffmpeg-free with the full RPM Fusion ffmpeg
sudo dnf swap -y ffmpeg-free ffmpeg --allowerasing
# (or: sudo dnf install -y ffmpeg --allowerasing)

# VERIFY nvenc encoders are present — this is the make-or-break check:
ffmpeg -hide_banner -encoders | grep -E 'nvenc'
# expect: h264_nvenc, hevc_nvenc, av1_nvenc
```

If `grep nvenc` returns nothing, you have `ffmpeg-free` and NVENC will silently fall back to
software. Do not proceed until the encoders list.

> ⚠️ `src/scripts/install.sh:214` currently does `sudo dnf install -y ffmpeg` — on a box where
> RPM Fusion isn't enabled first, dnf may resolve that to `ffmpeg-free`. The Fedora install path
> must enable RPM Fusion (3a) **before** installing ffmpeg, and prefer `dnf swap ffmpeg-free ffmpeg`.

### 3c. Node 20+ and pnpm 9

```bash
# NodeSource (matches install.sh:171-173 approach) or Fedora module
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
sudo npm install -g pnpm@9
node -v && pnpm -v       # node >= 20, pnpm >= 9
```

### 3d. Service user + GPU group membership

Create a dedicated unprivileged user (recommended) or reuse an existing one. The user the server
runs as **must** be in `video` and `render` so it can open `/dev/nvidia*` and `/dev/dri/renderD*`:

```bash
sudo useradd --system --create-home --home-dir /var/lib/mu --shell /usr/sbin/nologin mu
sudo usermod -aG video,render mu
# verify:
id mu        # groups=...,video,render
ls -l /dev/nvidia* /dev/dri/renderD*   # group should be video / render
```

(If running as your own login user instead, `sudo usermod -aG video,render rw3iss` and re-login.)

### 3e. Firewall (port 4000)

```bash
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports     # expect 4000/tcp
```

(`install.sh:756-759` already does this when run interactively.)

### 3f. Verify GPU access end-to-end (the real smoke test)

Run these **as the service user** (`sudo -u mu ...`) so you're testing the exact context systemd
will use, not your interactive desktop session:

```bash
# 1. Driver visible to the user
sudo -u mu nvidia-smi

# 2. NVENC actually encodes — generate a test pattern and encode it with h264_nvenc
sudo -u mu ffmpeg -hide_banner -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 \
  -c:v h264_nvenc -f null - 2>&1 | tail -20
# SUCCESS = it runs to "frame=  60" / no "Cannot load nvcuda" / no "No capable devices found".

# 3. AV1 (only on Ada/Lovelace 40-series+; Turing/Ampere lack AV1 encode)
sudo -u mu ffmpeg -hide_banner -f lavfi -i testsrc=duration=2:size=1280x720:rate=30 \
  -c:v av1_nvenc -f null - 2>&1 | tail -20
```

If step 2 fails with "No capable devices found" while `nvidia-smi` works, the user is missing the
`video`/`render` group (re-check 3d) — this is the Linux analogue of the Windows Session-0 problem,
and the fix is group membership, not a session.

---

## 4. App / config changes

Create `/var/lib/mu/data/config/config.yml` (or wherever `MU_DATA_DIR` points). Example:

```yaml
# /var/lib/mu/data/config/config.yml
server:
  host: "0.0.0.0"
  port: 4000

auth:
  jwtSecret: "<copy from old box or regenerate; regenerating invalidates sessions>"
  cookieSecret: "<copy from old box or regenerate>"

dataDir: "/var/lib/mu/data"

tls:
  hostname: "mu.ryanweiss.net"      # auto-finds /etc/letsencrypt/live/mu.ryanweiss.net/
  # OR set explicit paths instead of hostname:
  # certPath: "/etc/letsencrypt/live/mu.ryanweiss.net/fullchain.pem"
  # keyPath:  "/etc/letsencrypt/live/mu.ryanweiss.net/privkey.pem"

transcoding:
  ffmpegPath: "/usr/bin/ffmpeg"     # optional; 'ffmpeg' on PATH also works
  ffprobePath: "/usr/bin/ffprobe"

media:
  libraryPaths:
    - "/srv/media/movies"            # Linux media mount(s); was a Windows D:/ path
```

Encoding settings (`encoding.hwAccel`, `encoding.preset`, `encoding.av1Cq`, `convertHevcToAv1`,
etc.) live in the **settings store (DB)**, not config.yml — they carry over with the DB copy. After
cutover, set `encoding.hwAccel: nvenc` in Settings → Encoding if it isn't already.

### Environment / data dir

| Concern | Windows (old) | Fedora (new) |
|---|---|---|
| Data dir | `D:\.mu_data` | `/var/lib/mu/data` (system) or `~/.mu_data` (user) — via `MU_DATA_DIR` |
| DB | `D:\.mu_data\db\mu.db` | `/var/lib/mu/data/db/mu.db` (`migrate.js:52`) |
| Logs | NSSM stdout/stderr + `data/logs/server.log` | journald + `/var/lib/mu/data/logs/server.log` |
| ffmpeg | `C:/ffmpeg/ffmpeg.exe` | `/usr/bin/ffmpeg` (RPM Fusion full build) |
| TLS | `C:/Certbot/live/mu.ryanweiss.net/` | `/etc/letsencrypt/live/mu.ryanweiss.net/` |
| Port | 4000 | 4000 |
| Process supervision | Task Scheduler (Session 1) | systemd (headless) |

Env vars the unit will set (see `EnvironmentFile` in §5):

```bash
NODE_ENV=production
MU_DATA_DIR=/var/lib/mu/data
MU_SERVER_PORT=4000        # config.yml server.port is canonical; env override available
# (jwt/cookie secrets live in config.yml, not env, matching install.sh's generated config)
```

### Clearing the stale `hwAccelBroken` flag (one-time, at cutover)

The copied DB almost certainly carries `hwAccelBroken=true` from the Windows box. On Linux that
would keep `getEffectiveHwAccel()` returning `'none'` (`transcoder.service.ts:2329`) and silently
disable NVENC. Clear it once after the service is up:

- **Preferred:** use the admin "Reset HW accel / clear cache" action which calls the reset path
  (`transcoder.service.ts:2188-2218`) — kills orphan ffmpeg, clears `hwAccelBroken*`, re-probes NVENC.
- **Manual fallback:** delete the `hwAccelBroken`, `hwAccelBrokenSince`, `hwAccelBrokenReason` keys
  from the settings store, then restart. (See the delete logic at `transcoder.service.ts:2060-2062`.)

Confirm via Settings or `GET` health that `getEffectiveHwAccel()` now reports `nvenc`.

### TLS / Certbot on Linux

```bash
sudo dnf install -y certbot
# DNS-01 or HTTP-01 — port 4000 is non-standard, so use DNS-01 or a temporary :80 standalone:
sudo certbot certonly --standalone -d mu.ryanweiss.net   # needs :80 reachable, or use --dns-* plugin
```

Renewal must reload the service so the new cert is read. The server already retries the cert read
5× to survive Certbot's atomic symlink swap (`main.ts:206-211`), but a clean restart is safer.
Add a deploy hook:

```bash
# /etc/letsencrypt/renewal-hooks/deploy/restart-mu.sh   (chmod +x)
#!/usr/bin/env bash
systemctl restart mu
```

`certbot renew` runs via the packaged systemd timer (`certbot-renew.timer`) — verify with
`systemctl list-timers | grep certbot`.

---

## 5. systemd service unit

**Decision: system service (not `--user`).** Justification:

- GPU device nodes (`/dev/nvidia*`, `/dev/dri/renderD*`) need group membership; a system service
  with `SupplementaryGroups=video render` gets this cleanly and starts at boot with no logged-in
  session. A `--user` service requires lingering (`loginctl enable-linger`) and is fussier about
  device access. System service is the direct, boot-safe analogue of "make NVENC headless".

Create `/etc/systemd/system/mu.service`:

```ini
[Unit]
Description=Mu / CineHost movie streaming server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mu
Group=mu
# THE GPU-ACCESS LINE — Linux equivalent of "Session 1". Lets the headless
# service open /dev/nvidia* and /dev/dri/renderD* for NVENC/NVDEC.
SupplementaryGroups=video render

WorkingDirectory=/opt/mu/src/packages/server
EnvironmentFile=/etc/mu/mu.env
ExecStart=/usr/bin/node /opt/mu/src/packages/server/dist/main.js

Restart=on-failure
RestartSec=5
# Give in-flight HLS/transcode children time to die on stop
TimeoutStopSec=30
KillMode=mixed

# Logging to journald (journalctl -u mu -f). The app also writes
# <dataDir>/logs/server.log per config.loader.ts.
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mu

# Light hardening (optional; loosen if it interferes with media mounts)
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/mu /srv/media

[Install]
WantedBy=multi-user.target
```

`/etc/mu/mu.env`:

```ini
NODE_ENV=production
MU_DATA_DIR=/var/lib/mu/data
MU_SERVER_PORT=4000
```

Enable + start:

```bash
sudo mkdir -p /etc/mu
sudo install -m0755 -d /opt/mu                # repo clone target
sudo systemctl daemon-reload
sudo systemctl enable --now mu
systemctl status mu
journalctl -u mu -f
```

> Layout note: this plan uses `/opt/mu` for the **code** (git clone, owned by `mu`) and
> `/var/lib/mu/data` for **runtime data** (`MU_DATA_DIR`). You can collapse both under `/var/lib/mu`
> if you prefer — just keep `WorkingDirectory`, `ExecStart`, and `MU_DATA_DIR` consistent.
> The existing `install.sh:802-819` generator produces a `cinehost.service` without `Group=`,
> `SupplementaryGroups=`, or journald lines — the unit above supersedes it. Update `install.sh` to
> emit this richer unit (and name it `mu.service`) as part of the rewrite.

---

## 6. Rewritten deploy flow (Linux)

### New `src/deploy.sh` (Linux systemd variant)

Replaces the `IS_WINDOWS`/NSSM/`taskkill`/`netstat` machinery. Keeps the hard-won invariants:
git force-sync to `origin/main`, nuke `client/dist/` before build, `vite build` fallback if the
Turbo cache restores a partial dist, run migrations, restart via systemd, verify HTTP 200.

```bash
#!/usr/bin/env bash
# deploy.sh — Linux/systemd deploy for Mu.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"   # .../src
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$SCRIPT_DIR"
SERVICE="mu"
PORT="${MU_SERVER_PORT:-4000}"
CLIENT_DIST="$SRC_DIR/packages/client/dist"

echo "=== Mu deploy (Linux/systemd) ==="

# 1. Force git to origin/main (survives detached HEAD / local divergence)
cd "$PROJECT_ROOT"
git fetch origin main --quiet
git checkout -f main
git reset --hard origin/main
echo "HEAD now $(git rev-parse --short HEAD)"

# 2. Install
cd "$SRC_DIR"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# 3. Build — nuke client/dist first (Turbo partial-restore guard)
rm -rf "$CLIENT_DIST"
pnpm build
if [ ! -s "$CLIENT_DIST/index.html" ] || [ ! -d "$CLIENT_DIST/assets" ]; then
    echo "WARN: partial client/dist after pnpm build — forcing direct vite build"
    rm -rf "$CLIENT_DIST"
    (cd "$SRC_DIR/packages/client" && pnpm exec vite build)
    [ -s "$CLIENT_DIST/index.html" ] && [ -d "$CLIENT_DIST/assets" ] \
        || { echo "FATAL: client/dist still incomplete"; exit 1; }
fi

# 4. Migrate
node scripts/migrate.js

# 5. Restart via systemd (no NSSM, no taskkill, no kill-orphans.sh)
sudo systemctl restart "$SERVICE"

# 6. Verify HTTP 200 (one retry loop)
for i in $(seq 1 15); do
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://localhost:${PORT}/" 2>/dev/null || true)
    [ "$code" = "200" ] && { echo "Verified GET / -> 200"; echo "=== Deploy complete ==="; exit 0; }
    code=$(curl -s  -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:${PORT}/"  2>/dev/null || true)
    [ "$code" = "200" ] && { echo "Verified GET / -> 200"; echo "=== Deploy complete ==="; exit 0; }
    sleep 1
done
echo "FATAL: HTTP probe never returned 200. Last logs:"; journalctl -u "$SERVICE" -n 30 --no-pager
exit 1
```

Notes:
- `sudo systemctl restart mu` needs a passwordless sudoers rule for the deploy user, e.g.
  `/etc/sudoers.d/mu-deploy`: `rw3iss ALL=(root) NOPASSWD: /usr/bin/systemctl restart mu, /usr/bin/systemctl status mu`.
- `kill-orphans.sh` is no longer invoked — systemd's `KillMode=mixed` reaps the cgroup's ffmpeg
  children on stop. (The script already self-no-ops on Linux at `kill-orphans.sh:23-26`.)
- `stop.sh` / `restart.sh` simplify to `systemctl stop mu` / `systemctl restart mu`.

### Simplified `src/scripts/deploy-remote.sh`

The Git-Bash-over-SSH stdin-pipe trick (`deploy-remote.sh:74-78`) is gone — plain `ssh` works.

```bash
REMOTE_HOST="${MU_REMOTE_HOST:-mu@fedora-box}"          # was rw3iss@192.168.50.211
REMOTE_PATH="${MU_REMOTE_PATH:-/opt/mu/src}"            # was /c/Users/rw3is/.../src
PUBLIC_URL="${MU_PUBLIC_URL:-https://mu.ryanweiss.net:4000/}"

# ... push current branch (unchanged) ...

# Remote deploy — no stdin pipe needed on Linux:
ssh "$REMOTE_HOST" "cd '$REMOTE_PATH' && bash deploy.sh"

# ... external 200 verify (unchanged) ...
```

Everything else in `deploy-remote.sh` (uncommitted-change guard, push, external verify) is
platform-agnostic and stays.

---

## 7. CI/CD options

### (a) Simplest — `ssh box deploy.sh`, manual or git-poll

The rewritten `deploy-remote.sh` already is this. Run `bash src/scripts/deploy-remote.sh` by hand,
or drop a tiny poller on the box (systemd timer running `git fetch && [ behind ] && deploy.sh`).
Zero new infrastructure. Good enough for a single-maintainer home server.

### (b) Self-hosted GitHub Actions runner as a systemd service ← **recommended**

On Linux this is now clean: the Session-0 GPU problem is gone, so a headless runner (itself a
systemd service) can build *and* the deploy step can restart a service that uses NVENC. Install the
runner once:

```bash
# As the mu/deploy user, in /opt/actions-runner
./config.sh --url https://github.com/rw3iss/cinehost --token <REG_TOKEN> --labels fedora-gpu
sudo ./svc.sh install mu        # installs + runs as a systemd service
sudo ./svc.sh start
```

`.github/workflows/deploy.yml` sketch:

```yaml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: [self-hosted, fedora-gpu]
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        working-directory: src
        run: bash deploy.sh         # force-syncs to origin/main, builds, migrates, restarts mu, verifies 200
      - name: External verify
        run: |
          for i in $(seq 1 10); do
            code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 8 https://mu.ryanweiss.net:4000/ || true)
            [ "$code" = 200 ] && exit 0; sleep 1
          done
          echo "external probe failed"; exit 1
```

The runner user needs the same passwordless `systemctl restart mu` sudoers rule as §6.

### (c) git push-to-deploy hook

A bare repo on the box with a `post-receive` hook that runs `deploy.sh`. Works, but duplicates the
git plumbing `deploy.sh` already does (`reset --hard origin/main`) and is harder to observe than (b).

**Recommendation: (b)** — self-hosted runner. It's the option Windows couldn't have (GPU in CI),
gives push-button + on-push deploys, surfaces logs in the Actions UI, and reuses `deploy.sh`
unchanged. Fall back to (a) if you don't want a runner process resident.

---

## 8. Step-by-step cutover checklist

> Keep the Windows box running until the very end (DNS/port cutover is the point of no easy return).

1. **Provision Fedora box.** Static LAN IP or DHCP reservation. Reachable on the LAN.
2. **Install NVIDIA driver** (§3a). Reboot. `nvidia-smi` lists the GPU.
3. **Install full ffmpeg** (§3b). `ffmpeg -encoders | grep nvenc` shows `h264_nvenc`/`hevc_nvenc`
   (and `av1_nvenc` on 40-series). **Do not proceed if empty.**
4. **Install Node 20+/pnpm 9** (§3c).
5. **Create service user `mu`, add to `video`+`render`** (§3d). `sudo -u mu nvidia-smi` works.
6. **GPU smoke test as the service user** (§3f, step 2). h264_nvenc encodes a testsrc with no
   "No capable devices found". This is the gate that proves the migration's whole premise.
7. **Open firewall :4000** (§3e).
8. **Clone repo to `/opt/mu`**, `chown -R mu:mu /opt/mu`.
   `sudo -u mu git clone git@github.com:rw3iss/cinehost.git /opt/mu` (SSH URL still works post-rename).
9. **Env / config** (§4): create `/etc/mu/mu.env`, `/var/lib/mu/data/config/config.yml`
   (set `tls.hostname`, `dataDir`, `media.libraryPaths` to Linux mounts, `transcoding.ffmpegPath`).
10. **Copy data from old box** (§9 risks below for the gotchas):
    - Stop the Windows server (so SQLite isn't mid-write).
    - Copy `D:\.mu_data` → `/var/lib/mu/data` (db, cache, config, thumbnails, logs). `chown -R mu:mu`.
    - Or scp the DB + WAL/SHM specifically: `mu.db`, `mu.db-wal`, `mu.db-shm`.
    - Fix `media.libraryPaths` and any absolute Windows paths stored in DB rows (movie file paths!)
      — see §9. The cache (`cache/streams`) can be discarded and rebuilt rather than copied.
11. **Run migrations:** `cd /opt/mu/src && sudo -u mu MU_DATA_DIR=/var/lib/mu/data node scripts/migrate.js`.
    Watch for stray-DB warnings (`migrate.js:57-60`) — irrelevant on Linux.
12. **Build:** `cd /opt/mu/src && sudo -u mu pnpm install && sudo -u mu pnpm build`.
13. **Install systemd unit** (§5): write `/etc/systemd/system/mu.service`, `daemon-reload`,
    `systemctl enable --now mu`. `journalctl -u mu -f` shows clean boot.
14. **Clear `hwAccelBroken`** (§4): admin reset action or delete settings keys; restart;
    confirm `getEffectiveHwAccel()` → `nvenc`. Play a movie → confirm GPU encode (`nvidia-smi`
    shows ffmpeg using the encoder, low CPU).
15. **TLS** (§4): `certbot certonly` for `mu.ryanweiss.net`, install the renewal restart hook.
    Confirm the server logs "using Let's Encrypt certs from /etc/letsencrypt/live/...".
16. **Verify locally:** `curl -k https://localhost:4000/` → 200. Log in, scan a source, play a
    movie, scrub (confirms NVENC under load, the original Windows pain point).
17. **DNS / port cutover:** repoint the public hostname / router port-forward `:4000` from
    `192.168.50.211` (Windows) to the Fedora box's IP. Confirm `https://mu.ryanweiss.net:4000/`
    externally returns 200 and plays.
18. **Update repo + CLAUDE.md:** point `deploy-remote.sh` defaults (`MU_REMOTE_HOST`,
    `MU_REMOTE_PATH`) at the Fedora box; rewrite CLAUDE.md "Production Server" + "Gotchas" sections
    (drop Session-0/NSSM/schtasks/`C:/ffmpeg`/`taskkill`; add systemd, RPM Fusion ffmpeg, group
    membership). Remove the now-obsolete `prod-runs-via-interactive-session-launcher` memory.
19. **Set up CI** (§7b) if desired.
20. **Decommission Windows:** disable the Task Scheduler "Mu Server" task, confirm nothing on the
    LAN still hits the old box, keep it powered down for a rollback window (see below), then retire.

### Rollback path

- **Before DNS cutover (steps ≤16):** trivial — the Windows box is still live and serving. Just stop
  validating the Fedora box; nothing changed for users.
- **After DNS/port cutover (step 17+):** re-point DNS/port-forward back to `192.168.50.211` and
  re-enable the Windows Task Scheduler task / `start-mu.cmd`. Because we **copied** (not moved) the
  data, the Windows box's `D:\.mu_data` is intact and a few minutes/hours stale at worst. Keep the
  Windows box powered for ~1 week post-cutover as the rollback anchor before wiping it.
- **Data divergence caveat:** any movies watched / scanned on Fedora after cutover won't be in the
  Windows DB. For a clean rollback within the window, optionally rsync the Fedora DB back. Document
  the cutover timestamp so you know how much would be lost.

---

## 9. Open questions / risks

- **NVENC session-count cap (consumer GPUs).** GeForce cards historically limit simultaneous NVENC
  encode sessions (3, then 5, then 8 on newer drivers; Quadro/RTX-pro are unrestricted). If multiple
  users transcode at once, you can hit "OpenEncodeSessionEx failed". The (community) `nvidia-patch`
  removes the cap; otherwise plan around it or cap concurrent transcodes server-side. **Verify the
  actual limit for the specific card before relying on heavy concurrency.**
- **AV1 NVENC requires Ada/Lovelace (RTX 40-series+).** Turing/Ampere (20/30-series) have NVENC for
  H.264/HEVC but **no AV1 encode**. The `convertHevcToAv1` feature (`conversion.service.ts:156`,
  `transcoder.service.ts:562 av1_nvenc`) only works on 40-series. On older cards, leave
  `convertHevcToAv1` off — confirm with the §3f step-3 av1_nvenc smoke test.
- **GeForce vs Quadro/RTX-pro.** Beyond session caps, both work for our needs; the encoder feature
  set (AV1) tracks the GPU *generation*, not the consumer/pro split.
- **akmod rebuilds on `dnf update`.** A kernel bump triggers an akmod rebuild of the NVIDIA module.
  If you reboot before the rebuild finishes, NVENC (and X) break until it builds. After any update
  that touches the kernel: `sudo akmods --force && sudo dracut --force`, confirm
  `modinfo nvidia` matches the running kernel, *then* reboot. The `system-fix` skill can audit this.
- **Data migration of `D:\.mu_data`.** Two real hazards:
  1. **SQLite consistency** — copy with the server stopped (or include `-wal`/`-shm`), or the DB may
     be mid-transaction. Discard `cache/streams` and let it rebuild rather than copying GBs of HLS.
  2. **Windows absolute paths stored in the DB** — `movie_files` rows (and library source rows) hold
     paths like `D:\Movies\...` or `C:/...`. These are **not valid on Linux** and there is no code
     that rewrites them. Either (a) re-scan the libraries fresh on Linux against the new mount paths
     (cleanest — drops/rebuilds file rows), or (b) write a one-off SQL/script to rewrite the path
     prefixes (`D:\Movies` → `/srv/media/movies`, backslashes → forward slashes). This is the single
     most likely thing to break playback after a DB copy — budget time for a path-fixup script or a
     full rescan.
- **`hwAccelBroken` carried in the copied settings.** Covered in §4 — clear it once. If you forget,
  symptom is "everything works but it's all software encoding / high CPU".
- **Sudoers for `systemctl restart mu`.** The deploy/CI user needs a NOPASSWD rule (§6). Without it
  `deploy.sh` hangs on a password prompt. Scope it narrowly to the exact `systemctl` invocations.
- **Port 4000 + TLS via Certbot.** Cert issuance for a hostname on a non-standard port needs DNS-01
  or a temporary `:80` HTTP-01 challenge — the cert itself is port-agnostic, but the *challenge*
  isn't served on 4000. Plan the challenge method before step 15.
- **Optional code follow-ups (not blockers):** enable `-hwaccel cuda` decode on Linux
  (`transcoder.service.ts:1885`, `thumbnail.service.ts:251`); remove dead `nssm-stdout/stderr` log
  keys (`logs.controller.ts:11-12`); update `install.sh` to enable RPM Fusion before ffmpeg, prefer
  `dnf swap ffmpeg-free ffmpeg`, and emit the richer `mu.service` unit with `SupplementaryGroups`.
```

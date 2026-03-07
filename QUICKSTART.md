# Mu -- Quickstart Guide

Get Mu running on a fresh machine in under 10 minutes.

---

## Prerequisites

| Dependency | Version | Check |
|-----------|---------|-------|
| Node.js | 20+ | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| FFmpeg | 5+ | `ffmpeg -version` |
| Git | any | `git --version` |

### Install prerequisites (if missing)

**Ubuntu / Debian:**
```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
corepack enable pnpm

# FFmpeg
sudo apt-get install -y ffmpeg

# Git
sudo apt-get install -y git
```

**Fedora / RHEL:**
```bash
sudo dnf install -y nodejs ffmpeg git
corepack enable pnpm
```

**macOS:**
```bash
brew install node@20 ffmpeg git
corepack enable pnpm
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm ffmpeg git
corepack enable pnpm
```

---

## Option A: Quick Install Script

```bash
curl -fsSL https://get.mu.app/install | bash
```

This handles everything: installs dependencies, downloads Mu, sets up the database, creates a systemd service, and starts the server.

Skip to [First-Run Setup](#first-run-setup) below.

---

## Option B: Manual Install

### 1. Clone the repository

```bash
git clone https://github.com/your-org/mu.git
cd mu
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Build all packages

```bash
pnpm build
```

This builds the shared types, server, client, and plugins.

### 4. Run database migrations

```bash
pnpm db:migrate
```

Creates the SQLite database at `data/db/mu.db` with all required tables.

### 5. Start the server

```bash
pnpm start
```

Mu starts on `http://localhost:8080` by default.

---

## Option C: Docker

### 1. Clone and build

```bash
git clone https://github.com/your-org/mu.git
cd mu
```

### 2. Configure `docker-compose.yml`

Edit `docker/docker-compose.yml` to set your movie directory and API keys:

```yaml
services:
  mu:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - mu-data:/app/data
      - /path/to/your/movies:/media/movies:ro    # <-- Your movie folder
    environment:
      - MU_AUTH_JWT_SECRET=replace-with-random-64-char-string
      - MU_AUTH_COOKIE_SECRET=replace-with-random-64-char-string
      - MU_THIRD_PARTY_TMDB_API_KEY=your_tmdb_key  # Optional but recommended

volumes:
  mu-data:
```

### 3. Start

```bash
docker compose -f docker/docker-compose.yml up -d
```

---

## First-Run Setup

1. **Open** `http://localhost:8080` in your browser (or `http://<server-ip>:8080` from another device).

2. **Create admin account**: You'll be redirected to the setup wizard. Enter a username, email, and password for the admin account.

3. **Add a media directory**: Go to **Settings > Library & Scanning** and add the path to your movie folder (e.g., `/home/user/Movies` or `/media/movies` if using Docker).

4. **(Optional) Add TMDB API key**: Go to **Settings > API Keys** and enter your TMDB API key for automatic metadata fetching.
   - Get a free key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
   - Without a key, movies will show filename-parsed titles only (no posters, cast, or ratings).

5. **Trigger a scan**: Go to **Settings > Library & Scanning** and click "Scan Now", or wait for the automatic scan (runs on startup if `scanOnStartup` is enabled).

6. **Browse your library** at the Library page. Movies should appear with posters and metadata (if TMDB key was configured).

---

## Getting a TMDB API Key (Recommended)

TMDB provides movie metadata for free. To get an API key:

1. Create an account at [themoviedb.org](https://www.themoviedb.org/signup)
2. Go to [Settings > API](https://www.themoviedb.org/settings/api)
3. Request an API key (select "Developer" use)
4. Copy the **API Read Access Token** (v4 auth) or the **API Key** (v3 auth)
5. Enter it in Mu: **Settings > API Keys > TMDB**

---

## Development Mode

For local development with hot reload:

```bash
# Start both server and client in dev mode
pnpm dev
```

- Client dev server: `http://localhost:3000` (Vite, with HMR)
- API server: `http://localhost:8080` (NestJS, with file watching)
- Vite proxies `/api` and `/ws` requests to the NestJS server automatically.

---

## Configuration

### Config file

On first start, Mu generates `data/config/config.yml` with default settings and random auth secrets. Edit this file to change server settings:

```bash
# View config
cat data/config/config.yml

# Edit config
nano data/config/config.yml
# Then restart the server
```

### Environment variables

Override any config value with an environment variable prefixed with `MU_`:

```bash
# Example: change port and add TMDB key
MU_SERVER_PORT=3000 MU_THIRD_PARTY_TMDB_API_KEY=abc123 pnpm start
```

### Common configuration tasks

**Change the server port:**
```bash
export MU_SERVER_PORT=9090
# or edit config.yml: server.port: 9090
```

**Enable hardware-accelerated transcoding (NVIDIA):**
```bash
export MU_TRANSCODING_HW_ACCEL=nvenc
# Requires NVIDIA drivers and ffmpeg built with nvenc support
```

**Switch to PostgreSQL:**
```bash
export MU_DATABASE_TYPE=postgres
export MU_DATABASE_POSTGRES_URL=postgresql://user:pass@localhost:5432/mu
```

**Add Redis cache:**
```bash
export MU_CACHE_TYPE=redis
export MU_CACHE_REDIS_URL=redis://localhost:6379
```

**Skip login for local access (enabled by default):**
```yaml
# config.yml
auth:
  localBypass: true   # No login needed from localhost
```

---

## Running as a System Service

### systemd (Linux)

Create `/etc/systemd/system/mu.service`:

```ini
[Unit]
Description=Mu Movie Platform
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/mu
ExecStart=/usr/bin/node packages/server/dist/main.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=MU_DATA_DIR=/path/to/mu/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable mu
sudo systemctl start mu

# Check status
sudo systemctl status mu

# View logs
journalctl -u mu -f
```

### launchd (macOS)

Create `~/Library/LaunchAgents/app.mu.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>app.mu</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/mu/packages/server/dist/main.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/mu</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/app.mu.plist
```

---

## Remote Access

### Local network

Mu binds to `0.0.0.0:8080` by default, so any device on your local network can access it at `http://<server-ip>:8080`.

Find your server's IP:
```bash
hostname -I          # Linux
ipconfig getifaddr en0  # macOS
```

### Remote access (over the internet)

For access outside your local network, you have several options:

**Option 1: Reverse proxy with HTTPS (recommended)**

Use Nginx or Caddy as a reverse proxy with a domain name and SSL certificate.

Caddy example (`/etc/caddy/Caddyfile`):
```
movies.yourdomain.com {
    reverse_proxy localhost:8080
}
```

Caddy automatically provisions HTTPS via Let's Encrypt.

**Option 2: Tailscale / WireGuard**

Install [Tailscale](https://tailscale.com/) on both the server and your devices for a private, encrypted tunnel without port forwarding.

**Option 3: Port forwarding**

Forward port 8080 on your router to your server. Not recommended without HTTPS.

---

## Troubleshooting

### Server won't start

```bash
# Check Node.js version (need 20+)
node --version

# Check FFmpeg is installed
ffmpeg -version

# Check for port conflicts
lsof -i :8080

# Start with debug logging
MU_SERVER_LOG_LEVEL=debug pnpm start
```

### Movies not appearing after scan

- Verify the media directory path is correct and readable by the Mu process
- Check file extensions are in the supported list (`.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`, `.webm`, `.m4v`, `.ts`)
- Check server logs for scan errors: **Admin > System Logs**
- Try a manual scan: **Settings > Library & Scanning > Scan Now**

### Metadata not loading

- Verify TMDB API key is set in **Settings > API Keys**
- Check API key is valid (the settings page validates on save)
- Check server logs for API errors (rate limiting, network issues)
- Try manually refreshing metadata on a movie: **Movie Detail > Refresh Metadata**

### Video won't play / buffering

- Check FFmpeg is installed and accessible: `ffmpeg -version`
- For hardware acceleration, verify drivers are installed:
  - NVIDIA: `nvidia-smi` should work
  - Intel QSV: `/dev/dri/renderD128` should exist
- Reduce quality: **Player > Quality > 720p or 480p**
- Check available disk space for transcoding temp files in `data/cache/streams/`
- Check max concurrent streams setting vs current active streams

### Can't connect remotely

- Verify server is binding to `0.0.0.0` (not `127.0.0.1`)
- Check firewall: `sudo ufw status` (Ubuntu) or `sudo firewall-cmd --list-all` (Fedora)
- Allow port: `sudo ufw allow 8080` or `sudo firewall-cmd --add-port=8080/tcp --permanent`
- If using Docker, ensure port is mapped in docker-compose.yml

---

## Updating

### Manual update

```bash
cd /path/to/mu
git pull
pnpm install
pnpm build
pnpm db:migrate    # Apply any new migrations
# Restart the server
sudo systemctl restart mu
```

### Docker update

```bash
cd /path/to/mu
git pull
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d
```

---

## Backup & Restore

### Backup

The only critical file is the SQLite database and your config:

```bash
cp data/db/mu.db data/db/mu.db.backup
cp data/config/config.yml data/config/config.yml.backup
```

### Restore

```bash
cp data/db/mu.db.backup data/db/mu.db
cp data/config/config.yml.backup data/config/config.yml
# Restart
sudo systemctl restart mu
```

Cached images and transcoding segments do not need backup -- they are regenerated automatically.

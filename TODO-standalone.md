# Standalone Client & Native App Build

## Current State

The client can be built as a standalone web app pointing to any backend server:

```bash
# Set server URL
echo 'VITE_API_URL=https://your-server.com/api/v1' > src/packages/client/.env.standalone

# Build standalone
cd src && pnpm build:standalone
```

The output `packages/client/dist/` is a complete web app (index.html + JS/CSS + PWA manifest).

**Runtime override** (no rebuild needed):
```js
localStorage.setItem('mu_api_url', 'https://your-server.com/api/v1');
```

---

## TODO: Server-Side CORS for Standalone Clients

When the client runs on a different origin than the server, CORS must allow it.

- [ ] Add a `server.corsOrigins` config option (array of allowed origins)
- [ ] Support wildcard `*` for development
- [ ] The server already uses `@fastify/cors` — update the config to accept external origins
- [ ] Add `Access-Control-Allow-Credentials: true` for cookie-based auth
- [ ] Consider switching to `Authorization: Bearer` header-only auth for standalone clients (no cookies)

---

## TODO: Tauri Desktop App

[Tauri](https://tauri.app/) wraps the web app in a native OS WebView (~5MB binary vs Electron's ~100MB).

### Setup Steps

1. **Install Tauri CLI**
   ```bash
   cargo install tauri-cli
   # Or via npm:
   npm install -g @tauri-apps/cli
   ```

2. **Initialize Tauri in the project**
   ```bash
   cd src/packages/client
   npx tauri init
   ```
   - Set `distDir` to `../dist`
   - Set `devPath` to `http://localhost:3000` (Vite dev server)
   - Set `beforeBuildCommand` to `pnpm build:standalone`

3. **Configure `tauri.conf.json`**
   ```json
   {
     "build": {
       "distDir": "../dist",
       "devPath": "http://localhost:3000",
       "beforeBuildCommand": "pnpm build:standalone"
     },
     "package": {
       "productName": "Mu",
       "version": "0.1.0"
     },
     "tauri": {
       "windows": [{
         "title": "Mu",
         "width": 1280,
         "height": 800,
         "minWidth": 800,
         "minHeight": 600,
         "fullscreen": false,
         "resizable": true
       }],
       "bundle": {
         "identifier": "net.ryanweiss.mu",
         "icon": ["icons/icon.png"]
       },
       "allowlist": {
         "all": false,
         "shell": { "open": true }
       }
     }
   }
   ```

4. **Add server URL prompt on first launch**
   - On first open, if no `mu_api_url` in localStorage, show a connection dialog
   - User enters their server URL (e.g., `https://mu.example.com`)
   - Save to localStorage, reload

5. **Build for each platform**
   ```bash
   # macOS
   npx tauri build --target universal-apple-darwin

   # Windows
   npx tauri build --target x86_64-pc-windows-msvc

   # Linux
   npx tauri build --target x86_64-unknown-linux-gnu
   ```

   Output: `.dmg` (macOS), `.msi`/`.exe` (Windows), `.deb`/`.AppImage` (Linux)

### Tauri Prerequisites
- **Rust** toolchain (rustup.rs)
- **macOS**: Xcode Command Line Tools
- **Windows**: Visual Studio Build Tools, WebView2
- **Linux**: `libwebkit2gtk-4.0-dev`, `libssl-dev`, `libgtk-3-dev`

---

## TODO: Capacitor Mobile App

[Capacitor](https://capacitorjs.com/) wraps the web app for iOS and Android.

### Setup Steps

1. **Install Capacitor**
   ```bash
   cd src/packages/client
   npm install @capacitor/core @capacitor/cli
   npx cap init "Mu" "net.ryanweiss.mu" --web-dir dist
   ```

2. **Add platforms**
   ```bash
   npx cap add ios
   npx cap add android
   ```

3. **Build and sync**
   ```bash
   pnpm build:standalone
   npx cap sync
   ```

4. **Open in IDE**
   ```bash
   npx cap open ios      # Opens Xcode
   npx cap open android  # Opens Android Studio
   ```

5. **Server URL configuration**
   - Same localStorage approach as Tauri
   - Show connection dialog on first launch
   - Save server URL persistently

### Capacitor Prerequisites
- **iOS**: macOS + Xcode 14+
- **Android**: Android Studio + SDK

---

## TODO: Electron Desktop App (Alternative to Tauri)

Heavier (~100MB) but easier setup, no Rust required.

1. **Install Electron**
   ```bash
   npm install electron electron-builder --save-dev
   ```

2. **Create `electron/main.js`**
   ```js
   const { app, BrowserWindow } = require('electron');
   const path = require('path');

   app.whenReady().then(() => {
     const win = new BrowserWindow({
       width: 1280, height: 800,
       webPreferences: { nodeIntegration: false, contextIsolation: true }
     });
     win.loadFile(path.join(__dirname, '../dist/index.html'));
   });
   ```

3. **Build**
   ```bash
   npx electron-builder --win --mac --linux
   ```

---

## TODO: PWA Improvements

The app already works as a PWA. Improvements to consider:

- [ ] Add service worker for offline caching of the app shell
- [ ] Add `beforeinstallprompt` handler to show custom install banner
- [ ] Cache API responses for offline browsing of library metadata
- [ ] Add push notifications for transcode completion
- [ ] Improve manifest with screenshots and categories

---

## TODO: Connection Manager Component

For standalone/native builds, create a "Connect to Server" UI:

- [ ] First-launch screen: enter server URL + test connection
- [ ] Settings > General: change server URL
- [ ] Connection status indicator in the header/sidebar
- [ ] Auto-reconnect with exponential backoff
- [ ] Multiple saved servers (switch between them)
- [ ] QR code scanner for easy server connection (mobile)

---

## Recommended Implementation Order

1. CORS configuration on server
2. Connection Manager component (first-launch dialog)
3. Tauri setup (desktop builds)
4. PWA improvements (service worker)
5. Capacitor setup (mobile builds)
6. Electron setup (alternative desktop, only if Tauri has issues)

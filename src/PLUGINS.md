# Plugin System

Mu supports a plugin architecture with both server-side API endpoints and client-side UI rendering. Plugins live in the `plugins/` directory at the workspace root.

## Directory Structure

```
plugins/
  example-info/
    manifest.json       # Plugin metadata
    package.json        # Package definition
    index.ts            # Server-side plugin (API endpoints, lifecycle hooks)
    client/
      index.tsx         # Client-side plugin (UI slot renderers)
      example-info-api.ts  # Generated API client (optional)
```

## Creating a Plugin

### Scaffolding

```bash
pnpm plugin:generate my-plugin
```

This creates the full plugin skeleton with server-side and client-side entry points, manifest, and package.json.

### Manifest

`manifest.json` defines the plugin metadata:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "version": "0.1.0",
  "description": "Description of my plugin",
  "author": "Author",
  "entryPoint": "index.ts",
  "clientEntry": "client/index.tsx",
  "permissions": ["read:movies"]
}
```

## Server-Side Plugin

The server entry point (`index.ts`) exports a default class with lifecycle hooks:

```ts
import type { PluginContext, PluginInfo } from '../../packages/server/src/plugins/plugin.interface.js';

export default class MyPlugin {
  private context!: PluginContext;

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context;

    // Register API endpoints
    context.api.registerEndpoint({
      methodName: 'getData',
      method: 'GET',
      path: '/data/:id',
      handler: async ({ params }) => {
        return { id: params.id, value: 'hello' };
      },
      schema: {
        params: { id: 'string' },
        response: { id: {}, value: {} },
      },
    });
  }

  async onUnload(): Promise<void> {}
  getInfo(): PluginInfo { /* ... */ }

  // Optional lifecycle hooks:
  async onInstall?(context: PluginContext): Promise<void> {}
  async onUninstall?(context: PluginContext): Promise<void> {}
  async onEnable?(context: PluginContext): Promise<void> {}
  async onDisable?(context: PluginContext): Promise<void> {}
}
```

### Plugin API Endpoints

Registered endpoints are served at `/api/plugins/:pluginName/api/*`. For example, a plugin named `my-plugin` with path `/data/:id` is accessible at:

```
GET /api/plugins/my-plugin/api/data/123
```

### Schema Endpoint

Each plugin's API schema is available at `GET /api/plugins/:name/schema`, returning all registered endpoints and their parameter types. Use this for client code generation:

```bash
pnpm plugin:generate-client-api my-plugin
```

## Client-Side Plugin

The client entry point (`client/index.tsx`) exports a default class implementing `IPluginClient`:

```tsx
import { h } from 'preact';
import { UI } from '@/plugins/ui-slots';
import type { IPluginClient, PluginClientContext } from '@/plugins/plugin-client.interface';

export default class MyPluginClient implements IPluginClient {
  onLoad(context: PluginClientContext): void {
    // Register UI renderers for any available slot
    context.slots.register(UI.INFO_PANEL, ({ movie }) => {
      if (!movie) return null;
      return <div>Custom content for {movie.title}</div>;
    });
  }

  onUnload(): void {}
}
```

### Plugin Client Context

The `PluginClientContext` provides:

- **`pluginName`** — The plugin's identifier
- **`slots.register(slotName, renderer, priority?)`** — Register a renderer for a UI slot. Lower priority values render first (default: 100).
- **`api.get/post/put/delete(path, ...)`** — Scoped API client for the plugin's server-side endpoints (automatically prefixed with `/plugins/:name/api`)

### Imports

Plugin client code is processed by Vite and has access to the same path aliases as the main app:

- `@/` — resolves to `packages/client/src/` (components, services, state, hooks, etc.)
- `@mu/shared` — resolves to `packages/shared/src/`

```tsx
import { Button } from '@/components/common/Button';
import { UI } from '@/plugins/ui-slots';
import type { IPluginClient, PluginClientContext } from '@/plugins/plugin-client.interface';
```

### Build-Time Discovery

Plugin client modules are discovered at build time via Vite's `import.meta.glob`. Any plugin with a `client/index.ts` or `client/index.tsx` file is automatically picked up. Only enabled plugins are loaded at runtime.

## UI Slots

Plugins inject content into the app by registering renderers for named UI slots. All valid slot names are defined in the `UI` enum at `packages/client/src/plugins/ui-slots.ts`.

### Available Slots

#### Player

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.INFO_PANEL` | Player info panel flyout | `{ movie }` | Appended after the core movie info (poster, ratings, cast) in the player's side panel |
| `UI.PLAYER_BUTTON` | Player control bar, right side | `{}` | Custom buttons rendered before system buttons (info, volume, settings, fullscreen) |

#### Movie Detail Page

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.MOVIE_PAGE_RATING` | Ratings section | `{ movie }` | Custom ratings rendered alongside the user rating and external ratings (IMDb, RT, Metacritic) |
| `UI.MOVIE_PAGE_CONTENT` | Bottom of page | `{ movie }` | Custom sections rendered after the management tools |

#### Movie Cards & List Items

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.MOVIE_ITEM_RATING` | Rating area | `{ movie }` | Custom rating badges or indicators on MovieCard, MovieLargeCard, and MovieListItem components |

#### Dashboard

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.DASHBOARD_TOP` | Top of dashboard | `{}` | Custom content before the hero section and all movie sections |
| `UI.DASHBOARD_BOTTOM` | Bottom of dashboard | `{}` | Custom content after all movie sections (Continue Watching, Recently Added, Trending) |

#### Library

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.LIBRARY_TOOLBAR` | Below toolbar/filters | `{}` | Custom controls or content between the toolbar and the movie grid |
| `UI.LIBRARY_BOTTOM` | Bottom of page | `{}` | Custom content after the movie grid and pagination |

#### History

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.HISTORY_BOTTOM` | Bottom of page | `{}` | Custom content after the watch history grid |

#### Playlists

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.PLAYLISTS_BOTTOM` | Bottom of page | `{}` | Custom content after the playlists grid/list |
| `UI.PLAYLIST_DETAIL_BOTTOM` | Playlist detail, bottom | `{ playlist }` | Custom content after the movie list on a specific playlist's page |

#### Settings

| Slot | Location | Context | Description |
|------|----------|---------|-------------|
| `UI.SETTINGS_BOTTOM` | Bottom of settings | `{}` | Custom settings sections at the bottom of the settings page |

### Slot Render Context

Each slot renderer receives a `SlotRenderContext` object with data relevant to its location:

```ts
interface SlotRenderContext {
  movie?: {
    id: string;
    title: string;
    year?: number;
    overview?: string;
    posterUrl?: string;
    rating?: number;
    imdbRating?: number;
    rtRating?: number;
    metacriticRating?: number;
    [key: string]: unknown;
  };
  playlist?: {
    id: string;
    name: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
```

### Validation

The slot manager validates slot names at registration time. If a plugin tries to register an unknown slot name, a console warning is logged and the registration is ignored. Only names from the `UI` enum are accepted.

### Priority

Multiple plugins can register for the same slot. The `priority` parameter (default: 100) controls render order — lower values render first:

```tsx
context.slots.register(UI.DASHBOARD_TOP, myRenderer, 50);  // renders before default
context.slots.register(UI.DASHBOARD_TOP, otherRenderer, 200); // renders after default
```

## Plugin Lifecycle

1. **Install** — `POST /api/plugins/:name/install` — Creates DB record, calls `onInstall()`
2. **Enable** — `POST /api/plugins/:name/enable` — Loads the plugin, calls `onLoad()` then `onEnable()`. Client module is loaded and `onLoad()` is called.
3. **Disable** — `POST /api/plugins/:name/disable` — Calls `onDisable()` then `onUnload()`. Client module's `onUnload()` is called and all slot registrations are removed.
4. **Uninstall** — `POST /api/plugins/:name/uninstall` — Calls `onUninstall()`, unloads, removes DB record.

## Example Plugin

The `example-info` plugin demonstrates the full system:

- **Server**: Registers a `GET /trivia/:movieId` endpoint
- **Client**: Registers an `INFO_PANEL` slot renderer that shows movie info with a "See more" button that calls the server endpoint
- Uses the app's `<Button>` component via `@/components/common/Button`

## Administration

Plugins are managed through the Settings page in the Plugins section. Admins can:

- View all discovered plugins and their status
- Install/uninstall plugins
- Enable/disable plugins
- Plugin state changes take effect immediately — client UI updates without page reload

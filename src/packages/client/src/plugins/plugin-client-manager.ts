import { signal } from '@preact/signals';
import { api } from '@/services/api';
import { pluginsService, type PluginInfo } from '@/services/plugins.service';
import type { IPluginClient, PluginClientContext } from './plugin-client.interface';
import { pluginSlotManager } from './plugin-slot-manager';

/**
 * Discovers plugin client modules using Vite's import.meta.glob.
 * Each plugin must have a `client/index.tsx` (or .ts) in the plugins directory.
 * The glob returns lazy importers keyed by file path.
 */
const pluginClientModules = import.meta.glob<{ default: new () => IPluginClient }>(
	'../../../../plugins/*/client/index.{ts,tsx}',
);

/**
 * Extract plugin name from a glob path like "../../../../plugins/example-info/client/index.tsx"
 */
function extractPluginName(globPath: string): string | null {
	const match = globPath.match(/\/plugins\/([^/]+)\/client\/index\./);
	return match?.[1] ?? null;
}

/**
 * Build a map of pluginName -> lazy importer from the glob results.
 */
function buildPluginRegistry(): Map<string, () => Promise<{ default: new () => IPluginClient }>> {
	const registry = new Map<string, () => Promise<{ default: new () => IPluginClient }>>();
	for (const [path, importer] of Object.entries(pluginClientModules)) {
		const name = extractPluginName(path);
		if (name) {
			registry.set(name, importer);
		}
	}
	return registry;
}

/**
 * Create the context object passed to a plugin client during initialization.
 */
function createClientContext(pluginName: string): PluginClientContext {
	const basePath = `/plugins/${pluginName}/api`;

	return {
		pluginName,
		slots: {
			register(slotName, renderer, priority?) {
				pluginSlotManager.register(pluginName, slotName, renderer, priority);
			},
		},
		api: {
			get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
				return api.get<T>(`${basePath}${path}`, params);
			},
			post<T = unknown>(path: string, body?: unknown): Promise<T> {
				return api.post<T>(`${basePath}${path}`, body);
			},
			put<T = unknown>(path: string, body?: unknown): Promise<T> {
				return api.put<T>(`${basePath}${path}`, body);
			},
			delete<T = unknown>(path: string): Promise<T> {
				return api.delete<T>(`${basePath}${path}`);
			},
		},
	};
}

interface LoadedClientPlugin {
	instance: IPluginClient;
	info: PluginInfo;
}

/**
 * Client-side plugin manager.
 * Discovers available plugin client modules at build time via import.meta.glob,
 * fetches the list of enabled plugins from the server, and initializes the
 * enabled plugin clients.
 */
class PluginClientManager {
	private loadedClients = new Map<string, LoadedClientPlugin>();
	private registry = buildPluginRegistry();

	/** Signal to track initialization state */
	readonly initialized = signal(false);

	/**
	 * Initialize all enabled plugins.
	 * Called once during app startup after authentication is established.
	 */
	async initialize(): Promise<void> {
		try {
			const allPlugins = await pluginsService.list();
			const enabled = allPlugins.filter((p) => p.enabled);

			for (const plugin of enabled) {
				await this.loadClient(plugin);
			}
		} catch (err) {
			console.error('Failed to initialize plugin clients:', err);
		} finally {
			this.initialized.value = true;
		}
	}

	/**
	 * Load a single plugin client. Called when a plugin is enabled at runtime.
	 */
	async loadClient(plugin: PluginInfo): Promise<void> {
		if (this.loadedClients.has(plugin.name)) return;

		const importer = this.registry.get(plugin.name);
		if (!importer) {
			// Plugin has no client-side code — that's OK
			return;
		}

		try {
			const module = await importer();
			const ClientClass = module.default;
			const instance = new ClientClass();
			const context = createClientContext(plugin.name);
			await instance.onLoad(context);
			this.loadedClients.set(plugin.name, { instance, info: plugin });
			console.log(`Plugin client "${plugin.name}" loaded`);
		} catch (err) {
			console.error(`Failed to load plugin client "${plugin.name}":`, err);
		}
	}

	/**
	 * Unload a single plugin client. Called when a plugin is disabled at runtime.
	 */
	unloadClient(pluginName: string): void {
		const loaded = this.loadedClients.get(pluginName);
		if (!loaded) return;

		try {
			loaded.instance.onUnload?.();
		} catch (err) {
			console.error(`Error unloading plugin client "${pluginName}":`, err);
		}

		pluginSlotManager.unregisterAll(pluginName);
		this.loadedClients.delete(pluginName);
		console.log(`Plugin client "${pluginName}" unloaded`);
	}

	/**
	 * Reload all plugin clients (e.g. after enable/disable changes).
	 */
	async reload(): Promise<void> {
		// Unload all current clients
		for (const [name] of this.loadedClients) {
			this.unloadClient(name);
		}
		// Re-initialize
		await this.initialize();
	}

	getLoadedPlugins(): string[] {
		return [...this.loadedClients.keys()];
	}
}

export const pluginClientManager = new PluginClientManager();

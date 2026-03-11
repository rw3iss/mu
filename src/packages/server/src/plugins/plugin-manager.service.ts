import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nowISO } from '@mu/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { transformSync } from 'esbuild';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { plugins } from '../database/schema/index.js';
import type {
	IPlugin,
	PluginContext,
	PluginInfo,
	PluginManifest,
	PluginPermission,
	PluginSettingDefinition,
	PluginStatus,
} from './plugin.interface.js';
import { PluginApiRegistryService } from './plugin-api-registry.service.js';
import { PluginContextFactory } from './plugin-context.factory.js';

interface LoadedPlugin {
	instance: IPlugin;
	manifest: PluginManifest;
	directory: string;
	context: PluginContext;
}

@Injectable()
export class PluginManagerService {
	private readonly logger = new Logger('PluginManager');
	private readonly activePlugins = new Map<string, LoadedPlugin>();
	private readonly pluginsDir: string;

	constructor(
		private readonly database: DatabaseService,
		private readonly config: ConfigService,
		private readonly contextFactory: PluginContextFactory,
		private readonly apiRegistry: PluginApiRegistryService,
	) {
		const configDir = this.config.get<string>('plugins.directory', './plugins');
		const resolved = resolve(configDir);

		if (existsSync(resolved)) {
			this.pluginsDir = resolved;
		} else {
			// Fallback: resolve from this file's location up to monorepo root /plugins
			const fallback = join(import.meta.dirname, '..', '..', '..', '..', 'plugins');
			this.pluginsDir = existsSync(fallback) ? fallback : resolved;
		}
	}

	async loadPlugin(pluginDir: string): Promise<void> {
		const manifestPath = join(pluginDir, 'manifest.json');

		if (!existsSync(manifestPath)) {
			throw new Error(`Plugin manifest not found: ${manifestPath}`);
		}

		const manifestRaw = readFileSync(manifestPath, 'utf-8');
		const manifest = JSON.parse(manifestRaw) as PluginManifest;

		this.validateManifest(manifest);

		if (this.activePlugins.has(manifest.name)) {
			this.logger.warn(`Plugin "${manifest.name}" is already loaded, skipping`);
			return;
		}

		const entryPointPath = join(pluginDir, manifest.entryPoint);

		if (!existsSync(entryPointPath)) {
			throw new Error(`Plugin entry point not found: ${entryPointPath}`);
		}

		this.logger.log(`Loading plugin "${manifest.name}" from ${entryPointPath}...`);

		const pluginModule: any = await this.importPluginModule(entryPointPath);
		const PluginClass = pluginModule.default ?? pluginModule;

		let pluginInstance: IPlugin;
		if (typeof PluginClass === 'function') {
			pluginInstance = new PluginClass();
		} else if (typeof PluginClass === 'object' && PluginClass !== null) {
			pluginInstance = PluginClass as IPlugin;
		} else {
			throw new Error(
				`Plugin "${manifest.name}" does not export a valid plugin class or object`,
			);
		}

		const context = await this.contextFactory.createContext(manifest.name);

		this.logger.log(`Calling onLoad for plugin "${manifest.name}"...`);
		await pluginInstance.onLoad(context);

		this.activePlugins.set(manifest.name, {
			instance: pluginInstance,
			manifest,
			directory: pluginDir,
			context,
		});

		await this.upsertPluginRecord(manifest, true);

		// Log registered endpoints for this plugin
		const endpoints = this.apiRegistry.getEndpoints(manifest.name);
		this.logger.log(
			`Plugin "${manifest.name}" v${manifest.version} loaded successfully (${endpoints.length} API endpoint(s) registered)`,
		);
	}

	async unloadPlugin(name: string): Promise<void> {
		const loaded = this.activePlugins.get(name);

		if (!loaded) {
			throw new Error(`Plugin "${name}" is not loaded`);
		}

		// Clean up API registry before unloading
		this.apiRegistry.unregisterAll(name);

		await loaded.instance.onUnload();
		this.activePlugins.delete(name);

		await this.updatePluginStatus(name, false);

		this.logger.log(`Plugin "${name}" unloaded`);
	}

	getLoadedPlugins(): PluginInfo[] {
		const result: PluginInfo[] = [];

		for (const [, loaded] of this.activePlugins) {
			result.push({
				name: loaded.manifest.name,
				displayName: loaded.manifest.displayName,
				version: loaded.manifest.version,
				description: loaded.manifest.description,
				author: loaded.manifest.author,
				enabled: true,
				loaded: true,
				status: 'enabled',
				permissions: loaded.manifest.permissions,
				settings: loaded.manifest.settings,
				hasClientEntry: !!loaded.manifest.clientEntry,
			});
		}

		return result;
	}

	getPlugin(name: string): IPlugin | undefined {
		return this.activePlugins.get(name)?.instance;
	}

	async enablePlugin(name: string): Promise<void> {
		const discovered = await this.discoverPlugins();
		const manifest = discovered.find((m) => m.name === name);

		if (!manifest) {
			throw new Error(`Plugin "${name}" not found in plugins directory`);
		}

		const pluginDir = join(this.pluginsDir, name);
		await this.loadPlugin(pluginDir);

		const loaded = this.activePlugins.get(name);
		if (loaded) {
			// Call onInstall on first enable (deferred from installPlugin)
			if (loaded.instance.onInstall) {
				const dbRecord = this.database.db
					.select()
					.from(plugins)
					.where(eq(plugins.name, name))
					.get();
				if (dbRecord?.status === 'installed') {
					await loaded.instance.onInstall(loaded.context);
				}
			}
			// Call onEnable lifecycle hook
			if (loaded.instance.onEnable) {
				await loaded.instance.onEnable(loaded.context);
			}
		}
	}

	async disablePlugin(name: string): Promise<void> {
		// Call onDisable lifecycle hook before unloading
		const loaded = this.activePlugins.get(name);
		if (loaded?.instance.onDisable) {
			await loaded.instance.onDisable(loaded.context);
		}

		if (this.activePlugins.has(name)) {
			await this.unloadPlugin(name);
		}

		await this.updatePluginStatus(name, false);

		this.logger.log(`Plugin "${name}" disabled`);
	}

	async installPlugin(name: string): Promise<void> {
		const discovered = await this.discoverPlugins();
		const manifest = discovered.find((m) => m.name === name);

		if (!manifest) {
			throw new Error(`Plugin "${name}" not found in plugins directory`);
		}

		// Create DB record with status = 'installed'
		const now = nowISO();
		const existing = this.database.db
			.select()
			.from(plugins)
			.where(eq(plugins.name, name))
			.get();

		if (existing) {
			this.database.db
				.update(plugins)
				.set({
					version: manifest.version,
					status: 'installed',
					updatedAt: now,
				})
				.where(eq(plugins.name, name))
				.run();
		} else {
			this.database.db
				.insert(plugins)
				.values({
					id: crypto.randomUUID(),
					name,
					version: manifest.version,
					enabled: false,
					status: 'installed',
					settings: '{}',
					installedAt: now,
					updatedAt: now,
				})
				.run();
		}

		this.logger.log(`Plugin "${name}" installed (onInstall will run on first enable)`);
	}

	async uninstallPlugin(name: string): Promise<void> {
		const loaded = this.activePlugins.get(name);

		// Call onUninstall lifecycle hook
		if (loaded?.instance.onUninstall) {
			await loaded.instance.onUninstall(loaded.context);
		}

		// Unload if loaded
		if (this.activePlugins.has(name)) {
			await this.unloadPlugin(name);
		}

		// Clean up API registry
		this.apiRegistry.unregisterAll(name);

		// Remove DB record
		this.database.db.delete(plugins).where(eq(plugins.name, name)).run();

		this.logger.log(`Plugin "${name}" uninstalled`);
	}

	async discoverPlugins(): Promise<PluginManifest[]> {
		const manifests: PluginManifest[] = [];

		if (!existsSync(this.pluginsDir)) {
			this.logger.warn(`Plugins directory not found: ${this.pluginsDir}`);
			return manifests;
		}

		const entries = readdirSync(this.pluginsDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const manifestPath = join(this.pluginsDir, entry.name, 'manifest.json');

			if (!existsSync(manifestPath)) continue;

			try {
				const raw = readFileSync(manifestPath, 'utf-8');
				const manifest = JSON.parse(raw) as PluginManifest;
				this.validateManifest(manifest);
				manifests.push(manifest);
			} catch (err) {
				this.logger.warn(
					`Failed to read manifest for "${entry.name}": ${err instanceof Error ? err.message : err}`,
				);
			}
		}

		return manifests;
	}

	async getDiscoveredPluginsWithStatus(): Promise<PluginInfo[]> {
		const manifests = await this.discoverPlugins();
		const result: PluginInfo[] = [];

		for (const manifest of manifests) {
			const dbRecord = this.database.db
				.select()
				.from(plugins)
				.where(eq(plugins.name, manifest.name))
				.get();

			const isLoaded = this.activePlugins.has(manifest.name);
			const isEnabled = dbRecord?.enabled ?? false;

			let status: PluginStatus = 'not_installed';
			if (dbRecord?.status) {
				status = dbRecord.status as PluginStatus;
			} else if (isEnabled && isLoaded) {
				status = 'enabled';
			} else if (isEnabled) {
				status = 'installed';
			} else if (dbRecord) {
				status = 'disabled';
			}

			result.push({
				name: manifest.name,
				displayName: manifest.displayName,
				version: manifest.version,
				description: manifest.description,
				author: manifest.author,
				enabled: isEnabled,
				loaded: isLoaded,
				status,
				permissions: manifest.permissions,
				settings: manifest.settings,
				hasClientEntry: !!manifest.clientEntry,
			});
		}

		return result;
	}

	getPluginSettingDefinitions(name: string): PluginSettingDefinition[] {
		// Check loaded plugins first
		const loaded = this.activePlugins.get(name);
		if (loaded?.manifest.settings) {
			return loaded.manifest.settings;
		}

		// Fall back to reading manifest from disk
		const manifestPath = join(this.pluginsDir, name, 'manifest.json');
		if (existsSync(manifestPath)) {
			try {
				const raw = readFileSync(manifestPath, 'utf-8');
				const manifest = JSON.parse(raw) as PluginManifest;
				return manifest.settings ?? [];
			} catch {
				return [];
			}
		}

		return [];
	}

	async getPluginSettings(name: string): Promise<Record<string, unknown>> {
		const row = this.database.db.select().from(plugins).where(eq(plugins.name, name)).get();

		if (!row || !row.settings) {
			return {};
		}

		try {
			return JSON.parse(row.settings) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	async updatePluginSettings(name: string, settings: Record<string, unknown>): Promise<void> {
		const now = nowISO();
		const row = this.database.db.select().from(plugins).where(eq(plugins.name, name)).get();

		if (row) {
			this.database.db
				.update(plugins)
				.set({
					settings: JSON.stringify(settings),
					updatedAt: now,
				})
				.where(eq(plugins.name, name))
				.run();
		} else {
			this.database.db
				.insert(plugins)
				.values({
					id: crypto.randomUUID(),
					name,
					version: '0.0.0',
					enabled: false,
					settings: JSON.stringify(settings),
					installedAt: now,
					updatedAt: now,
				})
				.run();
		}

		// If the plugin is currently loaded, reload its context
		if (this.activePlugins.has(name)) {
			this.logger.log(
				`Settings updated for loaded plugin "${name}" — restart may be required`,
			);
		}
	}

	async loadEnabledPlugins(): Promise<void> {
		const enabledRows = this.database.db
			.select()
			.from(plugins)
			.where(eq(plugins.enabled, true))
			.all();

		this.logger.log(`Found ${enabledRows.length} enabled plugin(s) to load`);

		for (const row of enabledRows) {
			if (!row.name) continue;

			const pluginDir = join(this.pluginsDir, row.name);

			try {
				await this.loadPlugin(pluginDir);
			} catch (err) {
				this.logger.error(
					`Failed to auto-load plugin "${row.name}": ${err instanceof Error ? err.message : err}`,
				);
			}
		}
	}

	/**
	 * Import a plugin entry point, transpiling .ts files on-the-fly via esbuild.
	 * The compiled server runs as plain JS so Node.js cannot import .ts directly.
	 */
	private async importPluginModule(entryPointPath: string): Promise<Record<string, unknown>> {
		if (!entryPointPath.endsWith('.ts')) {
			return import(pathToFileURL(entryPointPath).href);
		}

		const source = readFileSync(entryPointPath, 'utf-8');
		const result = transformSync(source, {
			loader: 'ts',
			format: 'esm',
			target: 'node20',
			// Strip type-only imports entirely
			tsconfigRaw: '{"compilerOptions":{"verbatimModuleSyntax":true}}',
		});

		// Write to a temp .mjs file next to the original so relative imports still resolve
		const tmpPath = entryPointPath.replace(/\.ts$/, '.__compiled__.mjs');
		writeFileSync(tmpPath, result.code);

		try {
			// Cache-bust with a query param so re-enables get fresh code
			const url = `${pathToFileURL(tmpPath).href}?t=${Date.now()}`;
			return await import(url);
		} finally {
			// Clean up temp file
			try {
				const { unlinkSync } = await import('node:fs');
				unlinkSync(tmpPath);
			} catch {
				// ignore cleanup errors
			}
		}
	}

	private validateManifest(manifest: PluginManifest): void {
		if (!manifest.name || typeof manifest.name !== 'string') {
			throw new Error('Plugin manifest must have a valid "name" field');
		}

		if (!manifest.version || typeof manifest.version !== 'string') {
			throw new Error('Plugin manifest must have a valid "version" field');
		}

		if (!manifest.description || typeof manifest.description !== 'string') {
			throw new Error('Plugin manifest must have a valid "description" field');
		}

		if (!manifest.entryPoint || typeof manifest.entryPoint !== 'string') {
			throw new Error('Plugin manifest must have a valid "entryPoint" field');
		}

		if (!Array.isArray(manifest.permissions)) {
			throw new Error('Plugin manifest must have a "permissions" array');
		}

		const validPermissions: PluginPermission[] = [
			'read:movies',
			'write:metadata',
			'network',
			'cache',
			'events',
		];

		for (const perm of manifest.permissions) {
			if (!validPermissions.includes(perm)) {
				throw new Error(`Invalid plugin permission: "${perm}"`);
			}
		}
	}

	private async upsertPluginRecord(manifest: PluginManifest, enabled: boolean): Promise<void> {
		const now = nowISO();
		const existing = this.database.db
			.select()
			.from(plugins)
			.where(eq(plugins.name, manifest.name))
			.get();

		if (existing) {
			this.database.db
				.update(plugins)
				.set({
					version: manifest.version,
					enabled,
					status: enabled ? 'enabled' : 'disabled',
					updatedAt: now,
				})
				.where(eq(plugins.name, manifest.name))
				.run();
		} else {
			this.database.db
				.insert(plugins)
				.values({
					id: crypto.randomUUID(),
					name: manifest.name,
					version: manifest.version,
					enabled,
					status: enabled ? 'enabled' : 'disabled',
					settings: '{}',
					installedAt: now,
					updatedAt: now,
				})
				.run();
		}
	}

	private async updatePluginStatus(name: string, enabled: boolean): Promise<void> {
		const now = nowISO();
		this.database.db
			.update(plugins)
			.set({
				enabled,
				status: enabled ? 'enabled' : 'disabled',
				updatedAt: now,
			})
			.where(eq(plugins.name, name))
			.run();
	}
}

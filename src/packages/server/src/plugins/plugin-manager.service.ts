import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import crypto from 'crypto';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { EventsService } from '../events/events.service.js';
import { CacheService } from '../cache/cache.service.js';
import { plugins } from '../database/schema/index.js';
import { PluginContextFactory } from './plugin-context.factory.js';
import { PluginApiRegistryService } from './plugin-api-registry.service.js';
import { PluginUiRegistryService } from './plugin-ui-registry.service.js';
import type {
  IPlugin,
  PluginManifest,
  PluginInfo,
  PluginPermission,
  PluginSettingDefinition,
  PluginStatus,
  PluginContext,
} from './plugin.interface.js';

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
    private readonly events: EventsService,
    private readonly cache: CacheService,
    private readonly contextFactory: PluginContextFactory,
    private readonly apiRegistry: PluginApiRegistryService,
    private readonly uiRegistry: PluginUiRegistryService,
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
      throw new Error(
        `Plugin entry point not found: ${entryPointPath}`,
      );
    }

    const pluginModule = await import(entryPointPath);
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
    await pluginInstance.onLoad(context);

    this.activePlugins.set(manifest.name, {
      instance: pluginInstance,
      manifest,
      directory: pluginDir,
      context,
    });

    await this.upsertPluginRecord(manifest, true);

    this.logger.log(
      `Plugin "${manifest.name}" v${manifest.version} loaded successfully`,
    );
  }

  async unloadPlugin(name: string): Promise<void> {
    const loaded = this.activePlugins.get(name);

    if (!loaded) {
      throw new Error(`Plugin "${name}" is not loaded`);
    }

    // Clean up registries before unloading
    this.apiRegistry.unregisterAll(name);
    this.uiRegistry.unregisterAll(name);

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

    // Call onEnable lifecycle hook if defined
    const loaded = this.activePlugins.get(name);
    if (loaded?.instance.onEnable) {
      await loaded.instance.onEnable(loaded.context);
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

    // Instantiate plugin temporarily to call onInstall
    const pluginDir = join(this.pluginsDir, name);
    const entryPointPath = join(pluginDir, manifest.entryPoint);

    if (existsSync(entryPointPath)) {
      try {
        const pluginModule = await import(entryPointPath);
        const PluginClass = pluginModule.default ?? pluginModule;
        let pluginInstance: IPlugin;
        if (typeof PluginClass === 'function') {
          pluginInstance = new PluginClass();
        } else {
          pluginInstance = PluginClass as IPlugin;
        }

        if (pluginInstance.onInstall) {
          const context = await this.contextFactory.createContext(name);
          await pluginInstance.onInstall(context);
        }
      } catch (err) {
        this.logger.warn(
          `onInstall hook failed for "${name}": ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(`Plugin "${name}" installed`);
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

    // Clean up registries
    this.apiRegistry.unregisterAll(name);
    this.uiRegistry.unregisterAll(name);

    // Remove DB record
    this.database.db
      .delete(plugins)
      .where(eq(plugins.name, name))
      .run();

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
    const row = this.database.db
      .select()
      .from(plugins)
      .where(eq(plugins.name, name))
      .get();

    if (!row || !row.settings) {
      return {};
    }

    try {
      return JSON.parse(row.settings) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async updatePluginSettings(
    name: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    const now = nowISO();
    const row = this.database.db
      .select()
      .from(plugins)
      .where(eq(plugins.name, name))
      .get();

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

  private async upsertPluginRecord(
    manifest: PluginManifest,
    enabled: boolean,
  ): Promise<void> {
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

  private async updatePluginStatus(
    name: string,
    enabled: boolean,
  ): Promise<void> {
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

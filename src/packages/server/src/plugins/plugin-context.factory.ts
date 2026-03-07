import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { EventsService } from '../events/events.service.js';
import { ConfigService } from '../config/config.service.js';
import { plugins, movies, movieMetadata } from '../database/schema/index.js';
import type { PluginContext } from './plugin.interface.js';
import crypto from 'crypto';

@Injectable()
export class PluginContextFactory {
  constructor(
    private readonly database: DatabaseService,
    private readonly cache: CacheService,
    private readonly events: EventsService,
    private readonly config: ConfigService,
  ) {}

  async createContext(pluginName: string): Promise<PluginContext> {
    const pluginConfig = await this.loadPluginConfig(pluginName);
    const logger = new Logger(`Plugin:${pluginName}`);

    return {
      cache: {
        get: async <T>(key: string): Promise<T | undefined> => {
          return this.cache.get<T>(`plugin:${pluginName}`, key);
        },
        set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
          await this.cache.set<T>(`plugin:${pluginName}`, key, value, ttl);
        },
        delete: async (key: string): Promise<boolean> => {
          return this.cache.delete(`plugin:${pluginName}`, key);
        },
      },

      events: {
        emit: (event: string, data: unknown): void => {
          this.events.emit(`plugin:${pluginName}:${event}`, data);
        },
        on: (event: string, handler: (...args: unknown[]) => void): void => {
          this.events.on(event, handler);
        },
      },

      logger: {
        log: (msg: string) => logger.log(msg),
        warn: (msg: string) => logger.warn(msg),
        error: (msg: string) => logger.error(msg),
        debug: (msg: string) => logger.debug(msg),
      },

      config: pluginConfig,

      http: {
        fetch: async (url: string, options?: RequestInit): Promise<Response> => {
          return fetch(url, options);
        },
      },

      getMovies: async (query?: { limit?: number; offset?: number }): Promise<unknown[]> => {
        const limit = query?.limit ?? 50;
        const offset = query?.offset ?? 0;

        const results = this.database.db
          .select()
          .from(movies)
          .limit(limit)
          .offset(offset)
          .all();

        return results;
      },

      getMovieById: async (id: string): Promise<unknown | null> => {
        const result = this.database.db
          .select()
          .from(movies)
          .where(eq(movies.id, id))
          .get();

        return result ?? null;
      },

      updateMovieMetadata: async (
        movieId: string,
        data: Record<string, unknown>,
      ): Promise<void> => {
        const existing = this.database.db
          .select()
          .from(movieMetadata)
          .where(eq(movieMetadata.movieId, movieId))
          .get();

        const now = nowISO();

        if (existing) {
          this.database.db
            .update(movieMetadata)
            .set({
              ...data,
              source: pluginName,
              updatedAt: now,
            })
            .where(eq(movieMetadata.movieId, movieId))
            .run();
        } else {
          this.database.db
            .insert(movieMetadata)
            .values({
              id: crypto.randomUUID(),
              movieId,
              ...data,
              source: pluginName,
              fetchedAt: now,
              updatedAt: now,
            })
            .run();
        }
      },
    };
  }

  private async loadPluginConfig(pluginName: string): Promise<Record<string, unknown>> {
    const row = this.database.db
      .select()
      .from(plugins)
      .where(eq(plugins.name, pluginName))
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
}

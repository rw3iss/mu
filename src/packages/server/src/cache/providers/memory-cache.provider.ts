import { LRUCache } from 'lru-cache';
import type { ICacheProvider } from './cache-provider.interface.js';

export class MemoryCacheProvider implements ICacheProvider {
  private cache: LRUCache<string, NonNullable<unknown>>;

  constructor(maxEntries: number = 10000, defaultTtlMs: number = 3600000) {
    this.cache = new LRUCache({
      max: maxEntries,
      ttl: defaultTtlMs,
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const options = ttlSeconds ? { ttl: ttlSeconds * 1000 } : undefined;
    this.cache.set(key, value as NonNullable<unknown>, options);
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  async clear(namespace?: string): Promise<void> {
    if (namespace) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(namespace + ':')) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  async size(): Promise<number> {
    return this.cache.size;
  }
}

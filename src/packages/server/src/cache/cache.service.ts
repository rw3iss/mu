import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { ICacheProvider } from './providers/cache-provider.interface.js';
import { MemoryCacheProvider } from './providers/memory-cache.provider.js';

@Injectable()
export class CacheService {
	private readonly logger = new Logger('Cache');
	private provider: ICacheProvider;

	constructor(config: ConfigService) {
		const maxEntries = config.get<number>('cache.maxEntries', 10000);
		const defaultTtl = config.get<number>('cache.defaultTtlSeconds', 3600);
		this.provider = new MemoryCacheProvider(maxEntries, defaultTtl * 1000);
		this.logger.log(`In-memory cache initialized (max: ${maxEntries})`);
	}

	async get<T>(namespace: string, key: string): Promise<T | undefined> {
		return this.provider.get<T>(`${namespace}:${key}`);
	}

	async set<T>(namespace: string, key: string, value: T, ttlSeconds?: number): Promise<void> {
		await this.provider.set(`${namespace}:${key}`, value, ttlSeconds);
	}

	async delete(namespace: string, key: string): Promise<boolean> {
		return this.provider.delete(`${namespace}:${key}`);
	}

	async has(namespace: string, key: string): Promise<boolean> {
		return this.provider.has(`${namespace}:${key}`);
	}

	async clearNamespace(namespace: string): Promise<void> {
		await this.provider.clear(namespace);
	}

	async clearAll(): Promise<void> {
		await this.provider.clear();
	}

	async size(): Promise<number> {
		return this.provider.size();
	}
}

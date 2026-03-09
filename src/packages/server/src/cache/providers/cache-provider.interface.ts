export interface ICacheProvider {
	get<T>(key: string): Promise<T | undefined>;
	set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
	delete(key: string): Promise<boolean>;
	has(key: string): Promise<boolean>;
	clear(namespace?: string): Promise<void>;
	size(): Promise<number>;
}

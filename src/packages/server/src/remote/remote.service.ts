import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

export interface RemoteServerConfig {
	id: string;
	url: string;
	password: string;
	name: string;
	enabled: boolean;
}

export interface RemoteServerInfo {
	serverName: string;
	movieCount: number;
	passwordRequired: boolean;
}

@Injectable()
export class RemoteService {
	private readonly logger = new Logger('RemoteService');

	constructor(private readonly settings: SettingsService) {}

	getServers(): RemoteServerConfig[] {
		return this.settings.get<RemoteServerConfig[]>('remoteServers', []);
	}

	getEnabledServers(): RemoteServerConfig[] {
		return this.getServers().filter((s) => s.enabled);
	}

	addServer(config: Omit<RemoteServerConfig, 'id'>): RemoteServerConfig {
		const servers = this.getServers();
		const id = crypto.randomUUID();
		const server = { ...config, id };
		servers.push(server);
		this.settings.set('remoteServers', servers);
		this.logger.log(`Added remote server: ${config.name} (${config.url})`);
		return server;
	}

	updateServer(
		id: string,
		data: Partial<Omit<RemoteServerConfig, 'id'>>,
	): RemoteServerConfig | null {
		const servers = this.getServers();
		const idx = servers.findIndex((s) => s.id === id);
		if (idx === -1) return null;
		servers[idx] = { ...servers[idx]!, ...data };
		this.settings.set('remoteServers', servers);
		return servers[idx]!;
	}

	removeServer(id: string): boolean {
		const servers = this.getServers();
		const filtered = servers.filter((s) => s.id !== id);
		if (filtered.length === servers.length) return false;
		this.settings.set('remoteServers', filtered);
		this.logger.log(`Removed remote server: ${id}`);
		return true;
	}

	/**
	 * Test connection to a remote server's /shared/info endpoint.
	 */
	async testConnection(url: string, password?: string): Promise<RemoteServerInfo> {
		const baseUrl = url.replace(/\/+$/, '');
		const response = await fetch(`${baseUrl}/api/v1/shared/info`, {
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			throw new Error(`Server returned ${response.status}: ${response.statusText}`);
		}

		const info = (await response.json()) as RemoteServerInfo;

		// If the server requires a password, verify we can authenticate
		if (info.passwordRequired) {
			if (!password) {
				throw new Error('Server requires a password');
			}
			const hash = createHash('sha256').update(password).digest('hex');
			const authResponse = await fetch(`${baseUrl}/api/v1/shared/movies?pageSize=1`, {
				headers: { Authorization: `Bearer ${hash}` },
				signal: AbortSignal.timeout(10000),
			});
			if (!authResponse.ok) {
				throw new Error('Password is incorrect');
			}
		}

		return info;
	}

	/**
	 * Fetch movies from a remote server.
	 */
	async fetchMovies(
		server: RemoteServerConfig,
		params?: Record<string, string>,
	): Promise<{ movies: any[]; total: number }> {
		const baseUrl = server.url.replace(/\/+$/, '');
		const qs = new URLSearchParams(params ?? {}).toString();
		const url = `${baseUrl}/api/v1/shared/movies${qs ? `?${qs}` : ''}`;

		const headers: Record<string, string> = {};
		if (server.password) {
			headers.Authorization = `Bearer ${createHash('sha256').update(server.password).digest('hex')}`;
		}

		const response = await fetch(url, {
			headers,
			signal: AbortSignal.timeout(15000),
		});

		if (!response.ok) {
			this.logger.warn(`Failed to fetch from ${server.name}: ${response.status}`);
			return { movies: [], total: 0 };
		}

		const data = (await response.json()) as any;

		// Tag each movie with its remote origin
		const movies = (data.movies ?? []).map((m: any) => ({
			...m,
			remoteOrigin: {
				serverId: server.id,
				serverName: server.name,
				remoteMovieId: m.id,
			},
			// Override the ID to prevent collisions with local movies
			id: `remote:${server.id}:${m.id}`,
		}));

		return { movies, total: data.total ?? 0 };
	}

	/**
	 * Fetch movies from all enabled remote servers.
	 */
	async fetchAllRemoteMovies(params?: Record<string, string>): Promise<{
		movies: any[];
		total: number;
		servers: { id: string; name: string; movieCount: number }[];
	}> {
		const servers = this.getEnabledServers();
		const results = await Promise.allSettled(servers.map((s) => this.fetchMovies(s, params)));

		const allMovies: any[] = [];
		const serverInfo: { id: string; name: string; movieCount: number }[] = [];
		let total = 0;

		for (let i = 0; i < results.length; i++) {
			const result = results[i]!;
			const server = servers[i]!;
			if (result.status === 'fulfilled') {
				allMovies.push(...result.value.movies);
				total += result.value.total;
				serverInfo.push({
					id: server.id,
					name: server.name,
					movieCount: result.value.total,
				});
			} else {
				this.logger.warn(`Failed to fetch from ${server.name}: ${result.reason}`);
				serverInfo.push({ id: server.id, name: server.name, movieCount: 0 });
			}
		}

		return { movies: allMovies, total, servers: serverInfo };
	}

	/**
	 * Fetch a single movie detail from a remote server.
	 */
	async fetchMovieDetail(serverId: string, remoteMovieId: string): Promise<any> {
		const server = this.getServers().find((s) => s.id === serverId);
		if (!server) throw new Error(`Remote server ${serverId} not found`);

		const baseUrl = server.url.replace(/\/+$/, '');
		const headers: Record<string, string> = {};
		if (server.password) {
			headers.Authorization = `Bearer ${createHash('sha256').update(server.password).digest('hex')}`;
		}

		const response = await fetch(`${baseUrl}/api/v1/shared/movies/${remoteMovieId}`, {
			headers,
			signal: AbortSignal.timeout(15000),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch movie: ${response.status}`);
		}

		const movie = (await response.json()) as Record<string, unknown>;
		return {
			...movie,
			remoteOrigin: {
				serverId: server.id,
				serverName: server.name,
				remoteMovieId,
			},
			id: `remote:${server.id}:${remoteMovieId}`,
		};
	}

	/**
	 * Proxy a stream start request to a remote server.
	 */
	async proxyStreamStart(
		serverId: string,
		remoteMovieId: string,
		quality?: string,
	): Promise<any> {
		const server = this.getServers().find((s) => s.id === serverId);
		if (!server) throw new Error(`Remote server ${serverId} not found`);

		const baseUrl = server.url.replace(/\/+$/, '');
		const headers: Record<string, string> = {};
		if (server.password) {
			headers.Authorization = `Bearer ${createHash('sha256').update(server.password).digest('hex')}`;
		}

		const qs = quality ? `?quality=${quality}` : '';
		const response = await fetch(
			`${baseUrl}/api/v1/shared/stream/${remoteMovieId}/start${qs}`,
			{ headers, signal: AbortSignal.timeout(15000) },
		);

		if (!response.ok) {
			throw new Error(`Failed to start stream: ${response.status}`);
		}

		const session = (await response.json()) as any;

		// Rewrite stream URLs to proxy through local server
		return {
			...session,
			streamUrl: session.streamUrl
				? `/api/v1/remote/stream/${serverId}/${session.sessionId}/manifest.m3u8`
				: undefined,
			directPlayUrl: session.directPlayUrl
				? `/api/v1/remote/stream/${serverId}/direct/${session.fileId}`
				: undefined,
			_remoteSessionId: session.sessionId,
			_remoteBaseUrl: baseUrl,
			_remoteAuth: headers.Authorization,
		};
	}

	/**
	 * Get the auth headers for a remote server.
	 */
	getServerAuth(serverId: string): { baseUrl: string; headers: Record<string, string> } | null {
		const server = this.getServers().find((s) => s.id === serverId);
		if (!server) return null;

		const headers: Record<string, string> = {};
		if (server.password) {
			headers.Authorization = `Bearer ${createHash('sha256').update(server.password).digest('hex')}`;
		}
		return { baseUrl: server.url.replace(/\/+$/, ''), headers };
	}
}

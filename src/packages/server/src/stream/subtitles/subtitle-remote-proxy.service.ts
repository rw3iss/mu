import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { RemoteService } from '../../remote/remote.service.js';

/**
 * Encapsulates the proxy logic for subtitle endpoints when the requested
 * movieId is a `remote:<serverId>:<remoteMovieId>` reference. Pulled out
 * of SubtitleManageController so the controller's route handlers stay
 * focused on orchestration.
 */
@Injectable()
export class SubtitleRemoteProxyService {
	constructor(private readonly remoteService: RemoteService) {}

	/** Parse `remote:<serverId>:<remoteMovieId>` or return null. */
	parseRemoteId(movieId: string): { serverId: string; remoteMovieId: string } | null {
		const match = movieId.match(/^remote:([^:]+):(.+)$/);
		if (!match) return null;
		return { serverId: match[1]!, remoteMovieId: match[2]! };
	}

	private getRemoteAuth(serverId: string): {
		baseUrl: string;
		headers: Record<string, string>;
	} {
		const auth = this.remoteService.getServerAuth(serverId);
		if (!auth) throw new NotFoundException(`Remote server ${serverId} not found`);
		return auth;
	}

	async get<T>(serverId: string, path: string): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const response = await fetch(`${baseUrl}/api/v1${path}`, {
			headers,
			signal: AbortSignal.timeout(15000),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${body}`);
		}
		return (await response.json()) as T;
	}

	async post<T>(serverId: string, path: string, body: unknown): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const response = await fetch(`${baseUrl}/api/v1${path}`, {
			method: 'POST',
			headers: { ...headers, 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${text}`);
		}
		return (await response.json()) as T;
	}

	async upload<T>(
		serverId: string,
		path: string,
		fileBuffer: Buffer,
		fileName: string,
	): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const boundary = `----MuBoundary${Date.now()}`;
		const parts = [
			`--${boundary}\r\n`,
			`Content-Disposition: form-data; name="subtitle"; filename="${fileName}"\r\n`,
			'Content-Type: application/octet-stream\r\n\r\n',
		];
		const header = Buffer.from(parts.join(''));
		const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
		const body = Buffer.concat([header, fileBuffer, footer]);

		const response = await fetch(`${baseUrl}/api/v1${path}`, {
			method: 'POST',
			headers: {
				...headers,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body,
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${text}`);
		}
		return (await response.json()) as T;
	}

	async delete<T>(serverId: string, remotePath: string): Promise<T> {
		const { baseUrl, headers } = this.getRemoteAuth(serverId);
		const response = await fetch(`${baseUrl}/api/v1${remotePath}`, {
			method: 'DELETE',
			headers,
			signal: AbortSignal.timeout(15000),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new BadGatewayException(`Remote server error ${response.status}: ${body}`);
		}
		return (await response.json()) as T;
	}
}

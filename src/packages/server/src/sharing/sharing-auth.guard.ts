import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

export interface SharingConfig {
	enabled: boolean;
	password: string | null;
	serverName: string;
}

const DEFAULT_SHARING: SharingConfig = {
	enabled: false,
	password: null,
	serverName: 'My Library',
};

export function hashPassword(password: string): string {
	return createHash('sha256').update(password).digest('hex');
}

@Injectable()
export class SharingAuthGuard implements CanActivate {
	constructor(private readonly settings: SettingsService) {}

	canActivate(context: ExecutionContext): boolean {
		const config = this.settings.get<SharingConfig>('sharing', DEFAULT_SHARING);

		if (!config.enabled) {
			throw new ForbiddenException('Library sharing is not enabled');
		}

		// If no password is set, allow all requests
		if (!config.password) {
			return true;
		}

		const request = context.switchToHttp().getRequest();
		const authHeader = request.headers?.authorization as string | undefined;

		// Accept token from Authorization header or ?token= query param
		// (query param needed for direct video URLs where custom headers aren't possible)
		const token = authHeader?.startsWith('Bearer ')
			? authHeader.slice(7)
			: (request.query?.token as string | undefined);

		if (!token) {
			throw new ForbiddenException('Password required');
		}

		const expected = hashPassword(config.password);

		if (token !== expected) {
			throw new ForbiddenException('Invalid password');
		}

		return true;
	}
}

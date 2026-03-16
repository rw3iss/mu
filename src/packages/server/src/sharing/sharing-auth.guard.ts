import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
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

		if (!authHeader?.startsWith('Bearer ')) {
			throw new ForbiddenException('Password required');
		}

		const token = authHeader.slice(7);
		const expected = hashPassword(config.password);

		if (token !== expected) {
			throw new ForbiddenException('Invalid password');
		}

		return true;
	}
}

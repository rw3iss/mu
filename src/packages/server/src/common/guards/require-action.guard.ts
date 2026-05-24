import type { Action } from '@mu/shared';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_ACTION_KEY } from '../decorators/require-action.decorator.js';
import { PermissionsService } from '../permissions/permissions.service.js';

/**
 * Enforces `@RequireAction(...)` after JwtAuthGuard + RolesGuard have run.
 *
 * Methods without a `@RequireAction` annotation pass through unchanged —
 * this is intentional during the transition from the legacy `@Roles()` /
 * unguarded endpoints to fully decorated controllers.
 */
@Injectable()
export class RequireActionGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly permissions: PermissionsService,
	) {}

	canActivate(context: ExecutionContext): boolean {
		const action = this.reflector.getAllAndOverride<Action | undefined>(REQUIRE_ACTION_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (!action) return true;

		const request = context.switchToHttp().getRequest();
		const user = request.user;
		if (!user) {
			throw new ForbiddenException(`Missing permission: ${action}`);
		}
		if (!this.permissions.can(user.role, action)) {
			throw new ForbiddenException(`Missing permission: ${action}`);
		}
		return true;
	}
}

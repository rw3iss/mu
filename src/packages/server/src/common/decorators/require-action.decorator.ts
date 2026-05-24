import type { Action } from '@mu/shared';
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ACTION_KEY = 'requireAction';

/**
 * Declare the permission action a controller method requires. Read by
 * `RequireActionGuard`; missing decoration = no action gate (use the
 * existing `@Public()` decorator to explicitly mark public endpoints).
 *
 * Examples:
 *   @RequireAction('edit:movie')       // contributor + admin
 *   @RequireAction('admin:users')      // admin only
 *   @RequireAction('view:library')     // any authed user
 */
export const RequireAction = (action: Action) => SetMetadata(REQUIRE_ACTION_KEY, action);

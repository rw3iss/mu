import { Action, GrantedRole, ROLE_ACTIONS, roleCan } from '@mu/shared';
import { ForbiddenException, Injectable } from '@nestjs/common';

/**
 * JWT-payload shape attached to `request.user` by `JwtAuthGuard`.
 * Concretely: `sub` = user id, `role` = one of GrantedRole or undefined
 * for some legacy paths.
 */
export interface JwtUser {
	sub?: string;
	id?: string;
	role?: GrantedRole | string;
	shareMovieId?: string;
}

/**
 * Central permission authority. Controllers and services never inspect
 * `user.role` directly — they ask this service.
 *
 * The role→action table itself lives in `@mu/shared/permissions/actions`
 * so the client can mirror the logic without a second source of truth.
 */
@Injectable()
export class PermissionsService {
	can(role: GrantedRole | string | undefined, action: Action): boolean {
		return roleCan(role, action);
	}

	/** Throws ForbiddenException if `user` cannot perform `action`. */
	requireAction(user: JwtUser | undefined, action: Action): void {
		if (!this.can(user?.role, action)) {
			throw new ForbiddenException(`Missing permission: ${action}`);
		}
	}

	isAdmin(user: JwtUser | undefined): boolean {
		return user?.role === 'admin';
	}

	isContributor(user: JwtUser | undefined): boolean {
		return user?.role === 'contributor';
	}

	isViewer(user: JwtUser | undefined): boolean {
		return user?.role === 'viewer';
	}

	isShare(user: JwtUser | undefined): boolean {
		return user?.role === 'share';
	}

	/** True if the actor is operating on their own user record. */
	isSelf(actor: JwtUser | undefined, targetUserId: string): boolean {
		const actorId = actor?.sub ?? actor?.id;
		return !!actorId && actorId === targetUserId;
	}

	canEditMovies(user: JwtUser | undefined): boolean {
		return this.can(user?.role, 'edit:movie');
	}

	canEditAppSettings(user: JwtUser | undefined): boolean {
		return this.can(user?.role, 'edit:app-settings');
	}

	canManageUsers(user: JwtUser | undefined): boolean {
		return this.can(user?.role, 'admin:users');
	}

	/**
	 * Can `actor` edit `targetUserId`'s settings for `key`?
	 *
	 * - Admins with `admin:any-user-setting` can override any key for any
	 *   user (support escape hatch).
	 * - Otherwise the actor must be operating on their OWN id AND the key
	 *   must be in the allowlist (enforced one level up in the service).
	 */
	canEditUserSettings(
		actor: JwtUser | undefined,
		targetUserId: string,
		isAllowlisted: boolean,
	): boolean {
		if (this.can(actor?.role, 'admin:any-user-setting')) return true;
		if (!this.isSelf(actor, targetUserId)) return false;
		return isAllowlisted && this.can(actor?.role, 'edit:own-settings');
	}

	/**
	 * Can `actor` patch `targetUserId`'s profile field?
	 * - 'role' requires `admin:users` (never self-promote).
	 * - 'password' / 'profile' allowed for admin OR self.
	 */
	canEditUser(
		actor: JwtUser | undefined,
		targetUserId: string,
		field: 'role' | 'password' | 'profile',
	): boolean {
		if (field === 'role') return this.canManageUsers(actor);
		if (this.canManageUsers(actor)) return true;
		return this.isSelf(actor, targetUserId);
	}

	/** Snapshot of allowed actions for the given role — used for client mirror. */
	actionsForRole(role: GrantedRole | string | undefined): Action[] {
		const set = ROLE_ACTIONS[role as GrantedRole];
		return set ? [...set] : [];
	}
}

/**
 * Permission actions.
 *
 * Controllers and client UI ask "can this user perform action X?" rather
 * than "is this user's role 'admin'?". The role→actions map below is the
 * single source of truth — change it here, both server guards and client
 * UI gating pick up the new behavior.
 */
export type Action =
	| 'view:public'
	| 'view:library'
	| 'view:own-data'
	| 'view:shared-movie'
	| 'view:app-settings'
	| 'edit:own-settings'
	| 'edit:movie'
	| 'delete:movie'
	| 'edit:app-settings'
	| 'admin:users'
	| 'admin:server'
	| 'admin:plugins'
	| 'admin:datasets'
	| 'admin:any-user-setting';

export type GrantedRole = 'admin' | 'contributor' | 'viewer' | 'share';

/**
 * Each role's full action set. Lookup is O(1) via Set.
 * `share` is the synthetic guard-only role attached by JwtAuthGuard when
 * a share token is presented; never persisted to the users table.
 */
export const ROLE_ACTIONS: Record<GrantedRole, ReadonlySet<Action>> = {
	admin: new Set<Action>([
		'view:public',
		'view:library',
		'view:own-data',
		'view:shared-movie',
		'view:app-settings',
		'edit:own-settings',
		'edit:movie',
		'delete:movie',
		'edit:app-settings',
		'admin:users',
		'admin:server',
		'admin:plugins',
		'admin:datasets',
		'admin:any-user-setting',
	]),
	contributor: new Set<Action>([
		'view:public',
		'view:library',
		'view:own-data',
		'view:app-settings', // read-only — write actions still gated
		'edit:own-settings',
		'edit:movie',
		'delete:movie',
	]),
	viewer: new Set<Action>([
		'view:public',
		'view:library',
		'view:own-data',
		'edit:own-settings',
	]),
	share: new Set<Action>(['view:public', 'view:shared-movie']),
};

export function roleCan(role: GrantedRole | string | undefined, action: Action): boolean {
	if (!role) return false;
	const set = ROLE_ACTIONS[role as GrantedRole];
	return set ? set.has(action) : false;
}

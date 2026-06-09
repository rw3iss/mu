/** Browser-side path helpers (no Node `path`). Cross-platform: treats
 *  both `/` and `\` as separators and compares case-sensitively to match
 *  the Linux host (the production server). */

/** Normalize separators to `/` and strip trailing slashes. */
export function normalizePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** The enclosing folder of a file path (everything but the last segment). */
export function parentDir(p: string): string {
	const parts = normalizePath(p).split('/');
	parts.pop();
	return parts.join('/');
}

/** True when `folder` is exactly one of the configured library root paths. */
export function isLibraryRoot(folder: string, roots: string[]): boolean {
	const target = normalizePath(folder);
	return roots.some((r) => normalizePath(r) === target);
}

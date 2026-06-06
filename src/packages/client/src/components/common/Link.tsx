import type { ComponentChildren, JSX } from 'preact';
import { spaLinkClick } from '@/utils/navigation';

interface LinkProps extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
	/** In-app destination. */
	href: string;
	/** Custom plain-click navigation (side effects); defaults to `route(href)`. */
	onNavigate?: () => void;
	children?: ComponentChildren;
}

/**
 * Real `<a href>` that SPA-navigates on a plain left-click but supports the
 * browser's native middle-click / ctrl-/cmd-click → open in a new (background)
 * tab. Use for simple navigables (sidebar, logo, tiles) that have no nested
 * interactive children. For cards with nested buttons, prefer `newTabNav`.
 */
export function Link({ href, onNavigate, children, ...rest }: LinkProps) {
	return (
		<a href={href} onClick={spaLinkClick(href, onNavigate)} {...rest}>
			{children}
		</a>
	);
}

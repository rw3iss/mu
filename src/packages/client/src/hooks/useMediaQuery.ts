import { useState, useEffect } from 'preact/hooks';

/**
 * Hook that returns whether a CSS media query matches.
 * Updates reactively when the match state changes.
 *
 * @param query - CSS media query string (e.g., '(max-width: 768px)')
 * @returns Whether the media query currently matches
 *
 * @example
 * const isMobile = useMediaQuery('(max-width: 767px)');
 * const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState<boolean>(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === 'undefined') return;

		const mediaQuery = window.matchMedia(query);

		// Set initial value
		setMatches(mediaQuery.matches);

		// Listen for changes
		function handleChange(event: MediaQueryListEvent) {
			setMatches(event.matches);
		}

		mediaQuery.addEventListener('change', handleChange);

		return () => {
			mediaQuery.removeEventListener('change', handleChange);
		};
	}, [query]);

	return matches;
}

// Convenience hooks using the breakpoints from _variables.scss
export function useIsMobile(): boolean {
	return useMediaQuery('(max-width: 767px)');
}

export function useIsTablet(): boolean {
	return useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
}

export function useIsDesktop(): boolean {
	return useMediaQuery('(min-width: 1280px)');
}

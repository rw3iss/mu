import type { ComponentChildren } from 'preact';
import { spaLinkClick } from '@/utils/navigation';

/**
 * SPA `<a>` for use INSIDE clickable rows / cards: navigates without letting
 * the click bubble to the row's own handler (which would e.g. start playback).
 */
export function InlineLink({
	href,
	class: className,
	children,
	title,
}: {
	href: string;
	class?: string;
	children: ComponentChildren;
	title?: string;
}) {
	const nav = spaLinkClick(href);
	return (
		<a
			href={href}
			class={className}
			title={title}
			onClick={(e: MouseEvent) => {
				e.stopPropagation();
				nav(e);
			}}
		>
			{children}
		</a>
	);
}

/** Comma-separated artist links. */
export function ArtistLinks({
	artists,
	class: className,
}: {
	artists: { id: string; name: string }[];
	class?: string;
}) {
	return (
		<>
			{artists.map((a, i) => (
				<span key={a.id}>
					{i > 0 && ', '}
					<InlineLink href={`/artist/${a.id}`} class={className}>
						{a.name}
					</InlineLink>
				</span>
			))}
		</>
	);
}

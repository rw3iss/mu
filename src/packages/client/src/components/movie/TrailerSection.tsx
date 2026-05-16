import { useState } from 'preact/hooks';
import { Icon } from '@/components/common/Icon';
import styles from './TrailerSection.module.scss';

interface TrailerSectionProps {
	trailerUrl: string | undefined;
	/** Optional thumbnail to show on the collapsed CTA tile. */
	posterUrl?: string | null;
	/** Lets the parent override the default header text. */
	title?: string;
}

/**
 * Collapsible trailer block. Lives on MovieDetail (library + preview
 * mode) so the same component handles both. Lazy-mounts the iframe
 * only when the user expands the panel — saves bandwidth, avoids
 * YouTube tracking on first paint, and keeps cold-load fast.
 *
 * Currently supports YouTube. Non-YouTube URLs fall back to an
 * "Open in new tab" link so the section is never useless.
 */
export function TrailerSection({ trailerUrl, posterUrl, title }: TrailerSectionProps) {
	const [expanded, setExpanded] = useState(false);
	if (!trailerUrl) return null;

	const youtubeId = parseYoutubeId(trailerUrl);
	const headerLabel = title ?? 'Trailer';

	return (
		<section class={styles.section}>
			<button
				class={styles.header}
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
			>
				<span class={styles.headerIcon}>
					<Icon name={expanded ? 'chevron-down' : 'play'} size={14} />
				</span>
				<span class={styles.headerTitle}>{headerLabel}</span>
				<span class={styles.headerHint}>
					{expanded ? 'Click to hide' : 'Click to watch'}
				</span>
			</button>

			{expanded && (
				<div class={styles.body}>
					{youtubeId ? (
						<div class={styles.frameWrap}>
							<iframe
								class={styles.frame}
								// nocookie + privacy params — no tracking until
								// user actually pushes play in the embed.
								src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`}
								title={headerLabel}
								loading="lazy"
								referrerPolicy="strict-origin-when-cross-origin"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
								allowFullScreen
							/>
						</div>
					) : (
						<div class={styles.fallback}>
							<p>This trailer isn't embeddable.</p>
							<a
								class={styles.fallbackLink}
								href={trailerUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								Open trailer in a new tab →
							</a>
						</div>
					)}
				</div>
			)}

			{!expanded && posterUrl && (
				<button
					type="button"
					class={styles.posterCta}
					style={{ backgroundImage: `url(${posterUrl})` }}
					onClick={() => setExpanded(true)}
					aria-label={`Play ${headerLabel}`}
				>
					<span class={styles.playOverlay}>
						<Icon name="play" size={28} />
					</span>
				</button>
			)}
		</section>
	);
}

/**
 * Pull the video id out of a few well-known YouTube URL shapes.
 * Handles:
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   https://www.youtube.com/embed/ID
 *   https://www.youtube.com/shorts/ID
 *   bare ID strings (defensive)
 */
function parseYoutubeId(input: string): string | null {
	if (!input) return null;
	const trimmed = input.trim();
	// Bare 11-char video id
	if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

	try {
		const u = new URL(trimmed);
		if (u.hostname === 'youtu.be') {
			const id = u.pathname.replace(/^\//, '').split('/')[0];
			return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
		}
		if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
			const v = u.searchParams.get('v');
			if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
			// /embed/ID or /shorts/ID
			const parts = u.pathname.split('/').filter(Boolean);
			const id = parts[1];
			if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
		}
	} catch {
		// not a URL
	}
	return null;
}

import { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import styles from './SmartImage.module.scss';

interface SmartImageProps {
	/** Image source. If `null`/`undefined`/`''`, the fallback renders directly without an `<img>` element. */
	src?: string | null;
	alt?: string;
	/** Class for the OUTER wrapper (so positioning rules from the parent's SCSS still apply). */
	class?: string;
	/** Class for the inner `<img>` element (e.g. existing `.posterImage`). */
	imgClass?: string;
	/** Inline style passed through to the outer wrapper. */
	style?: JSX.CSSProperties;
	/** Text shown in the fallback (e.g. movie title for posters). Falls back to alt. */
	fallbackLabel?: string;
	/** When true, the fallback shows only an icon (no label). Useful for tiny thumbnails. */
	iconOnly?: boolean;
	loading?: 'lazy' | 'eager';
	onClick?: (e: MouseEvent) => void;
	onLoad?: () => void;
	onError?: () => void;
}

/**
 * Drop-in replacement for `<img>` that gracefully degrades when the
 * source 404s, fails to decode, or is empty/missing. Instead of the
 * browser's default "broken image" icon (e.g. the green-mountain
 * placeholder you see on movie cards when the poster URL is dead),
 * a styled fallback renders inside the same box — a stroke icon plus
 * an optional label, centered. The wrapper preserves the image's
 * box so parent layout doesn't shift.
 *
 * Behaviour:
 *  - If `src` is falsy, the `<img>` is never mounted and the fallback
 *    renders immediately (no network request).
 *  - If the `<img>` fires `onerror`, the fallback replaces it.
 *  - If `src` changes back to a valid URL after a failure, the
 *    component retries once (state resets).
 */
export function SmartImage({
	src,
	alt,
	class: className,
	imgClass,
	style,
	fallbackLabel,
	iconOnly,
	loading = 'lazy',
	onClick,
	onLoad,
	onError,
}: SmartImageProps) {
	const [errored, setErrored] = useState(false);
	const lastSrc = useRef(src);

	// Reset error state when src changes (caller swapped to a new URL).
	useEffect(() => {
		if (src !== lastSrc.current) {
			lastSrc.current = src;
			setErrored(false);
		}
	}, [src]);

	const showFallback = !src || errored;
	const label = fallbackLabel ?? alt;

	return (
		<div
			class={`${styles.wrap} ${className ?? ''}`}
			style={style}
			onClick={onClick}
			data-fallback={showFallback ? 'true' : undefined}
		>
			{!showFallback && (
				<img
					src={src ?? ''}
					alt={alt ?? ''}
					class={`${styles.img} ${imgClass ?? ''}`}
					loading={loading}
					onLoad={onLoad}
					onError={() => {
						setErrored(true);
						onError?.();
					}}
				/>
			)}
			{showFallback && (
				<div class={`${styles.fallback} ${iconOnly ? styles.iconOnly : ''}`}>
					<Icon name="image-broken" class={styles.fallbackIcon} />
					{!iconOnly && label && <span class={styles.fallbackLabel}>{label}</span>}
				</div>
			)}
		</div>
	);
}

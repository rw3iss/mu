import { SmartImage } from '@/components/common/SmartImage';
import styles from './Avatar.module.scss';

interface AvatarProps {
	/** Display name — drives the initial fallback and the title. */
	name: string;
	/** Optional image; falls back to the gradient initial when absent/broken. */
	src?: string | null;
	/** Diameter in px (default 40). */
	size?: number;
	class?: string;
}

/**
 * Round user avatar. Shows the photo when available, otherwise a gradient tile
 * with the name's first initial — matching the sidebar/user chrome. Reusable
 * across the profile header, member rows, and anywhere a user is shown.
 */
export function Avatar({ name, src, size = 40, class: cls = '' }: AvatarProps) {
	const initial = (name?.trim()?.charAt(0) || '?').toUpperCase();
	const dim = `${size}px`;
	return (
		<div
			class={`${styles.avatar} ${cls}`}
			style={{ width: dim, height: dim, fontSize: `${Math.round(size * 0.42)}px` }}
			title={name}
			aria-label={name}
		>
			{src ? (
				<SmartImage src={src} alt={name} class={styles.imgWrap} imgClass={styles.img} iconOnly />
			) : (
				<span class={styles.initial}>{initial}</span>
			)}
		</div>
	);
}

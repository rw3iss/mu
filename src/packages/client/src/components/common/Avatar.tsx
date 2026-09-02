import { Icon } from '@/components/common/Icon';
import { SmartImage } from '@/components/common/SmartImage';
import { Spinner } from '@/components/common/Spinner';
import styles from './Avatar.module.scss';

interface AvatarProps {
	/** Display name — drives the initial fallback and the title. */
	name: string;
	/** Optional image; falls back to the gradient initial when absent/broken. */
	src?: string | null;
	/** Diameter in px (default 40). */
	size?: number;
	class?: string;
	/** When true, the avatar becomes a click target that opens a file picker. */
	editable?: boolean;
	/** Called with the chosen image file (only when `editable`). */
	onSelectFile?: (file: File) => void;
	/** Shows a spinner overlay while an upload is in flight. */
	uploading?: boolean;
}

/**
 * Round user avatar. Shows the photo when available, otherwise a gradient tile
 * with the name's first initial — matching the sidebar/user chrome. Reusable
 * across the profile header, member rows, and anywhere a user is shown.
 *
 * In `editable` mode the whole circle is a hidden file picker with a hover
 * "change" overlay — used on the profile edit view.
 */
export function Avatar({
	name,
	src,
	size = 40,
	class: cls = '',
	editable = false,
	onSelectFile,
	uploading = false,
}: AvatarProps) {
	const initial = (name?.trim()?.charAt(0) || '?').toUpperCase();
	const dim = `${size}px`;
	const style = { width: dim, height: dim, fontSize: `${Math.round(size * 0.42)}px` };

	const inner = src ? (
		<SmartImage src={src} alt={name} class={styles.imgWrap} imgClass={styles.img} iconOnly />
	) : (
		<span class={styles.initial}>{initial}</span>
	);

	if (editable) {
		return (
			<label
				class={`${styles.avatar} ${styles.editable} ${cls}`}
				style={style}
				title="Change avatar"
			>
				{inner}
				<span class={styles.editOverlay} aria-hidden="true">
					{uploading ? (
						<Spinner size="sm" />
					) : (
						<Icon name="image" size={Math.round(size * 0.3)} />
					)}
				</span>
				<input
					type="file"
					accept="image/*"
					class={styles.fileInput}
					disabled={uploading}
					onChange={(e) => {
						const file = (e.target as HTMLInputElement).files?.[0];
						if (file) onSelectFile?.(file);
						(e.target as HTMLInputElement).value = '';
					}}
				/>
			</label>
		);
	}

	return (
		<div class={`${styles.avatar} ${cls}`} style={style} title={name} aria-label={name}>
			{inner}
		</div>
	);
}

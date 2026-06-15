import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './CopyButton.module.scss';
import { Icon } from './Icon';

interface CopyButtonProps {
	/** Text written to the clipboard on click. */
	text: string;
	/** Extra class for context-specific positioning/reveal behavior. */
	class?: string;
	/** Icon size in px (default 14). */
	size?: number;
	/** Tooltip + aria-label while idle. */
	title?: string;
	/** Tooltip + aria-label for ~2s after a successful copy. */
	copiedTitle?: string;
	/** Stop click propagation (useful inside clickable rows). Default true. */
	stopPropagation?: boolean;
}

const COPIED_MS = 2000;

/**
 * Small icon button that copies `text` to the clipboard and flips its icon to
 * a success check for ~2s. Wraps {@link copyToClipboard} (clipboard API +
 * legacy fallback). Style hooks: `.copyBtn` base, `.copied` success state.
 */
export function CopyButton({
	text,
	class: className,
	size = 14,
	title = 'Copy',
	copiedTitle = 'Copied',
	stopPropagation = true,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const handleClick = useCallback(
		async (e: MouseEvent) => {
			e.preventDefault();
			if (stopPropagation) e.stopPropagation();
			await copyToClipboard(text);
			setCopied(true);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), COPIED_MS);
		},
		[text, stopPropagation],
	);

	return (
		<button
			type="button"
			class={`${styles.copyBtn} ${copied ? styles.copied : ''} ${className ?? ''}`}
			onClick={handleClick}
			title={copied ? copiedTitle : title}
			aria-label={copied ? copiedTitle : title}
		>
			<Icon name={copied ? 'check' : 'copy'} size={size} />
		</button>
	);
}

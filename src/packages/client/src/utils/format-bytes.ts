/**
 * Human-readable byte formatter. Single source of truth for the
 * client — previously duplicated across AdminDashboard, ServerSettings,
 * FileInfoGrid (inline), and a dead-helper in Settings.
 *
 * @param bytes - raw byte count (0 or negative returns "0 B")
 * @param fractionDigits - decimals on the resulting number (default 1).
 *                         Pass 0 for whole numbers, 2 for finer precision.
 * @returns e.g. "812 MB" / "1.42 GB" / "1.5 TB" / "0 B"
 *
 * Uses base-1024 (KiB convention) but labels with the conventional
 * B/KB/MB/GB/TB suffixes since that's what the rest of the app speaks.
 */
export function formatBytes(bytes: number, fractionDigits: number = 1): string {
	if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '0 B';
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / 1024 ** i;
	// Whole-bytes never need decimals; everything else honors the param.
	const digits = i === 0 ? 0 : fractionDigits;
	return `${value.toFixed(digits)} ${sizes[i]}`;
}

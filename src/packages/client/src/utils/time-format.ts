/** Format a duration in seconds as `m:ss` or `h:mm:ss`. */
export function clockFromSeconds(total: number): string {
	const s = Math.max(0, Math.floor(total || 0));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return h > 0
		? `${h}:${mm}:${String(sec).padStart(2, '0')}`
		: `${mm}:${String(sec).padStart(2, '0')}`;
}

/** Short relative time ("just now", "12m ago", "3d ago") falling back to a date. */
export function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return '';
	const mins = Math.round((Date.now() - then) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(iso).toLocaleDateString();
}

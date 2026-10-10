/** One timed lyric line. */
export interface LrcLine {
	/** Start time in seconds. */
	time: number;
	text: string;
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\]/im;

/**
 * Parse LRC ("[mm:ss.xx]text") into lines sorted by time. A line may carry
 * several time tags (repeated choruses). `[offset:±ms]` is honoured; other
 * ID tags ([ar:], [ti:], …) are skipped.
 */
export function parseLrc(lrc: string): LrcLine[] {
	const offsetMatch = lrc.match(OFFSET_TAG);
	const offset = offsetMatch ? Number.parseInt(offsetMatch[1]!, 10) / 1000 : 0;
	const out: LrcLine[] = [];
	for (const raw of lrc.split(/\r?\n/)) {
		const times: number[] = [];
		let last = 0;
		TIME_TAG.lastIndex = 0;
		for (let m = TIME_TAG.exec(raw); m; m = TIME_TAG.exec(raw)) {
			const min = Number.parseInt(m[1]!, 10);
			const sec = Number.parseInt(m[2]!, 10);
			const frac = m[3] ? Number.parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
			times.push(min * 60 + sec + frac);
			last = m.index + m[0].length;
		}
		if (times.length === 0) continue;
		const text = raw.slice(last).trim();
		for (const t of times) out.push({ time: Math.max(0, t - offset), text });
	}
	return out.sort((a, b) => a.time - b.time);
}

/** Index of the line active at `t` seconds, or -1 before the first line. */
export function activeLrcIndex(lines: LrcLine[], t: number): number {
	let lo = 0;
	let hi = lines.length - 1;
	let ans = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (lines[mid]!.time <= t) {
			ans = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return ans;
}

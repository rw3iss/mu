/**
 * LRC helpers. An LRC line is `[mm:ss.xx] text`; a line may carry several
 * timestamps (`[00:12.00][01:30.50] chorus`). Metadata lines (`[ar:…]`,
 * `[offset:…]`) are ignored when parsing.
 */

export interface LrcLine {
	/** Seconds from the start of the track. */
	time: number;
	text: string;
}

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LEADING_STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;

/** Parse LRC into time-sorted lines. Honours `[offset:±ms]`. */
export function parseLrc(lrc: string): LrcLine[] {
	const out: LrcLine[] = [];
	let offsetMs = 0;
	for (const raw of lrc.split(/\r?\n/)) {
		const line = raw.trim();
		const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
		if (off) {
			offsetMs = Number(off[1]);
			continue;
		}
		const times: number[] = [];
		let rest = line;
		for (;;) {
			const m = LEADING_STAMP.exec(rest);
			if (!m) break;
			const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
			times.push(Number(m[1]) * 60 + Number(m[2]) + frac);
			rest = rest.slice(m[0].length);
		}
		if (!times.length) continue;
		const text = rest.trim();
		for (const t of times) out.push({ time: Math.max(0, t - offsetMs / 1000), text });
	}
	return out.sort((a, b) => a.time - b.time);
}

/** True when the text has at least two timed lines (otherwise it isn't usable LRC). */
export function isSyncedLrc(text: string | null | undefined): boolean {
	if (!text) return false;
	return parseLrc(text).filter((l) => l.text).length >= 2;
}

/** Plain lyrics from LRC (timestamps and metadata stripped, blank runs collapsed). */
export function lrcToPlain(lrc: string): string {
	const lines = lrc
		.split(/\r?\n/)
		.filter((l) => !/^\s*\[[a-z]+:.*\]\s*$/i.test(l))
		.map((l) => l.replace(STAMP, '').trim());
	return lines
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export interface NormalizedLyrics {
	plain: string | null;
	syncedLrc: string | null;
	instrumental: boolean;
}

/**
 * Normalise an LRCLIB record. Keeps synced only when it parses; derives plain
 * from synced when LRCLIB has no plain text.
 */
export function normalizeLrclib(rec: {
	plainLyrics?: string | null;
	syncedLyrics?: string | null;
	instrumental?: boolean | null;
}): NormalizedLyrics {
	const synced = isSyncedLrc(rec.syncedLyrics) ? (rec.syncedLyrics as string).trim() : null;
	const plainRaw = rec.plainLyrics?.trim() || (synced ? lrcToPlain(synced) : '');
	return {
		plain: plainRaw || null,
		syncedLrc: synced,
		instrumental: !!rec.instrumental,
	};
}

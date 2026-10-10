/**
 * Helpers for calling third-party keyless APIs politely: a descriptive
 * User-Agent, a hard timeout on every request, and a serialised throttle so a
 * bulk job never bursts a free service.
 */

export const MU_USER_AGENT = 'Mu/1.0 ( https://github.com/rw3iss/mu )';
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export interface PoliteFetchOptions {
	timeoutMs?: number;
	headers?: Record<string, string>;
}

/** `fetch` with a User-Agent and an abort timeout. Throws on network error/timeout. */
export async function fetchWithTimeout(
	url: string,
	opts: PoliteFetchOptions = {},
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
	try {
		return await fetch(url, {
			headers: { 'User-Agent': MU_USER_AGENT, ...(opts.headers ?? {}) },
			signal: controller.signal,
			redirect: 'follow',
		});
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Runs tasks one at a time, at least `minIntervalMs` apart (measured from the
 * start of the previous task). A failing task never breaks the chain.
 */
export class Throttle {
	private chain: Promise<unknown> = Promise.resolve();
	private lastStartedAt = 0;

	constructor(public minIntervalMs: number) {}

	run<T>(task: () => Promise<T>): Promise<T> {
		const exec = async (): Promise<T> => {
			const wait = this.minIntervalMs - (Date.now() - this.lastStartedAt);
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			this.lastStartedAt = Date.now();
			return task();
		};
		const next = this.chain.then(exec, exec);
		this.chain = next.catch(() => undefined);
		return next;
	}
}

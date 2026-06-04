type AnyFn<A extends unknown[]> = (...args: A) => void;

export interface Throttled<A extends unknown[]> {
	(...args: A): void;
	/** Cancel a pending trailing invocation and reset the throttle window. */
	cancel(): void;
}

/**
 * Leading + trailing throttle. Invokes `fn` immediately on the first call,
 * then at most once per `wait` ms, always flushing the latest args on the
 * trailing edge so the final value isn't dropped. Used for auto-search as the
 * user types (fire fast, but don't hammer on every keystroke).
 */
export function throttle<A extends unknown[]>(fn: AnyFn<A>, wait: number): Throttled<A> {
	let last = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: A | null = null;

	const run = (args: A) => {
		last = Date.now();
		fn(...args);
	};

	const throttled = ((...args: A) => {
		const now = Date.now();
		const remaining = wait - (now - last);
		pending = args;
		if (remaining <= 0) {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			run(args);
			pending = null;
		} else if (!timer) {
			timer = setTimeout(() => {
				timer = null;
				if (pending) {
					run(pending);
					pending = null;
				}
			}, remaining);
		}
	}) as Throttled<A>;

	throttled.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		last = 0;
		pending = null;
	};

	return throttled;
}

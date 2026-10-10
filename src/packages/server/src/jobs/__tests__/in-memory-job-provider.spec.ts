import { describe, expect, it } from 'vitest';
import { InMemoryJobProvider } from '../in-memory-job-provider.js';
import { jobTypeRegistry } from '../job-type-registry.js';

/** Minimal fakes: settings map, no-op events, DB that swallows history writes. */
function makeProvider(settings: Record<string, unknown>) {
	const events = { emit: () => {} } as any;
	const settingsSvc = { get: (k: string, d?: unknown) => settings[k] ?? d } as any;
	const database = {
		db: { insert: () => ({ values: () => ({ run: () => {} }) }) },
	} as any;
	return new InMemoryJobProvider(events, settingsSvc, database);
}

/** A handler that never resolves until released, so jobs stay "running". */
function blockingHandler() {
	const releases: (() => void)[] = [];
	const handler = () =>
		new Promise<void>((resolve) => {
			releases.push(resolve);
		});
	return { handler, releases };
}

const running = (p: InMemoryJobProvider) => p.listJobs({ status: 'running' }).map((j) => j.type);

describe('InMemoryJobProvider + JobTypeRegistry', () => {
	jobTypeRegistry.registerMany([
		{ type: 't-heavy', ioHeavy: true, encode: false, feature: 'movies' },
		{ type: 't-light', ioHeavy: false, encode: false },
		{ type: 't-music', ioHeavy: false, encode: false, feature: 'music' },
	]);

	it('caps io-heavy jobs at maxConcurrentIoJobs but lets light jobs run past', () => {
		const p = makeProvider({ encoding: { maxConcurrentJobs: 3, maxConcurrentIoJobs: 1 } });
		const { handler } = blockingHandler();
		for (const t of ['t-heavy', 't-light', 't-music']) p.registerHandler(t, handler);

		p.enqueue({ type: 't-heavy' });
		p.enqueue({ type: 't-heavy' });
		p.enqueue({ type: 't-light' });

		expect(running(p).sort()).toEqual(['t-heavy', 't-light']);
		expect(p.listJobs({ status: 'pending' }).map((j) => j.type)).toEqual(['t-heavy']);
	});

	it('applies the music sub-cap on top of the global cap', () => {
		const p = makeProvider({
			encoding: { maxConcurrentJobs: 4, maxConcurrentIoJobs: 1 },
			music: { maxConcurrentJobs: 1 },
		});
		const { handler } = blockingHandler();
		for (const t of ['t-heavy', 't-light', 't-music']) p.registerHandler(t, handler);

		p.enqueue({ type: 't-music' });
		p.enqueue({ type: 't-music' });
		p.enqueue({ type: 't-light' });

		expect(running(p).sort()).toEqual(['t-light', 't-music']);
		expect(p.listJobs({ status: 'pending' }).map((j) => j.type)).toEqual(['t-music']);
	});

	it('stamps the owning feature on job records', () => {
		const p = makeProvider({});
		const id = p.enqueue({ type: 't-music' });
		expect(p.getJob(id)?.feature).toBe('music');
		const light = p.enqueue({ type: 't-light' });
		expect(p.getJob(light)?.feature).toBeUndefined();
	});
});

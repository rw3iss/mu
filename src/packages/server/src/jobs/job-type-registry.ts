import type { FeatureName } from '@mu/shared';

/**
 * Scheduling metadata for one job type. Replaces the hard-coded type lists the
 * in-memory provider used to carry (plan §2.2 #4, §5.5): a new type that
 * forgets to register simply runs as a "light" job.
 */
export interface JobTypeSpec {
	type: string;
	/** Reads a whole media file off disk → bounded by `encoding.maxConcurrentIoJobs`. */
	ioHeavy: boolean;
	/** An encode job → eligible for CPU+GPU parallel scheduling. */
	encode: boolean;
	/**
	 * Owning product feature. Jobs of a feature with a sub-cap (music:
	 * `music.maxConcurrentJobs`) are additionally bounded by it, and the Jobs
	 * panel can filter by it.
	 */
	feature?: FeatureName;
}

/**
 * Process-wide registry of job-type specs. A plain singleton rather than a
 * Nest provider: the job backend is built by a factory with fixed constructor
 * args, and registering modules (Library, later Music) must be able to add
 * specs at their own init without import cycles.
 */
export class JobTypeRegistry {
	private readonly specs = new Map<string, JobTypeSpec>();

	register(spec: JobTypeSpec): void {
		this.specs.set(spec.type, { ...spec });
	}

	registerMany(specs: readonly JobTypeSpec[]): void {
		for (const s of specs) this.register(s);
	}

	get(type: string): JobTypeSpec | undefined {
		return this.specs.get(type);
	}

	isIoHeavy(type: string): boolean {
		return this.specs.get(type)?.ioHeavy === true;
	}

	isEncode(type: string): boolean {
		return this.specs.get(type)?.encode === true;
	}

	featureOf(type: string): FeatureName | undefined {
		return this.specs.get(type)?.feature;
	}

	list(): JobTypeSpec[] {
		return [...this.specs.values()];
	}
}

export const jobTypeRegistry = new JobTypeRegistry();

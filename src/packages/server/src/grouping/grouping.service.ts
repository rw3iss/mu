import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { WsEvent } from '@mu/shared';
import {
	forwardRef,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleInit,
} from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { type Movie, movieFiles, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import type { JobHelpers, JobRecord } from '../jobs/job.interface.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import {
	GROUP_METADATA_JOB,
	GroupMetadataService,
	type ResolvedGroupMetadata,
} from '../metadata/group-metadata.service.js';
import { MatchCandidatesRepository } from '../metadata/match-candidates.repository.js';
import { MoviesService } from '../movies/movies.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
	DEFAULT_THRESHOLDS,
	type GroupingThresholds,
	statusForConfidence,
	titleSimilarity,
} from './confidence.js';
import { FolderTreeDetector } from './detectors/folder-tree-detector.js';
import { FuzzyTitleDetector } from './detectors/fuzzy-title-detector.js';
import { MultiFileDetector } from './detectors/multi-file-detector.js';
import { SxxExxDetector } from './detectors/sxxexx-detector.js';
import type { DetectionInput, DetectionResult, Detector } from './detectors/types.js';
import { GroupsRepository } from './groups.repository.js';
import { displayTitle, parseSeasonEpisode, sanitiseRawTitle } from './title-sanitiser.js';

const SETTING_KEYS = {
	enabled: 'grouping.enabled',
	defaultView: 'grouping.default_view',
	autoConfirmMin: 'grouping.auto_confirm_min',
	unsureMin: 'grouping.unsure_min',
	fuzzyMatchThreshold: 'grouping.fuzzy_match_threshold',
} as const;

/**
 * Orchestrates the grouping pipeline:
 *  - reads thresholds from SettingsService at request time
 *  - dispatches detectors in priority order
 *  - persists groups and movie attachments
 *  - exposes admin operations (rebuild, confirm, reject, etc.)
 *
 * Detectors are pure classes; injecting them as Nest providers means
 * future plugins / phase-2 TVDB detector can register additional ones
 * without touching this orchestrator.
 */
@Injectable()
export class GroupingService implements OnModuleInit {
	private readonly logger = new Logger(GroupingService.name);
	private readonly detectors: Detector[];

	/**
	 * Per-show in-flight serialization for detection. When two episodes
	 * of the same show finish scanning back-to-back (or in parallel
	 * from a bulk re-scan), each LIBRARY_MOVIE_ADDED handler races the
	 * other to look up "does a parent group named X already exist?".
	 * Both saw `null` and both inserted → duplicate parent.
	 *
	 * Keyed by normalised show name (and movieId for the fallback path
	 * where no name has been derived yet). Each new detection waits on
	 * any prior in-flight detection for the same key before running,
	 * so the second one sees the parent the first one created.
	 */
	private readonly inflightDetection = new Map<string, Promise<string | null>>();

	constructor(
		private readonly repo: GroupsRepository,
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly events: EventsService,
		private readonly jobs: JobManagerService,
		private readonly groupMetadata: GroupMetadataService,
		private readonly matchCandidates: MatchCandidatesRepository,
		@Inject(forwardRef(() => MoviesService))
		private readonly moviesService: MoviesService,
		sxxexx: SxxExxDetector,
		folderTree: FolderTreeDetector,
		multiFile: MultiFileDetector,
		fuzzyTitle: FuzzyTitleDetector,
	) {
		// Sort by priority once; new providers from phase-2 will join here.
		this.detectors = [sxxexx, folderTree, multiFile, fuzzyTitle].sort(
			(a, b) => a.priority - b.priority,
		);
	}

	onModuleInit(): void {
		// React to newly-imported movies — the scanner fires this immediately
		// after a successful insert. Runs detection off the import critical
		// path so big bulk scans aren't slowed by the fuzzy-match pass.
		this.events.on(WsEvent.LIBRARY_MOVIE_ADDED, (data: unknown) => {
			const ev = data as { movieId?: string };
			if (!ev?.movieId) return;
			// Fire and forget; errors are logged inside detectAndAttach.
			this.detectAndAttach(ev.movieId).catch((err) => {
				this.logger.warn(`Grouping detection failed for ${ev.movieId}: ${err?.message}`);
			});
		});

		// Register the async rebuild handler so callers can enqueue a
		// background pass and stream progress over the existing WS job
		// channel (JOB_STARTED / JOB_PROGRESS / JOB_COMPLETED).
		this.jobs.registerHandler('grouping-rebuild', async (_job, helpers) =>
			this.rebuildAllWithProgress(helpers),
		);
		this.jobs.registerHandler('grouping-repair-series', async (_job, helpers) =>
			this.repairSeries(helpers),
		);

		// Auto-trigger enrichment for newly-created parent groups. The
		// metadata module is a pure resolver — this orchestrator owns
		// the write back to movie_groups, so the module direction is
		// `grouping → metadata`, never the reverse.
		this.jobs.registerHandler(GROUP_METADATA_JOB, async (job: JobRecord) => {
			const groupId = job.payload?.groupId as string | undefined;
			if (!groupId) return { skipped: true };
			return this.refreshGroupMetadata(groupId).catch((err: any) => {
				this.logger.warn(`group-metadata job ${groupId} failed: ${err?.message}`);
				return { groupId, error: err?.message };
			});
		});
	}

	/**
	 * Resolve TMDB metadata for a parent group and write the resulting
	 * patch onto the row. Used by the `group-metadata` job auto-trigger
	 * and by the manual refresh endpoint.
	 */
	async refreshGroupMetadata(groupId: string) {
		const group = this.repo.get(groupId);
		if (!group) throw new NotFoundException(`Group ${groupId} not found`);
		const patch = await this.groupMetadata.resolveForGroup(group);
		if (!patch) return null;
		this.applyMetadataPatch(groupId, patch);
		return this.repo.get(groupId);
	}

	/**
	 * Apply a user-picked candidate row. Clears the candidate dropdown,
	 * resolves the picked provider's details, writes the patch.
	 */
	async applyGroupMatchCandidate(groupId: string, provider: string, externalId: string) {
		const row = this.matchCandidates.find('group', groupId, provider, externalId);
		if (!row) {
			throw new NotFoundException(
				`Candidate not found: group=${groupId} provider=${provider} externalId=${externalId}`,
			);
		}
		const patch = await this.groupMetadata.resolveByCandidate(provider, externalId);
		this.matchCandidates.clear('group', groupId);
		if (!patch) return null;
		this.applyMetadataPatch(groupId, patch);
		return this.repo.get(groupId);
	}

	private applyMetadataPatch(groupId: string, patch: ResolvedGroupMetadata): void {
		// Adopt the provider's canonical name ("The Last of Us") so a parent
		// first named from a mangled filename gets its real title, and its
		// season subgroups follow.
		if (patch.name?.trim() && this.shouldAdoptName(groupId, patch.name.trim())) {
			this.renameParent(groupId, patch.name.trim());
		}
		this.repo.update(groupId, {
			tmdbTvId: patch.tmdbTvId ?? null,
			imdbId: patch.imdbId ?? null,
			posterUrl: patch.posterUrl ?? null,
			backdropUrl: patch.backdropUrl ?? null,
			overview: patch.overview ?? null,
		});
		// Once a stable external id lands on this parent, look for any
		// sibling parents already carrying the same id and merge them
		// in. This catches the race where two LIBRARY_MOVIE_ADDED
		// handlers both inserted a parent for the same show before the
		// per-show lock was added — the leftover duplicate gets folded
		// here as soon as either parent learns its TMDB id.
		if (patch.tmdbTvId) {
			this.dedupeByTmdbTvId(groupId, patch.tmdbTvId);
		}
	}

	/**
	 * Take the provider's name only when it's the same title (casing,
	 * article, punctuation) or the current name is a truncation of it
	 * ("Last Of" → "The Last of Us"). A shorter or unrelated provider name
	 * means a weak match ("South Park" matched to a show called "South") —
	 * keep ours.
	 */
	private shouldAdoptName(groupId: string, providerName: string): boolean {
		const cur = this.repo.get(groupId);
		if (!cur) return false;
		const a = sanitiseRawTitle(cur.name);
		const b = sanitiseRawTitle(providerName);
		if (!a || a === 'unknown show') return true;
		if (!b) return false;
		if (a === b) return true;
		if (b.startsWith(a)) return b.length > a.length;
		return titleSimilarity(a, b) >= 0.85;
	}

	/** Rename a parent and its "<Show> - Season N" subgroups. */
	private renameParent(parentId: string, name: string): void {
		const parent = this.repo.get(parentId);
		if (!parent || parent.type !== 'parent') return;
		if (parent.name !== name) this.repo.update(parentId, { name });
		for (const sg of this.repo.listChildren(parentId)) {
			if (sg.ordinal == null || sg.name === 'Specials') continue;
			if (!/ - Season \d+$/.test(sg.name)) continue;
			const want = `${name} - Season ${sg.ordinal}`;
			if (sg.name !== want) this.repo.update(sg.id, { name: want });
		}
	}

	/**
	 * Enqueue the series repair pass (see {@link repairSeries}). Returns the
	 * job id; progress streams over the job WS channel.
	 */
	enqueueRepairSeries(): { jobId: string } {
		const jobId = this.jobs.enqueue({
			type: 'grouping-repair-series',
			label: 'Repair TV series groups',
			payload: {},
			priority: 30,
		});
		return { jobId };
	}

	/**
	 * Heal series groups built from mangled names or duplicate downloads:
	 *  1. resolve TMDB metadata for every parent (adopts the canonical name,
	 *     merges parents that share a TMDB id);
	 *  2. merge parents whose normalised names match ("Last Of Us" / "The Last of Us");
	 *  3. rewrite episode titles whose show part is wrong ("South - S28E01" →
	 *     "South Park - S28E01") for movies with no TMDB match;
	 *  4. fold duplicate episodes (same show + SxxEyy, e.g. two releases) into
	 *     one entry with several files (versions).
	 */
	async repairSeries(helpers: JobHelpers | null = null): Promise<{
		metadataResolved: number;
		parentsMerged: number;
		titlesFixed: number;
		episodesMerged: number;
	}> {
		const out = {
			redetected: 0,
			renamed: 0,
			metadataResolved: 0,
			parentsMerged: 0,
			titlesFixed: 0,
			episodesMerged: 0,
		};

		// 0a. Re-detect episodes parked under "Unknown Show" and ungrouped
		// library movies that are clearly episodes (SxxEyy in title or file).
		const redetect = new Set<string>();
		for (const p of this.repo.listParents()) {
			if (sanitiseRawTitle(p.name) !== 'unknown show') continue;
			for (const sg of this.repo.listChildren(p.id)) {
				for (const m of this.repo.listMoviesInSubgroup(sg.id)) redetect.add(m.id);
			}
		}
		const ungrouped = this.database.db
			.select({ id: movies.id, title: movies.title, fileName: movieFiles.fileName })
			.from(movies)
			.innerJoin(movieFiles, eq(movieFiles.movieId, movies.id))
			.where(
				sql`${movies.groupId} IS NULL AND (${movies.source} IS NULL OR ${movies.source} = 'library')`,
			)
			.all();
		for (const r of ungrouped) {
			if (parseSeasonEpisode(r.title) || parseSeasonEpisode(r.fileName ?? '')) {
				redetect.add(r.id);
			}
		}
		for (const id of redetect) {
			this.repo.detachMovie(id);
			if (await this.detectAndAttach(id).catch(() => null)) out.redetected++;
		}
		for (const p of this.repo.listParents()) {
			for (const sg of this.repo.listChildren(p.id)) {
				if (this.repo.movieCountInSubgroup(sg.id) === 0) this.repo.delete(sg.id);
			}
			this.repo.deleteIfEmpty(p.id);
		}

		// 0b. Parents with no TMDB id whose name was cut short by the old
		// extension bug ("Marvel S Iron") — rebuild it from member file names.
		for (const p of this.repo.listParents()) {
			if (p.tmdbTvId || p.status === 'confirmed') continue;
			const better = this.nameFromMemberFiles(p.id);
			if (!better) continue;
			const a = sanitiseRawTitle(p.name);
			const b = sanitiseRawTitle(better);
			if (b && b !== a && b.length > a.length && (b.startsWith(a) || a.length <= 3)) {
				this.renameParent(p.id, better);
				out.renamed++;
			}
		}

		// 1. TMDB pass.
		const parents = this.repo.listParents();
		for (let i = 0; i < parents.length; i++) {
			const p = this.repo.get(parents[i]!.id);
			if (!p) continue; // merged away by an earlier dedupe
			try {
				if (await this.refreshGroupMetadata(p.id)) out.metadataResolved++;
			} catch (err: any) {
				this.logger.warn(`repair: metadata for "${p.name}" failed: ${err?.message}`);
			}
			helpers?.reportProgress(((i + 1) / Math.max(1, parents.length)) * 60);
		}

		// 2. Merge parents with the same normalised name.
		const byName = new Map<string, string>();
		for (const p of this.repo.listParents()) {
			const key = sanitiseRawTitle(p.name);
			if (!key) continue;
			const keep = byName.get(key);
			if (!keep) {
				byName.set(key, p.id);
				continue;
			}
			const keeper = this.repo.get(keep)!;
			// Keep the one TMDB identified.
			const [target, source] = keeper.tmdbTvId || !p.tmdbTvId ? [keeper, p] : [p, keeper];
			this.repo.mergeParent(source.id, target.id);
			byName.set(key, target.id);
			out.parentsMerged++;
		}
		helpers?.reportProgress(70);

		// 3 + 4. Per season subgroup: titles, then duplicate episodes.
		for (const parent of this.repo.listParents()) {
			const showKey = sanitiseRawTitle(parent.name);
			for (const sg of this.repo.listChildren(parent.id)) {
				const members = this.repo.listMoviesInSubgroup(sg.id);
				for (const m of members) {
					if (m.tmdbId) continue;
					const se = parseSeasonEpisode(m.title);
					if (!se) continue;
					const titleShow = sanitiseRawTitle(se.prefix);
					if (!showKey || showKey === 'unknown show' || titleShow === showKey) continue;
					// Only fix a title whose show part is missing, "Unknown Show",
					// or a truncation of the parent's ("south" ⊂ "south park") —
					// never a different show.
					if (
						titleShow &&
						titleShow !== 'unknown show' &&
						!showKey.startsWith(titleShow)
					) {
						continue;
					}
					const rest = m.title.slice(se.startIndex + se.matchText.length + 1);
					const tag = `S${pad2(se.season)}E${pad2(se.episode)}`;
					const title = `${parent.name} - ${tag}${rest.trim() ? ` ${rest.trim()}` : ''}`;
					this.database.db
						.update(movies)
						.set({ title, updatedAt: new Date().toISOString() })
						.where(eq(movies.id, m.id))
						.run();
					out.titlesFixed++;
				}
				out.episodesMerged += await this.mergeDuplicateEpisodes(sg.id);
			}
		}
		helpers?.reportProgress(100);
		if (out.titlesFixed || out.episodesMerged) {
			this.events.emit('library:movie-updated', {});
		}
		this.logger.log(`Series repair: ${JSON.stringify(out)}`);
		helpers?.log(`Series repair: ${JSON.stringify(out)}`);
		return out;
	}

	/** Most common display show name across a parent's member file names. */
	private nameFromMemberFiles(parentId: string): string | null {
		const counts = new Map<string, number>();
		for (const sg of this.repo.listChildren(parentId)) {
			for (const m of this.repo.listMoviesInSubgroup(sg.id)) {
				const f = this.database.db
					.select({ fileName: movieFiles.fileName })
					.from(movieFiles)
					.where(eq(movieFiles.movieId, m.id))
					.get();
				const se = parseSeasonEpisode(f?.fileName ?? '');
				const name = se ? displayTitle(se.prefix) : '';
				if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
			}
		}
		let best: string | null = null;
		let n = 0;
		for (const [k, v] of counts) {
			if (v > n) {
				best = k;
				n = v;
			}
		}
		return best;
	}

	/**
	 * Within one season subgroup, fold movies that are the same episode into
	 * one: the keeper gets every file (shown as versions), the duplicate's
	 * watch progress moves over when the keeper has none, then it's purged.
	 */
	private async mergeDuplicateEpisodes(subgroupId: string): Promise<number> {
		const members = this.repo.listMoviesInSubgroup(subgroupId);
		const byEpisode = new Map<string, typeof members>();
		for (const m of members) {
			const files = this.database.db
				.select({ fileName: movieFiles.fileName })
				.from(movieFiles)
				.where(eq(movieFiles.movieId, m.id))
				.all();
			const se =
				parseSeasonEpisode(m.title) ??
				files.map((f) => parseSeasonEpisode(f.fileName ?? '')).find(Boolean) ??
				null;
			if (!se) continue;
			const key = `${se.season}:${se.episode}`;
			byEpisode.set(key, [...(byEpisode.get(key) ?? []), m]);
		}
		let merged = 0;
		for (const group of byEpisode.values()) {
			if (group.length < 2) continue;
			// Keeper: TMDB-matched first, then the oldest entry.
			const sorted = [...group].sort(
				(a, b) =>
					Number(!!b.tmdbId) - Number(!!a.tmdbId) ||
					String(a.addedAt).localeCompare(String(b.addedAt)),
			);
			const keeper = sorted[0]!;
			for (const dup of sorted.slice(1)) {
				this.database.db
					.update(movieFiles)
					.set({ movieId: keeper.id })
					.where(eq(movieFiles.movieId, dup.id))
					.run();
				this.database.db.run(sql`
					UPDATE play_history SET entity_id = ${keeper.id}
					WHERE entity_type = 'movie' AND entity_id = ${dup.id}
					  AND user_id NOT IN (
						SELECT user_id FROM play_history
						WHERE entity_type = 'movie' AND entity_id = ${keeper.id})`);
				await this.moviesService.purgeMovie(dup.id);
				this.logger.log(`Merged duplicate episode "${dup.title}" into "${keeper.title}"`);
				merged++;
			}
		}
		return merged;
	}

	private dedupeByTmdbTvId(canonicalParentId: string, tmdbTvId: number): void {
		const siblings = this.repo.findSiblingParentsByTmdbTvId(canonicalParentId, tmdbTvId);
		for (const sib of siblings) {
			const r = this.repo.mergeParent(sib.id, canonicalParentId);
			this.logger.log(
				`Merged duplicate parent ${sib.id} ("${sib.name}") into ${canonicalParentId}: ` +
					`subgroupsMerged=${r.subgroupsMerged} subgroupsMoved=${r.subgroupsMoved} ` +
					`moviesMoved=${r.moviesMoved}`,
			);
		}
	}

	// ── Public API ────────────────────────────────────────────

	isEnabled(): boolean {
		return this.settings.get<boolean>(SETTING_KEYS.enabled, true);
	}

	getThresholds(): GroupingThresholds {
		return {
			autoConfirmMin: this.settings.get<number>(
				SETTING_KEYS.autoConfirmMin,
				DEFAULT_THRESHOLDS.autoConfirmMin,
			),
			unsureMin: this.settings.get<number>(
				SETTING_KEYS.unsureMin,
				DEFAULT_THRESHOLDS.unsureMin,
			),
			fuzzyMatchThreshold: this.settings.get<number>(
				SETTING_KEYS.fuzzyMatchThreshold,
				DEFAULT_THRESHOLDS.fuzzyMatchThreshold,
			),
		};
	}

	/**
	 * Run the pipeline on a single movie. Returns the subgroup that the
	 * movie ended up attached to, or null if no detection passed the
	 * unsureMin threshold.
	 */
	async detectAndAttach(movieId: string): Promise<string | null> {
		if (!this.isEnabled()) return null;
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) return null;

		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();
		if (!file?.filePath) return null;

		const filePath = file.filePath;
		const fileName = path.basename(filePath);
		const siblingPaths = await this.readSiblings(filePath);
		const existingParents = this.repo.listParents();

		const input: DetectionInput = {
			movieId: movie.id,
			movieTitle: movie.title,
			filePath,
			fileName,
			existingParents,
			siblingPaths,
		};

		const thresholds = this.getThresholds();
		let bestResult: DetectionResult | null = null;
		for (const det of this.detectors) {
			const result = det.detect(input);
			if (result && result.confidence >= thresholds.unsureMin) {
				bestResult = result;
				break;
			}
		}
		if (!bestResult) {
			this.logger.debug(`No grouping detection for movie ${movieId}`);
			return null;
		}

		// Serialize persistence per-show so concurrent detections of the
		// same series can't both miss an existing parent and create
		// duplicates. The lock key is the detected show name (already
		// title-cased + normalised by the detector); falling back to
		// movieId for anonymous detections (no parentName).
		const lockKey = `parent:${bestResult.parentName ?? `movie:${movie.id}`}`;
		const prior = this.inflightDetection.get(lockKey);
		const run = (prior ? prior.catch(() => null) : Promise.resolve()).then(() =>
			Promise.resolve(this.persistDetection(movie, bestResult, thresholds)),
		);
		this.inflightDetection.set(lockKey, run);
		try {
			return await run;
		} finally {
			// Only clear if no later detection has chained onto this key;
			// otherwise the chain stays in place.
			if (this.inflightDetection.get(lockKey) === run) {
				this.inflightDetection.delete(lockKey);
			}
		}
	}

	async rebuildAll(): Promise<{ scanned: number; grouped: number; pruned: number }> {
		return this.rebuildAllWithProgress(null);
	}

	/**
	 * Enqueue a background rebuild and return immediately. Caller gets
	 * the jobId + total-movie count up-front; progress streams over the
	 * existing `JOB_PROGRESS` WebSocket channel; final summary lands in
	 * `JOB_COMPLETED`.
	 *
	 * Used by the admin "Group Similar Items" button so a library of
	 * thousands of movies doesn't time out the request.
	 */
	enqueueRebuild(): { jobId: string; totalMovies: number } {
		const totalMovies = this.database.db.select({ id: movies.id }).from(movies).all().length;
		const jobId = this.jobs.enqueue({
			type: 'grouping-rebuild',
			label: `Group similar items (${totalMovies} movies)`,
			payload: { totalMovies },
			priority: 30,
		});
		return { jobId, totalMovies };
	}

	private async rebuildAllWithProgress(
		helpers: JobHelpers | null,
	): Promise<{ scanned: number; grouped: number; pruned: number }> {
		const tStart = Date.now();
		// Wipe non-confirmed groups + detach those movies.
		const wipe = this.repo.wipeAutoAndUnsure();
		this.logger.log(
			`Rebuild start: wiped ${wipe.groupsDeleted} auto/unsure groups, detached ${wipe.moviesDetached} movies`,
		);
		helpers?.log(
			`Wiped ${wipe.groupsDeleted} auto/unsure groups, detached ${wipe.moviesDetached} movies`,
		);

		// Only library movies should be grouped — bookmarks/externals
		// have no local file path, so detection would always early-out
		// anyway, but iterating over them inflates the scanned count
		// and pollutes the progress percentage.
		const allMovies = this.database.db
			.select({ id: movies.id })
			.from(movies)
			.where(sql`(${movies.source} IS NULL OR ${movies.source} = 'library')`)
			.all();
		const total = allMovies.length;
		// Per-detector counters so we can spot which strategies are
		// actually firing (or all silently no-op'ing).
		const stats = {
			noMovie: 0,
			noFile: 0,
			noDetection: 0,
			belowThreshold: 0,
			attached: 0,
			errors: 0,
			bySource: {} as Record<string, number>,
		};

		this.logger.log(`Rebuild: scanning ${total} library movies`);
		helpers?.log(`Scanning ${total} library movies`);

		// 90% of the progress bar goes to detection; the final 10% is
		// the prune sweep so the UI doesn't stall at 100% before it's
		// truly done.
		for (let i = 0; i < allMovies.length; i++) {
			const m = allMovies[i]!;
			try {
				const detail = await this.detectAndAttachWithDiagnostics(m.id);
				if (detail.outcome === 'attached') {
					stats.attached++;
					stats.bySource[detail.source!] = (stats.bySource[detail.source!] ?? 0) + 1;
				} else if (detail.outcome === 'no-movie') {
					stats.noMovie++;
				} else if (detail.outcome === 'no-file') {
					stats.noFile++;
				} else if (detail.outcome === 'below-threshold') {
					stats.belowThreshold++;
				} else {
					stats.noDetection++;
				}
			} catch (err: any) {
				stats.errors++;
				this.logger.warn(`detectAndAttach error for ${m.id}: ${err?.message ?? err}`);
			}
			if (helpers && total > 0 && (i % 25 === 0 || i === total - 1)) {
				helpers.reportProgress(((i + 1) / total) * 90);
			}
		}

		// Snapshot the population BEFORE prune so the log makes it
		// obvious what got created vs. what got swept.
		const beforePrune = this.repo.listSubgroupsWithMemberCounts();
		const beforeBuckets = bucketByCount(beforePrune);
		this.logger.log(
			`Detection done in ${Date.now() - tStart}ms. ` +
				`Outcomes: attached=${stats.attached} noFile=${stats.noFile} ` +
				`noDetection=${stats.noDetection} belowThreshold=${stats.belowThreshold} ` +
				`noMovie=${stats.noMovie} errors=${stats.errors}. ` +
				`Subgroups before prune: ${beforePrune.length} ` +
				`(singletons=${beforeBuckets.singletons}, pairs=${beforeBuckets.pairs}, ` +
				`3-5=${beforeBuckets.small}, 6+=${beforeBuckets.large}). ` +
				`Detector breakdown: ${JSON.stringify(stats.bySource)}`,
		);
		helpers?.log(
			`Detection: ${stats.attached}/${total} attached, ${stats.noFile} skipped (no file), ` +
				`${stats.noDetection + stats.belowThreshold} no detector matched.`,
		);
		helpers?.reportProgress(95);

		const pruned = this.pruneSingleMemberSubgroups();
		const remainingSubgroups = this.repo.listSubgroupsWithMemberCounts();
		this.logger.log(
			`Rebuild complete in ${Date.now() - tStart}ms. ` +
				`Pruned ${pruned} singleton subgroup(s). ` +
				`Final state: ${remainingSubgroups.length} subgroup(s) containing ` +
				`${remainingSubgroups.reduce((a, s) => a + s.memberCount, 0)} movies.`,
		);
		helpers?.log(
			`Done. ${stats.attached} attached → ${remainingSubgroups.length} subgroup(s) survived ` +
				`(${pruned} singletons pruned).`,
		);
		helpers?.reportProgress(100);

		return {
			scanned: total,
			grouped: remainingSubgroups.reduce((a, s) => a + s.memberCount, 0),
			pruned,
		};
	}

	/**
	 * Like detectAndAttach() but returns a structured outcome so the
	 * rebuild loop can tally per-stage skip reasons. Kept private —
	 * external callers should use detectAndAttach().
	 */
	private async detectAndAttachWithDiagnostics(movieId: string): Promise<{
		outcome: 'attached' | 'no-movie' | 'no-file' | 'no-detection' | 'below-threshold';
		source?: string;
	}> {
		if (!this.isEnabled()) return { outcome: 'no-detection' };
		const movie = this.database.db.select().from(movies).where(eq(movies.id, movieId)).get();
		if (!movie) return { outcome: 'no-movie' };

		const file = this.database.db
			.select()
			.from(movieFiles)
			.where(eq(movieFiles.movieId, movieId))
			.get();
		if (!file?.filePath) return { outcome: 'no-file' };

		const filePath = file.filePath;
		const fileName = path.basename(filePath);
		const siblingPaths = await this.readSiblings(filePath);
		const existingParents = this.repo.listParents();

		const input: DetectionInput = {
			movieId: movie.id,
			movieTitle: movie.title,
			filePath,
			fileName,
			existingParents,
			siblingPaths,
		};

		const thresholds = this.getThresholds();
		let bestResult: DetectionResult | null = null;
		let belowThreshold = false;
		for (const det of this.detectors) {
			const result = det.detect(input);
			if (!result) continue;
			if (result.confidence < thresholds.unsureMin) {
				belowThreshold = true;
				continue;
			}
			bestResult = result;
			break;
		}
		if (!bestResult) {
			return { outcome: belowThreshold ? 'below-threshold' : 'no-detection' };
		}

		this.persistDetection(movie, bestResult, thresholds);
		return { outcome: 'attached', source: bestResult.source };
	}

	/**
	 * Remove subgroups with fewer than 2 movies. Detaches each movie,
	 * deletes the subgroup, prunes empty parents. Skips confirmed
	 * subgroups (user explicitly OK'd those). Returns count removed.
	 */
	pruneSingleMemberSubgroups(): number {
		const underfilled = this.repo.findUnderfilledSubgroups(2);
		let removed = 0;
		for (const u of underfilled) {
			const sg = this.repo.get(u.id);
			if (!sg) continue;
			if (sg.status === 'confirmed') continue;
			const members = this.repo.listMoviesInSubgroup(u.id);
			for (const m of members) this.repo.detachMovie(m.id);
			this.repo.delete(u.id);
			if (u.parentGroupId) this.repo.deleteIfEmpty(u.parentGroupId);
			removed++;
		}
		return removed;
	}

	confirmGroup(id: string): void {
		this.repo.update(id, { status: 'confirmed', altParents: null });
	}

	/**
	 * All member movie IDs of a group — for a parent, across every subgroup;
	 * for a subgroup, its direct members. Empty when the group is unknown.
	 */
	getMemberMovieIds(groupId: string): string[] {
		const group = this.repo.get(groupId);
		if (!group) return [];
		const ids: string[] = [];
		if (group.type === 'parent') {
			for (const child of this.repo.listChildren(groupId)) {
				for (const m of this.repo.listMoviesInSubgroup(child.id)) ids.push(m.id);
			}
		} else {
			for (const m of this.repo.listMoviesInSubgroup(groupId)) ids.push(m.id);
		}
		return ids;
	}

	/** Preview for "delete group from disk": member count + common folder. */
	getDeletePreview(
		groupId: string,
	): { name: string; count: number; folder: string | null } | null {
		const group = this.repo.get(groupId);
		if (!group) return null;
		const ids = this.getMemberMovieIds(groupId);
		const paths = ids.length
			? this.database.db
					.select({ p: movieFiles.filePath })
					.from(movieFiles)
					.where(inArray(movieFiles.movieId, ids))
					.all()
					.map((r) => r.p)
					.filter((p): p is string => !!p)
			: [];
		return { name: group.name, count: ids.length, folder: commonParentFolder(paths) };
	}

	rejectGroup(id: string): void {
		// Detach all members, delete the group, prune parent if now empty.
		const group = this.repo.get(id);
		if (!group) return;
		if (group.type === 'subgroup') {
			const members = this.repo.listMoviesInSubgroup(id);
			for (const m of members) this.repo.detachMovie(m.id);
			const parentId = group.parentGroupId;
			this.repo.delete(id);
			if (parentId) this.repo.deleteIfEmpty(parentId);
		} else {
			// Parent: detach + delete every subgroup, then itself.
			const children = this.repo.listChildren(id);
			for (const c of children) {
				const members = this.repo.listMoviesInSubgroup(c.id);
				for (const m of members) this.repo.detachMovie(m.id);
				this.repo.delete(c.id);
			}
			this.repo.delete(id);
		}
	}

	/** Move a subgroup to a different parent (manual reassignment). */
	moveSubgroup(subgroupId: string, newParentId: string | null): void {
		const sg = this.repo.get(subgroupId);
		if (!sg || sg.type !== 'subgroup') return;

		const oldParentId = sg.parentGroupId;
		if (newParentId) {
			const parent = this.repo.get(newParentId);
			if (!parent || parent.type !== 'parent') return;
		}

		this.repo.update(subgroupId, {
			parentGroupId: newParentId,
			status: 'confirmed',
			altParents: null,
		});

		// Prune old parent if it just lost its last child.
		if (oldParentId) this.repo.deleteIfEmpty(oldParentId);
	}

	// ── Internal ──────────────────────────────────────────────

	private async readSiblings(filePath: string): Promise<string[]> {
		try {
			const dir = path.dirname(filePath);
			const entries = await readdir(dir);
			return entries.map((e) => path.join(dir, e));
		} catch {
			return [];
		}
	}

	private persistDetection(
		movie: Movie,
		result: DetectionResult,
		thresholds: GroupingThresholds,
	): string {
		const now = new Date().toISOString();
		const status = statusForConfidence(result.confidence, thresholds);
		// status='none' isn't a DB enum value; that branch is filtered earlier.
		const persistStatus = status === 'none' ? 'unsure' : status;

		// 1. Ensure parent exists. Look up by every stable identifier
		// we have (tmdb_tv_id / imdb_id / name) — caller may have
		// filled any of them. Name-only is the common path because the
		// SxxExx detector runs before metadata enrichment.
		let parentId = result.parentGroupId;
		let createdParent = false;
		if (!parentId) {
			const existing = this.repo.findExistingParent({
				name: result.parentName,
				tmdbTvId: result.tmdbTvId ?? null,
				imdbId: result.imdbId ?? null,
			});
			if (existing) {
				parentId = existing.id;
			} else {
				const newParent = this.repo.insert({
					id: randomUUID(),
					type: 'parent',
					groupType: result.groupTypeHint ?? 'series',
					name: result.parentName,
					parentGroupId: null,
					ordinal: null,
					status: persistStatus,
					confidence: result.confidence,
					detectionSource: result.source,
					createdAt: now,
					updatedAt: now,
				});
				parentId = newParent.id;
				createdParent = true;
			}
		}

		// Brand-new parent → kick off metadata enrichment in the
		// background. Decoupled via the job queue so we don't drag
		// MetadataModule into the grouping critical path.
		if (createdParent && parentId) {
			try {
				this.jobs.enqueue({
					type: 'group-metadata',
					label: `Enrich group "${result.parentName}"`,
					payload: { groupId: parentId },
					priority: 40,
				});
			} catch (err: any) {
				this.logger.warn(`Could not enqueue group-metadata job: ${err?.message}`);
			}
		}

		// 2. Find or create subgroup under that parent. Season subgroups are
		// named after the parent (which may carry the TMDB name), not the
		// filename-derived show name.
		let subgroup = this.repo.findSubgroup(parentId, result.ordinal);
		if (!subgroup) {
			const parentRow = this.repo.get(parentId);
			const subgroupName =
				parentRow && result.ordinal != null && / - Season \d+$/.test(result.subgroupName)
					? `${parentRow.name} - Season ${result.ordinal}`
					: result.subgroupName;
			subgroup = this.repo.insert({
				id: randomUUID(),
				type: 'subgroup',
				groupType: result.groupTypeHint ?? 'series',
				name: subgroupName,
				parentGroupId: parentId,
				ordinal: result.ordinal,
				status: persistStatus,
				confidence: result.confidence,
				altParents: result.alternatives ? JSON.stringify(result.alternatives) : null,
				detectionSource: result.source,
				createdAt: now,
				updatedAt: now,
			});
		}

		// 3. Detach movie from any previous group first, then attach.
		this.repo.attachMovie(movie.id, subgroup.id, result.episodeOrdinal);

		return subgroup.id;
	}
}

function bucketByCount(subgroups: Array<{ memberCount: number }>): {
	singletons: number;
	pairs: number;
	small: number;
	large: number;
} {
	let singletons = 0;
	let pairs = 0;
	let small = 0;
	let large = 0;
	for (const s of subgroups) {
		if (s.memberCount <= 1) singletons++;
		else if (s.memberCount === 2) pairs++;
		else if (s.memberCount <= 5) small++;
		else large++;
	}
	return { singletons, pairs, small, large };
}

/** Longest shared parent directory across a set of file paths, or null. */
function commonParentFolder(paths: string[]): string | null {
	if (paths.length === 0) return null;
	const dirs = paths.map((p) => p.replace(/\\/g, '/').split('/').slice(0, -1));
	let common = dirs[0]!;
	for (const d of dirs.slice(1)) {
		let i = 0;
		while (i < common.length && i < d.length && common[i] === d[i]) i++;
		common = common.slice(0, i);
		if (common.length === 0) break;
	}
	return common.length ? common.join('/') : null;
}

function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

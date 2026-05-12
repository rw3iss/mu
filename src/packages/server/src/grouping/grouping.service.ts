import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { WsEvent } from '@mu/shared';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { type Movie, movieFiles, movies } from '../database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
	DEFAULT_THRESHOLDS,
	statusForConfidence,
	type GroupingThresholds,
} from './confidence.js';
import { FolderTreeDetector } from './detectors/folder-tree-detector.js';
import { FuzzyTitleDetector } from './detectors/fuzzy-title-detector.js';
import { MultiFileDetector } from './detectors/multi-file-detector.js';
import { SxxExxDetector } from './detectors/sxxexx-detector.js';
import type { Detector, DetectionInput, DetectionResult } from './detectors/types.js';
import { GroupsRepository } from './groups.repository.js';

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

	constructor(
		private readonly repo: GroupsRepository,
		private readonly database: DatabaseService,
		private readonly settings: SettingsService,
		private readonly events: EventsService,
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
		const movie = this.database.db
			.select()
			.from(movies)
			.where(eq(movies.id, movieId))
			.get();
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

		return this.persistDetection(movie, bestResult, thresholds);
	}

	async rebuildAll(): Promise<{ scanned: number; grouped: number }> {
		// Wipe non-confirmed groups + detach those movies.
		const wipe = this.repo.wipeAutoAndUnsure();
		this.logger.log(
			`Rebuild: wiped ${wipe.groupsDeleted} auto/unsure groups, detached ${wipe.moviesDetached} movies`,
		);

		const allMovies = this.database.db.select({ id: movies.id }).from(movies).all();
		let grouped = 0;
		for (const m of allMovies) {
			const sg = await this.detectAndAttach(m.id);
			if (sg) grouped++;
		}
		return { scanned: allMovies.length, grouped };
	}

	confirmGroup(id: string): void {
		this.repo.update(id, { status: 'confirmed', altParents: null });
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

		// 1. Ensure parent exists.
		let parentId = result.parentGroupId;
		if (!parentId) {
			const existing = this.repo.getByNameAndType(result.parentName, 'parent');
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
			}
		}

		// 2. Find or create subgroup under that parent.
		let subgroup = this.repo.findSubgroup(parentId, result.ordinal);
		if (!subgroup) {
			subgroup = this.repo.insert({
				id: randomUUID(),
				type: 'subgroup',
				groupType: result.groupTypeHint ?? 'series',
				name: result.subgroupName,
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

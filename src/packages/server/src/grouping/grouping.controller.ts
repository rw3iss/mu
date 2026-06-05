import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	Patch,
	Post,
} from '@nestjs/common';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { EventsService } from '../events/events.service.js';
import { MatchCandidatesRepository } from '../metadata/match-candidates.repository.js';
import { GroupingService } from './grouping.service.js';
import { GroupsRepository } from './groups.repository.js';

interface ApplyCandidateBody {
	provider: string;
	externalId: string;
}

interface PatchGroupBody {
	name?: string;
	groupType?: string;
	posterUrl?: string;
	backdropUrl?: string;
	overview?: string;
	parentGroupId?: string | null;
}

@Controller('groups')
export class GroupingController {
	constructor(
		private readonly groupingService: GroupingService,
		private readonly repo: GroupsRepository,
		private readonly matchCandidates: MatchCandidatesRepository,
		private readonly events: EventsService,
	) {}

	/**
	 * Notify listeners (notably MoviesService, which busts its list cache) that
	 * groups changed — membership or display — so the interleaved library list
	 * doesn't serve a stale or just-deleted group.
	 */
	private groupsChanged(): void {
		this.events.emit('groups:changed');
	}

	@RequireAction('view:library')
	@Get()
	listParents() {
		const parents = this.repo.listParents();
		return {
			groups: parents.map((p) => {
				const summary = this.repo.getParentSummary(p.id);
				return {
					...p,
					subgroupCount: this.repo.listChildren(p.id).length,
					totalMembers: summary.totalMembers,
					// Use the group's own poster if set, otherwise borrow
					// one from a member movie so the Library tile grid
					// has something to show.
					posterUrl: p.posterUrl ?? summary.representativePosterUrl,
					// Sort-relevant fields for the mixed-library view —
					// lets the client slot the group at the right position
					// among regular movies.
					latestMemberAddedAt: summary.latestMemberAddedAt,
					earliestYear: summary.earliestYear,
				};
			}),
		};
	}

	@RequireAction('view:library')
	@Get('unsure')
	listUnsure() {
		return { groups: this.repo.listUnsure() };
	}

	@RequireAction('view:library')
	@Get(':id')
	getGroup(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		const children = group.type === 'parent' ? this.repo.listChildren(id) : [];
		const movies = group.type === 'subgroup' ? this.repo.listMoviesInSubgroup(id) : [];
		return {
			group,
			children,
			movies,
			altParents: this.repo.parseAltParents(group.altParents),
		};
	}

	@RequireAction('view:library')
	@Get(':id/movies')
	listMovies(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		if (group.type === 'subgroup') {
			return { movies: this.repo.listMoviesInSubgroup(id) };
		}
		// Parent: aggregate movies across all child subgroups.
		const children = this.repo.listChildren(id);
		const out: typeof this.repo.listMoviesInSubgroup extends (...a: any) => infer R
			? R
			: never = [] as any;
		for (const child of children) {
			out.push(...this.repo.listMoviesInSubgroup(child.id));
		}
		return { movies: out };
	}

	@RequireAction('edit:movie')
	@Post(':id/confirm')
	confirm(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		this.groupingService.confirmGroup(id);
		this.groupsChanged();
		return { ok: true };
	}

	@RequireAction('edit:movie')
	@Post(':id/reject')
	reject(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		this.groupingService.rejectGroup(id);
		this.groupsChanged();
		return { ok: true };
	}

	@RequireAction('edit:movie')
	@Patch(':id')
	patch(@Param('id') id: string, @Body() body: PatchGroupBody) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		if (body.parentGroupId !== undefined && group.type === 'subgroup') {
			// Special-cased: parent reassignment runs through service so old
			// parent gets pruned if it ends up empty.
			this.groupingService.moveSubgroup(id, body.parentGroupId);
		}
		const patch: Partial<Parameters<typeof this.repo.update>[1]> = {};
		if (body.name !== undefined) patch.name = body.name;
		if (body.groupType !== undefined) patch.groupType = body.groupType;
		if (body.posterUrl !== undefined) patch.posterUrl = body.posterUrl;
		if (body.backdropUrl !== undefined) patch.backdropUrl = body.backdropUrl;
		if (body.overview !== undefined) patch.overview = body.overview;
		if (Object.keys(patch).length > 0) this.repo.update(id, patch);
		this.groupsChanged();
		return { ok: true };
	}

	@Delete(':id')
	@Roles('admin')
	@RequireAction('delete:movie')
	remove(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		// Delegates to service for proper cleanup (detach + prune).
		this.groupingService.rejectGroup(id);
		this.groupsChanged();
		return { ok: true };
	}

	@Post('admin/rebuild')
	@Roles('admin')
	@RequireAction('edit:app-settings')
	async rebuild() {
		// Returns immediately with a jobId; progress + final summary
		// stream over the existing JOB_PROGRESS / JOB_COMPLETED WS
		// channel so the UI can show a live progress bar instead of
		// blocking the HTTP request for a multi-minute scan.
		const { jobId, totalMovies } = this.groupingService.enqueueRebuild();
		return {
			ok: true,
			jobId,
			totalMovies,
			message: `Started analysing ${totalMovies} movies in the background. Subscribe to job ${jobId} for progress.`,
		};
	}

	@Post('admin/detect/:movieId')
	@Roles('admin')
	@RequireAction('edit:movie')
	async detectOne(@Param('movieId') movieId: string) {
		if (!movieId) throw new BadRequestException('movieId required');
		const subgroupId = await this.groupingService.detectAndAttach(movieId);
		return { subgroupId };
	}

	// ── Metadata-candidate endpoints (group entity) ───────────────────
	// Routed via the grouping controller because *writes* to movie_groups
	// belong to this module. The metadata module is a pure resolver and
	// doesn't reach into this table.

	@RequireAction('view:library')
	@Get(':id/match-candidates')
	listMatchCandidates(@Param('id') groupId: string) {
		return { candidates: this.matchCandidates.list('group', groupId) };
	}

	@Post(':id/match-candidates/apply')
	@Roles('admin')
	@RequireAction('edit:movie')
	async applyMatchCandidate(@Param('id') groupId: string, @Body() body: ApplyCandidateBody) {
		if (!body?.provider || !body?.externalId) {
			throw new BadRequestException('provider and externalId required');
		}
		const result = await this.groupingService.applyGroupMatchCandidate(
			groupId,
			body.provider,
			body.externalId,
		);
		return result ?? { message: 'Candidate applied (no details returned)' };
	}

	@Delete(':id/match-candidates')
	@Roles('admin')
	@RequireAction('edit:movie')
	clearMatchCandidates(@Param('id') groupId: string) {
		this.matchCandidates.clear('group', groupId);
		return { ok: true };
	}

	@Post(':id/refresh-metadata')
	@Roles('admin')
	@RequireAction('edit:movie')
	async refreshMetadata(@Param('id') groupId: string) {
		const result = await this.groupingService.refreshGroupMetadata(groupId);
		return result ?? { message: 'No metadata found' };
	}
}

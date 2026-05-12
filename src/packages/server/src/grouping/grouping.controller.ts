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
import { Roles } from '../common/decorators/roles.decorator.js';
import { GroupingService } from './grouping.service.js';
import { GroupsRepository } from './groups.repository.js';

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
	) {}

	@Get()
	listParents() {
		const parents = this.repo.listParents();
		return {
			groups: parents.map((p) => ({
				...p,
				subgroupCount: this.repo.listChildren(p.id).length,
			})),
		};
	}

	@Get('unsure')
	listUnsure() {
		return { groups: this.repo.listUnsure() };
	}

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

	@Get(':id/movies')
	listMovies(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		if (group.type === 'subgroup') {
			return { movies: this.repo.listMoviesInSubgroup(id) };
		}
		// Parent: aggregate movies across all child subgroups.
		const children = this.repo.listChildren(id);
		const out: typeof this.repo.listMoviesInSubgroup extends (...a: any) => infer R ? R : never =
			[] as any;
		for (const child of children) {
			out.push(...this.repo.listMoviesInSubgroup(child.id));
		}
		return { movies: out };
	}

	@Post(':id/confirm')
	confirm(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		this.groupingService.confirmGroup(id);
		return { ok: true };
	}

	@Post(':id/reject')
	reject(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		this.groupingService.rejectGroup(id);
		return { ok: true };
	}

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
		return { ok: true };
	}

	@Delete(':id')
	@Roles('admin')
	remove(@Param('id') id: string) {
		const group = this.repo.get(id);
		if (!group) throw new NotFoundException(`Group ${id} not found`);
		// Delegates to service for proper cleanup (detach + prune).
		this.groupingService.rejectGroup(id);
		return { ok: true };
	}

	@Post('admin/rebuild')
	@Roles('admin')
	async rebuild() {
		const result = await this.groupingService.rebuildAll();
		return result;
	}

	@Post('admin/detect/:movieId')
	@Roles('admin')
	async detectOne(@Param('movieId') movieId: string) {
		if (!movieId) throw new BadRequestException('movieId required');
		const subgroupId = await this.groupingService.detectAndAttach(movieId);
		return { subgroupId };
	}
}

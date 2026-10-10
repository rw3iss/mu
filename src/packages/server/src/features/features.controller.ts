import type { FeatureFlags } from '@mu/shared';
import { Body, Controller, Get, Put, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../common/decorators/public.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { FeatureFlagsService } from './feature-flags.service.js';

const featuresSchema = z
	.object({
		movies: z.boolean().optional(),
		music: z.boolean().optional(),
	})
	.strict();

@Controller('features')
export class FeaturesController {
	constructor(private readonly features: FeatureFlagsService) {}

	/**
	 * Public: which product features are on. Read before login (Setup, login
	 * page) and by every client to hide disabled entry points. Not sensitive.
	 */
	@Get()
	@Public()
	get(): FeatureFlags {
		return this.features.getAll();
	}

	/** Admin: enable/disable features. Data is kept when a feature is disabled. */
	@Put()
	@Roles('admin')
	@RequireAction('edit:app-settings')
	@UsePipes(new ZodValidationPipe(featuresSchema))
	set(@Body() body: Partial<FeatureFlags>): FeatureFlags {
		return this.features.set(body);
	}
}

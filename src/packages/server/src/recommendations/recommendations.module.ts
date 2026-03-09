import { Module } from '@nestjs/common';
import { RecommendationsController } from './recommendations.controller.js';
import { RecommendationsService } from './recommendations.service.js';
import { TasteProfileService } from './taste-profile.service.js';

@Module({
	controllers: [RecommendationsController],
	providers: [RecommendationsService, TasteProfileService],
	exports: [RecommendationsService],
})
export class RecommendationsModule {}

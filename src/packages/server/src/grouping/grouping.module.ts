import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { FolderTreeDetector } from './detectors/folder-tree-detector.js';
import { FuzzyTitleDetector } from './detectors/fuzzy-title-detector.js';
import { MultiFileDetector } from './detectors/multi-file-detector.js';
import { SxxExxDetector } from './detectors/sxxexx-detector.js';
import { GroupingController } from './grouping.controller.js';
import { GroupingService } from './grouping.service.js';
import { GroupsRepository } from './groups.repository.js';

/**
 * Movie grouping module. Detects related videos (TV seasons, multi-part
 * collections, etc.) and exposes them as a Parent → Subgroup → Movie
 * hierarchy.
 *
 * Detectors are pure providers — adding a new one (e.g. the planned
 * phase-2 TMDB-TV detector) is a single `providers` addition here plus
 * registering it inside GroupingService's constructor.
 */
@Module({
	imports: [SettingsModule, EventsModule, MetadataModule],
	controllers: [GroupingController],
	providers: [
		GroupsRepository,
		GroupingService,
		SxxExxDetector,
		FolderTreeDetector,
		MultiFileDetector,
		FuzzyTitleDetector,
	],
	exports: [GroupingService, GroupsRepository],
})
export class GroupingModule {}

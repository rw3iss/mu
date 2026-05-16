import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { AudioProfilesModule } from './audio-profiles/audio-profiles.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BookmarksModule } from './bookmarks/bookmarks.module.js';
import { CacheModule } from './cache/cache.module.js';
import { CommonModule } from './common/common.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EmbeddingsModule } from './embeddings/embeddings.module.js';
import { EventsModule } from './events/events.module.js';
import { FilesystemModule } from './filesystem/filesystem.module.js';
import { GroupingModule } from './grouping/grouping.module.js';
import { HealthModule } from './health/health.module.js';
import { JobModule } from './jobs/job.module.js';
import { LibraryModule } from './library/library.module.js';
import { LlmModule } from './llm/llm.module.js';
import { MediaModule } from './media/media.module.js';
import { MetadataModule } from './metadata/metadata.module.js';
import { MoviesModule } from './movies/movies.module.js';
import { PluginModule } from './plugins/plugin.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { RecommendationsModule } from './recommendations/recommendations.module.js';
import { RemoteModule } from './remote/remote.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { ShareLinksModule } from './share-links/share-links.module.js';
import { SharingModule } from './sharing/sharing.module.js';
import { StreamModule } from './stream/stream.module.js';
import { ThemesModule } from './themes/themes.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
	imports: [
		ConfigModule,
		DatabaseModule,
		CommonModule,
		CacheModule,
		AuthModule,
		UsersModule,
		EventsModule,
		SchedulerModule,
		JobModule,
		HealthModule,
		LibraryModule,
		MoviesModule,
		MetadataModule,
		MediaModule,
		StreamModule,
		PluginModule,
		BookmarksModule,
		ProvidersModule,
		EmbeddingsModule,
		LlmModule,
		RecommendationsModule,
		RemoteModule,
		SettingsModule,
		ShareLinksModule,
		SharingModule,
		FilesystemModule,
		AdminModule,
		AudioProfilesModule,
		ThemesModule,
		GroupingModule,
	],
	providers: [
		{
			provide: APP_GUARD,
			useClass: JwtAuthGuard,
		},
		{
			provide: APP_GUARD,
			useClass: RolesGuard,
		},
	],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MetadataModule } from '../metadata/metadata.module.js';
import { SeoService } from './seo.service.js';

@Module({
	imports: [CommonModule, ConfigModule, DatabaseModule, MetadataModule],
	providers: [SeoService],
	exports: [SeoService],
})
export class SeoModule {}

import { Module } from '@nestjs/common';
import { ShareLinksController } from './share-links.controller.js';
import { ShareLinksService } from './share-links.service.js';

@Module({
	controllers: [ShareLinksController],
	providers: [ShareLinksService],
	exports: [ShareLinksService],
})
export class ShareLinksModule {}

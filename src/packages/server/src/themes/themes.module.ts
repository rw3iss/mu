import { Module } from '@nestjs/common';
import { ThemesController } from './themes.controller.js';
import { ThemesService } from './themes.service.js';

@Module({
	controllers: [ThemesController],
	providers: [ThemesService],
	exports: [ThemesService],
})
export class ThemesModule {}

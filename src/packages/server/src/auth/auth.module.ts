import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
	imports: [LibraryModule],
	controllers: [AuthController],
	providers: [AuthService],
	exports: [AuthService],
})
export class AuthModule {}

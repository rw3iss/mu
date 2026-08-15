import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RegistrationService } from './registration.service.js';

@Module({
	imports: [LibraryModule],
	controllers: [AuthController],
	providers: [AuthService, RegistrationService],
	exports: [AuthService, RegistrationService],
})
export class AuthModule {}

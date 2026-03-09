import { Controller, Post, Get, Body, Req, Res, UsePipes, Logger } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LibraryService } from '../library/library.service.js';
import { LibraryJobsService } from '../library/library-jobs.service.js';
import { loginSchema, setupSchema } from './dto/login.dto.js';
import type { LoginDto, SetupDto } from './dto/login.dto.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ConfigService } from '../config/config.service.js';

@Controller('auth')
export class AuthController {
	private readonly logger = new Logger('AuthController');

	constructor(
		private readonly authService: AuthService,
		private readonly libraryService: LibraryService,
		private readonly libraryJobs: LibraryJobsService,
		private readonly config: ConfigService,
	) {}

	@Post('setup')
	@Public()
	@UsePipes(new ZodValidationPipe(setupSchema))
	async setup(@Body() body: SetupDto, @Req() req: any, @Res({ passthrough: true }) reply: any) {
		const user = await this.authService.setup(body);
		const { accessToken } = await this.authService.generateTokens(user as any, req.server);

		reply.setCookie('mu_access_token', accessToken, {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
			maxAge: 15 * 60,
		});

		// Compute effective paths: prefer mediaPaths array, fall back to single mediaPath
		const effectivePaths = (
			body.mediaPaths?.length ? body.mediaPaths : body.mediaPath ? [body.mediaPath] : []
		).filter((p) => p.trim());

		const sources: any[] = [];
		for (const mediaPath of effectivePaths) {
			try {
				const source = this.libraryService.addSource(mediaPath);
				sources.push(source);
				this.libraryJobs.enqueueScan(source.id, `Initial scan: ${mediaPath}`);
				this.logger.log(`Media source created during setup: ${mediaPath}`);
			} catch (err: any) {
				this.logger.warn(`Failed to create media source during setup: ${err.message}`);
			}
		}

		return { user, accessToken, sources };
	}

	@Post('login')
	@Public()
	@UsePipes(new ZodValidationPipe(loginSchema))
	async login(@Body() body: LoginDto, @Req() req: any, @Res({ passthrough: true }) reply: any) {
		const user = await this.authService.login(body.username, body.password);
		const { accessToken } = await this.authService.generateTokens(user, req.server);

		reply.setCookie('mu_access_token', accessToken, {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
			maxAge: 15 * 60,
		});

		return { user, accessToken };
	}

	@Post('logout')
	async logout(@Res({ passthrough: true }) reply: any) {
		reply.clearCookie('mu_access_token', {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
		});
		return { success: true };
	}

	@Get('me')
	async me(@CurrentUser() user: any) {
		// JWT payload has { sub, role } — look up full user
		const userId = user.sub ?? user.id;
		const fullUser = await this.authService.findById(userId);
		if (!fullUser) {
			return user;
		}
		return fullUser;
	}

	@Get('status')
	@Public()
	async status() {
		const setupComplete = await this.authService.isSetupComplete();
		const localBypass = this.config.get<boolean>('auth.localBypass', true);
		return { setupComplete, localBypass };
	}
}

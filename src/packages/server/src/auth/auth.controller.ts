import type { RegistrationConfig, RegistrationResult } from '@mu/shared';
import {
	Body,
	Controller,
	Get,
	Logger,
	Post,
	Put,
	Query,
	Req,
	Res,
	UsePipes,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ConfigService } from '../config/config.service.js';
import { LibraryService } from '../library/library.service.js';
import { LibraryJobsService } from '../library/library-jobs.service.js';
import { AuthService } from './auth.service.js';
import type { LoginDto, SetupDto } from './dto/login.dto.js';
import { loginSchema, setupSchema } from './dto/login.dto.js';
import type { RegisterDto, RegistrationConfigDto } from './dto/register.dto.js';
import { registerSchema, registrationConfigSchema } from './dto/register.dto.js';
import { RegistrationService } from './registration.service.js';

@Controller('auth')
export class AuthController {
	private readonly logger = new Logger('AuthController');

	constructor(
		private readonly authService: AuthService,
		private readonly libraryService: LibraryService,
		private readonly libraryJobs: LibraryJobsService,
		private readonly config: ConfigService,
		private readonly registration: RegistrationService,
	) {}

	/**
	 * Cookie options for the `mu_access_token` cookie. Its lifetime tracks the
	 * JWT's own expiry (`auth.jwtExpiresIn`, default 7d) rather than a fixed
	 * 15 minutes — otherwise the cookie vanishes from the browser long before
	 * the still-valid token would, which broke cookie-authed navigations like
	 * the offline-download endpoint (a native download can't send a Bearer
	 * header, only cookies). Token expiry is still enforced by JWT verification.
	 */
	private accessCookieOptions() {
		return {
			httpOnly: true,
			path: '/',
			sameSite: 'lax' as const,
			maxAge: parseDurationSeconds(this.config.get<string>('auth.jwtExpiresIn', '7d')),
		};
	}

	@Post('setup')
	@Public()
	@UsePipes(new ZodValidationPipe(setupSchema))
	async setup(@Body() body: SetupDto, @Req() req: any, @Res({ passthrough: true }) reply: any) {
		const user = await this.authService.setup(body);
		const { accessToken } = await this.authService.generateTokens(user as any, req.server);

		reply.setCookie('mu_access_token', accessToken, this.accessCookieOptions());

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

		reply.setCookie('mu_access_token', accessToken, this.accessCookieOptions());

		return { user, accessToken };
	}

	@Post('logout')
	@RequireAction('view:library')
	async logout(@CurrentUser('id') userId: string, @Res({ passthrough: true }) reply: any) {
		// Stamp the logout so Members/profile show "Logged out" (a later login
		// flips it back to "Active").
		this.authService.recordLogout(userId);
		reply.clearCookie('mu_access_token', {
			httpOnly: true,
			path: '/',
			sameSite: 'lax',
		});
		return { success: true };
	}

	@Get('me')
	@RequireAction('view:library')
	async me(@CurrentUser() user: any, @Req() req: any, @Res({ passthrough: true }) reply: any) {
		// Refresh the access-token cookie's browser lifetime on every session
		// check (the client calls /auth/me on load). The cookie carries the
		// same token the API client sends as a Bearer header, so re-setting it
		// keeps the two in sync and self-heals stale/expired cookies — which is
		// what makes cookie-authed navigations (offline download) reliable for
		// the whole session without a token in the URL.
		const auth = req.headers?.authorization;
		const raw =
			typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
				? auth.slice(7).trim()
				: null;
		if (raw) reply.setCookie('mu_access_token', raw, this.accessCookieOptions());

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

	// ── Self-registration ─────────────────────────────────────────────────

	/**
	 * Public: whether sign-up is open (drives the login page's "Register" button
	 * and the register form's confirmation copy). Deliberately readable without
	 * auth — an anonymous visitor is exactly who needs it.
	 */
	@Get('registration-config')
	@Public()
	getRegistrationConfig(): RegistrationConfig {
		return this.registration.getConfig();
	}

	/** Admin: update the three registration switches. */
	@Roles('admin')
	@RequireAction('edit:app-settings')
	@Put('registration-config')
	@UsePipes(new ZodValidationPipe(registrationConfigSchema))
	setRegistrationConfig(@Body() body: RegistrationConfigDto): RegistrationConfig {
		return this.registration.setConfig(body);
	}

	@Post('register')
	@Public()
	@UsePipes(new ZodValidationPipe(registerSchema))
	async register(@Body() body: RegisterDto): Promise<RegistrationResult> {
		return this.registration.register(body);
	}

	/** Public: consume an emailed verification token. */
	@Get('verify-email')
	@Public()
	async verifyEmail(@Query('token') token: string) {
		return this.registration.verifyEmail(token);
	}
}

/**
 * Parse a JWT-style duration ("7d", "24h", "15m", "60s", or a plain number of
 * seconds) into seconds. Falls back to 7 days for anything unrecognised.
 */
function parseDurationSeconds(value: string | number | undefined): number {
	const WEEK = 7 * 24 * 60 * 60;
	if (value == null) return WEEK;
	if (typeof value === 'number') return value > 0 ? Math.floor(value) : WEEK;
	const m = value.trim().match(/^(\d+)\s*([smhd])?$/i);
	if (!m) return WEEK;
	const n = parseInt(m[1]!, 10);
	const unit = (m[2] || 's').toLowerCase();
	const mult = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
	return n * mult;
}

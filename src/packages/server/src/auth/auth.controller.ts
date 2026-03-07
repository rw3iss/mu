import { Controller, Post, Get, Body, Req, Res, UsePipes } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { loginSchema, setupSchema } from './dto/login.dto.js';
import type { LoginDto, SetupDto } from './dto/login.dto.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

    return { user, accessToken };
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
    return { setupComplete };
  }
}

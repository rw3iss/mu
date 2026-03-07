import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { users } from '../../database/schema/index.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private config: ConfigService,
    private database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    // Try JWT verification first (works for both local and remote)
    try {
      await request.jwtVerify();
      return true;
    } catch {
      // JWT failed — fall through to local bypass
    }

    // Local bypass: for localhost connections without a valid JWT,
    // look up the first admin user from the database
    if (this.config.get<boolean>('auth.localBypass', true)) {
      const ip = request.ip ?? request.socket?.remoteAddress;
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        const admin = this.database.db
          .select({ id: users.id, username: users.username, role: users.role })
          .from(users)
          .where(eq(users.role, 'admin'))
          .limit(1)
          .get();

        if (admin) {
          request.user = { sub: admin.id, role: admin.role };
          return true;
        }
      }
    }

    throw new UnauthorizedException('Invalid or expired token');
  }
}

import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { ConfigService } from '../config/config.service.js';
import { users } from '../database/schema/index.js';
import type { SetupDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async setup(data: SetupDto) {
    const existing = this.database.db.select().from(users).limit(1).all();
    if (existing.length > 0) {
      throw new ConflictException('Setup already complete — users exist');
    }

    const passwordHash = await this.hashPassword(data.password);
    const now = nowISO();
    const id = crypto.randomUUID();

    this.database.db.insert(users).values({
      id,
      username: data.username,
      email: data.email ?? null,
      passwordHash,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    }).run();

    const user = this.database.db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .get();

    return user;
  }

  async login(username: string, password: string) {
    const user = this.database.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async findById(id: string) {
    const user = this.database.db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .get();

    return user ?? null;
  }

  async generateTokens(user: { id: string; role: string }, fastifyInstance: any) {
    const expiresIn = this.config.get<string>('auth.jwtExpiresIn', '7d');
    const accessToken = fastifyInstance.jwt.sign(
      { sub: user.id, role: user.role },
      { expiresIn },
    );
    return { accessToken };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async isSetupComplete(): Promise<boolean> {
    const existing = this.database.db.select().from(users).limit(1).all();
    return existing.length > 0;
  }
}

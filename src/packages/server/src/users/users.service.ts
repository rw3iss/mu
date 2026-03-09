import { Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { nowISO } from '@mu/shared';
import { DatabaseService } from '../database/database.service.js';
import { users } from '../database/schema/index.js';

@Injectable()
export class UsersService {
	constructor(private readonly database: DatabaseService) {}

	private readonly publicColumns = {
		id: users.id,
		username: users.username,
		email: users.email,
		role: users.role,
		avatarUrl: users.avatarUrl,
		createdAt: users.createdAt,
		updatedAt: users.updatedAt,
	} as const;

	findAll() {
		return this.database.db.select(this.publicColumns).from(users).all();
	}

	findById(id: string) {
		const user = this.database.db
			.select(this.publicColumns)
			.from(users)
			.where(eq(users.id, id))
			.get();

		return user ?? null;
	}

	async create(data: { username: string; email?: string; password: string; role?: string }) {
		const passwordHash = await bcrypt.hash(data.password, 12);
		const now = nowISO();
		const id = crypto.randomUUID();

		this.database.db
			.insert(users)
			.values({
				id,
				username: data.username,
				email: data.email ?? null,
				passwordHash,
				role: data.role ?? 'user',
				createdAt: now,
				updatedAt: now,
			})
			.run();

		return this.findById(id);
	}

	async update(
		id: string,
		data: { username?: string; email?: string; password?: string; role?: string },
	) {
		const existing = this.findById(id);
		if (!existing) {
			throw new NotFoundException(`User ${id} not found`);
		}

		const updates: Record<string, unknown> = { updatedAt: nowISO() };

		if (data.username !== undefined) updates.username = data.username;
		if (data.email !== undefined) updates.email = data.email;
		if (data.role !== undefined) updates.role = data.role;
		if (data.password !== undefined) {
			updates.passwordHash = await bcrypt.hash(data.password, 12);
		}

		this.database.db.update(users).set(updates).where(eq(users.id, id)).run();

		return this.findById(id);
	}

	delete(id: string) {
		const existing = this.findById(id);
		if (!existing) {
			throw new NotFoundException(`User ${id} not found`);
		}

		this.database.db.delete(users).where(eq(users.id, id)).run();
	}
}

import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequireAction } from '../common/decorators/require-action.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Get()
	@Roles('admin')
	@RequireAction('admin:users')
	findAll() {
		return this.usersService.findAll();
	}

	@Get(':id')
	@Roles('admin')
	@RequireAction('admin:users')
	findById(@Param('id') id: string) {
		return this.usersService.findById(id);
	}

	@Post()
	@Roles('admin')
	@RequireAction('admin:users')
	create(@Body() body: { username: string; email?: string; password: string; role?: string }) {
		return this.usersService.create(body);
	}

	@Patch(':id')
	@Roles('admin')
	@RequireAction('admin:users')
	update(
		@Param('id') id: string,
		@Body() body: { username?: string; email?: string; password?: string; role?: string },
	) {
		return this.usersService.update(id, body);
	}

	@Delete(':id')
	@Roles('admin')
	@RequireAction('admin:users')
	delete(@Param('id') id: string) {
		this.usersService.delete(id);
		return { success: true };
	}
}

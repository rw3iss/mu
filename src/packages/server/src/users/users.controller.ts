import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('admin')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() body: { username: string; email?: string; password: string; role?: string }) {
    return this.usersService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { username?: string; email?: string; password?: string; role?: string },
  ) {
    return this.usersService.update(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  delete(@Param('id') id: string) {
    this.usersService.delete(id);
    return { success: true };
  }
}

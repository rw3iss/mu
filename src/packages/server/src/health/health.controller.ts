import { Controller, Get } from '@nestjs/common';
import { nowISO } from '@mu/shared';
import { Public } from '../common/decorators/public.decorator.js';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: '0.1.0',
      timestamp: nowISO(),
    };
  }
}

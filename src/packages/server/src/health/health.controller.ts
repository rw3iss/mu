import { Controller, Get } from '@nestjs/common';
import os from 'os';
import { nowISO } from '@mu/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { StreamService } from '../stream/stream.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';
import { JobManagerService } from '../jobs/job-manager.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly streamService: StreamService,
    private readonly transcoderService: TranscoderService,
    private readonly jobManager: JobManagerService,
  ) {}

  @Get()
  @Public()
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      version: '0.1.0',
      timestamp: nowISO(),
    };
  }

  @Get('stats')
  @Roles('admin')
  async getStats() {
    const cpus = os.cpus();
    const sessions = await this.streamService.getActiveSessions();
    return {
      system: {
        cpuCount: cpus.length,
        loadAvg: os.loadavg(),
        memoryUsed: process.memoryUsage.rss(),
        memoryTotal: os.totalmem(),
        memoryFree: os.freemem(),
        uptime: process.uptime(),
        platform: os.platform(),
      },
      services: {
        activeStreams: sessions.length,
        activeTranscodes: this.transcoderService.getActiveTranscodeCount(),
        runningJobs: this.jobManager.listJobs({ status: 'running' }).length,
        pendingJobs: this.jobManager.listJobs({ status: 'pending' }).length,
      },
    };
  }
}

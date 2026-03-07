import { Controller, Get, Post, Patch, Delete, Param, Body, Logger } from '@nestjs/common';
import { LibraryService } from './library.service.js';
import { LibraryJobsService } from './library-jobs.service.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('sources')
export class LibraryController {
  private readonly logger = new Logger('LibraryController');

  constructor(
    private readonly libraryService: LibraryService,
    private readonly libraryJobs: LibraryJobsService,
    private readonly jobManager: JobManagerService,
  ) {}

  @Get()
  @Roles('admin')
  findAll() {
    return this.libraryService.getSources();
  }

  @Post()
  @Roles('admin')
  create(@Body() body: { path: string; label?: string }) {
    return this.libraryService.addSource(body.path, body.label);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @Body() body: { label?: string; enabled?: boolean; scanIntervalHours?: number },
  ) {
    return this.libraryService.updateSource(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    this.libraryService.removeSource(id);
    return { success: true };
  }

  @Post('scan')
  @Roles('admin')
  scanAll() {
    const sources = this.libraryService.getSources().filter((s) => s.enabled);
    const jobIds: string[] = [];

    for (const source of sources) {
      const jobId = this.libraryJobs.enqueueScan(
        source.id,
        `Scan: ${source.label || source.path}`,
      );
      jobIds.push(jobId);
    }

    return { message: 'Scan jobs enqueued', jobIds, sourceCount: sources.length };
  }

  @Post(':id/scan')
  @Roles('admin')
  scan(@Param('id') id: string) {
    const source = this.libraryService.getSource(id);
    const jobId = this.libraryJobs.enqueueScan(
      id,
      `Scan: ${source.label || source.path}`,
    );

    return { message: 'Scan job enqueued', jobId };
  }
}

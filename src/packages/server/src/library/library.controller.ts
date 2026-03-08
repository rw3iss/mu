import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Logger } from '@nestjs/common';
import { LibraryService } from './library.service.js';
import { LibraryJobsService } from './library-jobs.service.js';
import { ScannerService } from './scanner.service.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';

@Controller('sources')
export class LibraryController {
  private readonly logger = new Logger('LibraryController');

  constructor(
    private readonly libraryService: LibraryService,
    private readonly libraryJobs: LibraryJobsService,
    private readonly scanner: ScannerService,
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

  @Put('sync')
  @Roles('admin')
  sync(@Body() body: { paths: string[] }) {
    return this.libraryService.syncSources(body.paths);
  }

  @Get('scan-status')
  @Roles('admin')
  scanStatus() {
    return this.libraryJobs.getScanStatus();
  }

  @Post('refresh-schedule')
  @Roles('admin')
  refreshSchedule() {
    this.libraryJobs.refreshAutoScanSchedule();
    return this.libraryJobs.getScanStatus();
  }

  @Post('scan')
  @Roles('admin')
  async scanAll() {
    const sources = this.libraryService.getSources().filter((s) => s.enabled);

    let totalFilesFound = 0;
    let totalFilesAdded = 0;
    let totalFilesUpdated = 0;
    let totalFilesRemoved = 0;

    for (const source of sources) {
      try {
        const result = await this.scanner.scanSource(source.id);
        totalFilesFound += result.filesFound;
        totalFilesAdded += result.filesAdded;
        totalFilesUpdated += result.filesUpdated;
        totalFilesRemoved += result.filesRemoved;
      } catch (err: any) {
        this.logger.error(`Scan failed for source ${source.id}: ${err.message}`);
      }
    }

    return {
      message: 'Scan complete',
      sourceCount: sources.length,
      filesFound: totalFilesFound,
      filesAdded: totalFilesAdded,
      filesUpdated: totalFilesUpdated,
      filesRemoved: totalFilesRemoved,
    };
  }

  @Post(':id/scan')
  @Roles('admin')
  async scan(@Param('id') id: string) {
    const source = this.libraryService.getSource(id);
    const result = await this.scanner.scanSource(id);

    return {
      message: 'Scan complete',
      sourceLabel: source.label || source.path,
      ...result,
    };
  }
}

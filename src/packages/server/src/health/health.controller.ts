import { Controller, Get } from '@nestjs/common';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { nowISO } from '@mu/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { StreamService } from '../stream/stream.service.js';
import { TranscoderService } from '../stream/transcoder/transcoder.service.js';
import { JobManagerService } from '../jobs/job-manager.service.js';
import { ConfigService } from '../config/config.service.js';

const execFileAsync = promisify(execFile);

interface DiskStats {
  diskTotal: number;
  diskFree: number;
}

const DISK_CACHE_TTL_MS = 30_000;
const DATA_DIR_CACHE_TTL_MS = 60_000;

@Controller('health')
export class HealthController {
  private diskCache: { data: DiskStats; expiresAt: number } | null = null;
  private dataDirCache: { size: number; expiresAt: number } | null = null;

  constructor(
    private readonly streamService: StreamService,
    private readonly transcoderService: TranscoderService,
    private readonly jobManager: JobManagerService,
    private readonly config: ConfigService,
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
    const [sessions, disk, dataDirSize, appMemory] = await Promise.all([
      this.streamService.getActiveSessions(),
      this.getDiskStats(),
      this.getDataDirSize(),
      this.getAppMemory(),
    ]);
    return {
      system: {
        cpuCount: cpus.length,
        loadAvg: os.loadavg(),
        memoryUsed: process.memoryUsage.rss(),
        memoryTotal: os.totalmem(),
        memoryFree: os.freemem(),
        appMemory,
        diskTotal: disk.diskTotal,
        diskFree: disk.diskFree,
        dataDirSize,
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

  private async getDiskStats(): Promise<DiskStats> {
    const now = Date.now();
    if (this.diskCache && now < this.diskCache.expiresAt) {
      return this.diskCache.data;
    }

    try {
      const data = await this.queryDisk();
      this.diskCache = { data, expiresAt: now + DISK_CACHE_TTL_MS };
      return data;
    } catch {
      // Return last cached value on error, or zeros
      return this.diskCache?.data ?? { diskTotal: 0, diskFree: 0 };
    }
  }

  private async queryDisk(): Promise<DiskStats> {
    const platform = os.platform();

    if (platform === 'win32') {
      // WMIC: get root drive free/total in bytes
      const { stdout } = await execFileAsync('wmic', [
        'logicaldisk',
        'where',
        'DeviceID="C:"',
        'get',
        'FreeSpace,Size',
        '/format:csv',
      ]);
      const lines = stdout.trim().split('\n').filter(Boolean);
      const last = lines[lines.length - 1] ?? '';
      const cols = last.split(',');
      return {
        diskFree: parseInt(cols[1] ?? '0', 10) || 0,
        diskTotal: parseInt(cols[2] ?? '0', 10) || 0,
      };
    }

    // Unix: df for the root filesystem, output in 1K blocks
    const { stdout } = await execFileAsync('df', ['-k', '/']);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return { diskTotal: 0, diskFree: 0 };
    const dataLine = lines[1] ?? '';
    const cols = dataLine.split(/\s+/);
    // df -k columns: Filesystem 1K-blocks Used Available Use% Mounted
    const totalKb = parseInt(cols[1] ?? '0', 10) || 0;
    const availKb = parseInt(cols[3] ?? '0', 10) || 0;
    return {
      diskTotal: totalKb * 1024,
      diskFree: availKb * 1024,
    };
  }

  private async getDataDirSize(): Promise<number> {
    const now = Date.now();
    if (this.dataDirCache && now < this.dataDirCache.expiresAt) {
      return this.dataDirCache.size;
    }

    try {
      const dataDir = this.config.get<string>('dataDir', './data');
      const size = await this.dirSize(dataDir);
      this.dataDirCache = { size, expiresAt: now + DATA_DIR_CACHE_TTL_MS };
      return size;
    } catch {
      return this.dataDirCache?.size ?? 0;
    }
  }

  /**
   * Get memory usage for this process and its tracked child processes.
   * On Linux reads /proc/<pid>/statm; falls back to main RSS only.
   */
  private async getAppMemory(): Promise<{ main: number; children: number; total: number }> {
    const mainRss = process.memoryUsage.rss();
    const childPids = this.transcoderService.getChildPids();
    let childrenRss = 0;

    if (os.platform() === 'linux') {
      const PAGE_SIZE = 4096;
      const results = await Promise.all(
        childPids.map(async (pid) => {
          try {
            const statm = await fs.readFile(`/proc/${pid}/statm`, 'utf8');
            // statm fields: size resident shared text lib data dt (in pages)
            const resident = parseInt(statm.split(' ')[1] ?? '0', 10) || 0;
            return resident * PAGE_SIZE;
          } catch {
            return 0; // process may have exited
          }
        }),
      );
      childrenRss = results.reduce((sum, v) => sum + v, 0);
    }

    return { main: mainRss, children: childrenRss, total: mainRss + childrenRss };
  }

  /** Recursively sum file sizes in a directory. */
  private async dirSize(dir: string): Promise<number> {
    let total = 0;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await this.dirSize(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // skip inaccessible files
        }
      }
    }
    return total;
  }
}

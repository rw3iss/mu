import { Controller, Get, Delete, Query } from '@nestjs/common';
import { HistoryService } from './history.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  getHistory(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.historyService.getHistory(
      userId,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  @Delete()
  clearHistory(@CurrentUser('id') userId: string) {
    this.historyService.clearHistory(userId);
    return { success: true };
  }

  @Get('continue')
  getContinueWatching(@CurrentUser('id') userId: string) {
    return this.historyService.getContinueWatching(userId);
  }
}

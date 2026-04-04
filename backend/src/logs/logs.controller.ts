import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { LogsService } from './logs.service';

@Controller('projects/:projectId/logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LogsController {
  constructor(private logsService: LogsService) {}

  @Get() @MinRole('VIEWER')
  getLogs(
    @Param('projectId') projectId: string,
    @Query('type') type?: 'stdout' | 'stderr',
    @Query('lines') lines?: string,
    @Query('search') search?: string,
  ) {
    return this.logsService.getHistoricalLogs(projectId, {
      type,
      lines: lines ? parseInt(lines) : undefined,
      search,
    });
  }
}

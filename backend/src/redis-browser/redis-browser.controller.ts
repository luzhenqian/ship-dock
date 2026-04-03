import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { RedisBrowserService } from './redis-browser.service';

@Controller('projects/:projectId/redis')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RedisBrowserController {
  constructor(private redisService: RedisBrowserService) {}

  @Get('keys') @MinRole('VIEWER')
  scanKeys(
    @Param('projectId') projectId: string,
    @Query('pattern') pattern?: string,
    @Query('cursor') cursor?: string,
    @Query('count') count?: string,
  ) {
    return this.redisService.scanKeys(projectId, pattern, cursor, count ? parseInt(count) : undefined);
  }

  @Get('keys/detail') @MinRole('VIEWER')
  getKeyDetail(
    @Param('projectId') projectId: string,
    @Query('key') key: string,
  ) {
    return this.redisService.getKeyDetail(projectId, key);
  }

  @Post('keys') @MinRole('DEVELOPER')
  createKey(
    @Param('projectId') projectId: string,
    @Body() data: { key: string; type: string; value: any; ttl?: number },
  ) {
    return this.redisService.createKey(projectId, data);
  }

  @Put('keys/update') @MinRole('DEVELOPER')
  updateKey(
    @Param('projectId') projectId: string,
    @Query('key') key: string,
    @Body() data: { value: any; ttl?: number },
  ) {
    return this.redisService.updateKey(projectId, key, data.value, data.ttl);
  }

  @Delete('keys/delete') @MinRole('DEVELOPER')
  deleteKey(
    @Param('projectId') projectId: string,
    @Query('key') key: string,
  ) {
    return this.redisService.deleteKey(projectId, key);
  }

  @Post('command') @MinRole('DEVELOPER')
  executeCommand(
    @Param('projectId') projectId: string,
    @Body('command') command: string,
  ) {
    return this.redisService.executeCommand(projectId, command);
  }
}

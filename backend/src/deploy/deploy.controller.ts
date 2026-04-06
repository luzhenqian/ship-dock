import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DeployService } from './deploy.service';

@Controller('projects/:projectId/deployments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeployController {
  constructor(private deployService: DeployService) {}

  @Post() @MinRole('DEVELOPER')
  trigger(@Param('projectId') projectId: string, @Req() req: any) { return this.deployService.trigger(projectId, req.user.id); }

  @Get() @MinRole('VIEWER')
  getHistory(
    @Param('projectId') projectId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.deployService.getHistory(projectId, cursor, limit ? parseInt(limit) : undefined);
  }

  @Get(':id') @MinRole('VIEWER')
  getOne(@Param('id') id: string) { return this.deployService.getOne(id); }

  @Post(':id/cancel') @MinRole('DEVELOPER')
  cancel(@Param('id') id: string) { return this.deployService.cancel(id); }

  @Post(':id/retry') @MinRole('DEVELOPER')
  retry(@Param('id') id: string, @Req() req: any) { return this.deployService.retry(id, req.user.id); }

  @Post('rollback') @MinRole('DEVELOPER')
  rollback(@Param('projectId') projectId: string, @Req() req: any) { return this.deployService.rollback(projectId, req.user.id); }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Controller('projects/:projectId/webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Post() @MinRole('ADMIN')
  create(@Param('projectId') projectId: string, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.createConfig(projectId, dto);
  }

  @Get() @MinRole('DEVELOPER')
  getConfig(@Param('projectId') projectId: string) {
    return this.webhooksService.getConfig(projectId);
  }

  @Patch() @MinRole('ADMIN')
  update(@Param('projectId') projectId: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooksService.updateConfig(projectId, dto);
  }

  @Delete() @MinRole('ADMIN')
  delete(@Param('projectId') projectId: string) {
    return this.webhooksService.deleteConfig(projectId);
  }

  @Post('regenerate-secret') @MinRole('ADMIN')
  regenerateSecret(@Param('projectId') projectId: string) {
    return this.webhooksService.regenerateSecret(projectId);
  }

  @Get('events') @MinRole('DEVELOPER')
  getEvents(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.webhooksService.getEvents(projectId, status, page ? +page : 1, limit ? +limit : 20);
  }

  @Get('events/:eventId') @MinRole('DEVELOPER')
  getEvent(@Param('eventId') eventId: string) {
    return this.webhooksService.getEvent(eventId);
  }

  @Post('events/:eventId/replay') @MinRole('ADMIN')
  replay(@Param('eventId') eventId: string) {
    return this.webhooksService.replayEvent(eventId);
  }
}

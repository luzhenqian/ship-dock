import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { StaticFilesService } from './static-files.service';

@Controller('projects/:projectId/static-files')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaticFilesController {
  constructor(private service: StaticFilesService) {}

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Put() @MinRole('DEVELOPER')
  upsert(
    @Param('projectId') projectId: string,
    @Body() body: { path: string; content: string },
  ) {
    return this.service.upsert(projectId, body.path, body.content);
  }

  @Delete(':encodedPath') @MinRole('DEVELOPER')
  remove(
    @Param('projectId') projectId: string,
    @Param('encodedPath') encodedPath: string,
  ) {
    const path = decodeURIComponent(encodedPath);
    return this.service.remove(projectId, path);
  }
}

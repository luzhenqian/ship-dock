import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ProjectTasksService } from './project-tasks.service';
import { CreateProjectTaskDto } from './dto/create-task.dto';
import { UpdateProjectTaskDto } from './dto/update-task.dto';

@Controller('projects/:projectId/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectTasksController {
  constructor(private service: ProjectTasksService) {}

  @Get() @MinRole('VIEWER')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post() @MinRole('DEVELOPER')
  create(@Param('projectId') projectId: string, @Body() dto: CreateProjectTaskDto) {
    return this.service.create(projectId, dto);
  }

  @Get(':taskId') @MinRole('VIEWER')
  getOne(@Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.getOne(projectId, taskId);
  }

  @Patch(':taskId') @MinRole('DEVELOPER')
  update(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateProjectTaskDto,
  ) {
    return this.service.update(projectId, taskId, dto);
  }

  @Delete(':taskId') @MinRole('DEVELOPER')
  remove(@Param('projectId') projectId: string, @Param('taskId') taskId: string) {
    return this.service.remove(projectId, taskId);
  }

  @Post(':taskId/run') @MinRole('DEVELOPER')
  triggerRun(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Req() req: any,
  ) {
    return this.service.triggerRun(projectId, taskId, req.user.id);
  }

  @Get(':taskId/runs') @MinRole('VIEWER')
  listRuns(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listRuns(projectId, taskId, cursor, limit ? parseInt(limit) : undefined);
  }

  @Get(':taskId/runs/:runId') @MinRole('VIEWER')
  getRun(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('runId') runId: string,
  ) {
    return this.service.getRun(projectId, taskId, runId);
  }

  // Cancel endpoint is added in Task 9 once service.cancelRun + processor exist.
}

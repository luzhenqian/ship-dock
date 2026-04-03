import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post() @MinRole('ADMIN')
  create(@Req() req: any, @Body() dto: CreateProjectDto) { return this.projectsService.create(req.user.id, dto); }

  @Get() @MinRole('VIEWER')
  findAll() { return this.projectsService.findAll(); }

  @Get(':id') @MinRole('VIEWER')
  findOne(@Param('id') id: string) { return this.projectsService.findOne(id); }

  @Patch(':id') @MinRole('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) { return this.projectsService.update(id, dto); }

  @Delete(':id') @MinRole('ADMIN')
  delete(@Param('id') id: string) { return this.projectsService.delete(id); }

  @Patch(':id/pipeline') @MinRole('DEVELOPER')
  updatePipeline(@Param('id') id: string, @Body() pipeline: any) { return this.projectsService.update(id, { pipeline }); }
}

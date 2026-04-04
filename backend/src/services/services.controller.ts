import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Controller('projects/:projectId/services')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @Get() @MinRole('VIEWER')
  findAll(@Param('projectId') projectId: string) {
    return this.servicesService.findAll(projectId);
  }

  @Post() @MinRole('DEVELOPER')
  create(@Param('projectId') projectId: string, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(projectId, dto);
  }

  @Patch(':sid') @MinRole('DEVELOPER')
  update(@Param('sid') sid: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(sid, dto);
  }

  @Delete(':sid') @MinRole('DEVELOPER')
  delete(@Param('sid') sid: string) {
    return this.servicesService.delete(sid);
  }

  @Post('detect') @MinRole('DEVELOPER')
  detect(@Param('projectId') projectId: string) {
    return this.servicesService.detectAndSave(projectId);
  }

  @Post(':sid/test') @MinRole('VIEWER')
  test(@Param('sid') sid: string) {
    return this.servicesService.testConnection(sid);
  }
}

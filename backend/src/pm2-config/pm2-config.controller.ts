import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { Pm2ConfigService } from './pm2-config.service';
import { UpdatePm2ConfigDto } from './dto/update-pm2-config.dto';

@Controller('projects/:projectId/pm2-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class Pm2ConfigController {
  constructor(private pm2ConfigService: Pm2ConfigService) {}

  @Get() @MinRole('VIEWER')
  getConfig(@Param('projectId') projectId: string) {
    return this.pm2ConfigService.getConfig(projectId);
  }

  @Patch() @MinRole('DEVELOPER')
  updateConfig(@Param('projectId') projectId: string, @Body() dto: UpdatePm2ConfigDto) {
    return this.pm2ConfigService.updateConfig(projectId, dto);
  }
}

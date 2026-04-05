import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { NginxConfigService } from './nginx-config.service';
import { UpdateNginxConfigDto } from './dto/update-nginx-config.dto';

@Controller('projects/:projectId/nginx-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NginxConfigController {
  constructor(private nginxConfigService: NginxConfigService) {}

  @Get() @MinRole('VIEWER')
  getConfig(@Param('projectId') projectId: string) {
    return this.nginxConfigService.getConfig(projectId);
  }

  @Patch() @MinRole('DEVELOPER')
  updateConfig(@Param('projectId') projectId: string, @Body() dto: UpdateNginxConfigDto) {
    return this.nginxConfigService.updateConfig(projectId, dto);
  }
}

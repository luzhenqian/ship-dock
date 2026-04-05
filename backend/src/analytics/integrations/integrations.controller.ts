import {
  Body, Controller, Delete, Get, Param, Post, Put, UseGuards, NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MinRole } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationDto, UpdateIntegrationDto } from '../dto/integration.dto';
import { Ga4DataService } from '../providers/ga4/ga4-data.service';
import { RunReportDto } from '../dto/ga4-report.dto';

@Controller('analytics/integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(
    private integrationsService: IntegrationsService,
    private ga4Data: Ga4DataService,
  ) {}

  @Get(':projectId')
  findByProject(@Param('projectId') projectId: string) {
    return this.integrationsService.findByProject(projectId);
  }

  @Post(':projectId')
  @MinRole('ADMIN')
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    return this.integrationsService.create({ projectId, ...dto });
  }

  @Put(':projectId/:id')
  @MinRole('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrationsService.update(id, dto);
  }

  @Delete(':projectId/:id')
  @MinRole('ADMIN')
  delete(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
  ) {
    return this.integrationsService.delete(id, projectId);
  }

  @Post(':projectId/reports')
  async runReport(
    @Param('projectId') projectId: string,
    @Body() dto: RunReportDto,
  ) {
    const integrations = await this.integrationsService.findByProject(projectId);
    const ga4 = integrations.find((i: any) => i.provider === 'GOOGLE_GA4');
    if (!ga4) throw new NotFoundException('No GA4 integration for this project');
    return this.ga4Data.runReport(ga4.connectionId, ga4.ga4PropertyId, dto);
  }

  @Get(':projectId/realtime')
  async realtimeReport(@Param('projectId') projectId: string) {
    const integrations = await this.integrationsService.findByProject(projectId);
    const ga4 = integrations.find((i: any) => i.provider === 'GOOGLE_GA4');
    if (!ga4) throw new NotFoundException('No GA4 integration for this project');
    return this.ga4Data.runRealtimeReport(ga4.connectionId, ga4.ga4PropertyId);
  }
}

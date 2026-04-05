import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ClarityAdminService } from './clarity-admin.service';
import { CreateClarityProjectDto } from '../../dto/clarity.dto';

@Controller('analytics/clarity')
@UseGuards(JwtAuthGuard)
export class ClarityAdminController {
  constructor(private clarityAdmin: ClarityAdminService) {}

  @Get('projects')
  listProjects(@Query('connectionId') connectionId: string) {
    return this.clarityAdmin.listProjects(connectionId);
  }

  @Post('projects')
  createProject(@Body() dto: CreateClarityProjectDto) {
    return this.clarityAdmin.createProject(dto.connectionId, dto.name, dto.siteUrl);
  }
}

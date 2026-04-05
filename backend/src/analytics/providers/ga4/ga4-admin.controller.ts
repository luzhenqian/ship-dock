import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Ga4AdminService } from './ga4-admin.service';
import { Ga4DataService } from './ga4-data.service';
import { CreatePropertyDto, CreateDataStreamDto } from '../../dto/ga4.dto';

@Controller('analytics/ga4')
@UseGuards(JwtAuthGuard)
export class Ga4AdminController {
  constructor(
    private ga4Admin: Ga4AdminService,
    private ga4Data: Ga4DataService,
  ) {}

  @Get('accounts')
  listAccounts(@Query('connectionId') connectionId: string) {
    return this.ga4Admin.listAccounts(connectionId);
  }

  @Get('properties')
  listProperties(
    @Query('connectionId') connectionId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.ga4Admin.listProperties(connectionId, accountId);
  }

  @Post('properties')
  createProperty(@Body() dto: CreatePropertyDto) {
    return this.ga4Admin.createProperty(
      dto.connectionId,
      dto.accountId,
      dto.displayName,
      dto.timeZone,
      dto.currencyCode,
    );
  }

  @Get('streams')
  listStreams(
    @Query('connectionId') connectionId: string,
    @Query('propertyId') propertyId: string,
  ) {
    return this.ga4Admin.listDataStreams(connectionId, propertyId);
  }

  @Post('streams')
  createStream(@Body() dto: CreateDataStreamDto) {
    return this.ga4Admin.createDataStream(
      dto.connectionId,
      dto.propertyId,
      dto.displayName,
      dto.defaultUri,
    );
  }

  @Get('dimensions')
  getDimensions() {
    return this.ga4Data.getAvailableDimensions();
  }

  @Get('metrics')
  getMetrics() {
    return this.ga4Data.getAvailableMetrics();
  }
}

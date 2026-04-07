import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DomainsService } from './domains.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { CreateDnsRecordDto, UpdateDnsRecordDto } from './dto/dns-record.dto';

@Controller('domains')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DomainsController {
  constructor(private domainsService: DomainsService) {}

  @Post('providers') @MinRole('ADMIN')
  createProvider(@Req() req: any, @Body() dto: CreateProviderDto) { return this.domainsService.createProvider(req.user.id, dto); }

  @Get('providers') @MinRole('ADMIN')
  listProviders() { return this.domainsService.listProviders(); }

  @Get('providers/:id') @MinRole('ADMIN')
  getProvider(@Param('id') id: string) { return this.domainsService.getProvider(id); }

  @Patch('providers/:id') @MinRole('ADMIN')
  updateProvider(@Param('id') id: string, @Body() dto: UpdateProviderDto) { return this.domainsService.updateProvider(id, dto); }

  @Delete('providers/:id') @MinRole('ADMIN')
  deleteProvider(@Param('id') id: string) { return this.domainsService.deleteProvider(id); }

  @Get('providers/:id/domains') @MinRole('ADMIN')
  listDomains(@Param('id') providerId: string) { return this.domainsService.listDomains(providerId); }

  @Get('providers/:id/domains/:domain/records') @MinRole('ADMIN')
  getRecords(@Param('id') providerId: string, @Param('domain') domain: string) { return this.domainsService.getRecords(providerId, domain); }

  @Post('providers/:id/domains/:domain/records') @MinRole('ADMIN')
  addRecord(@Param('id') providerId: string, @Param('domain') domain: string, @Body() dto: CreateDnsRecordDto) {
    return this.domainsService.addRecord(providerId, domain, { ...dto, ttl: dto.ttl || 600 });
  }

  @Put('providers/:id/domains/:domain/records') @MinRole('ADMIN')
  updateRecord(@Param('id') providerId: string, @Param('domain') domain: string, @Body() dto: UpdateDnsRecordDto) {
    return this.domainsService.updateRecord(providerId, domain, { name: dto.original.name, type: dto.original.type }, { ...dto.updated, ttl: dto.updated.ttl || 600 });
  }

  @Delete('providers/:id/domains/:domain/records/:type/:name') @MinRole('ADMIN')
  deleteRecord(@Param('id') providerId: string, @Param('domain') domain: string, @Param('type') type: string, @Param('name') name: string) {
    return this.domainsService.deleteRecord(providerId, domain, { name, type });
  }
}

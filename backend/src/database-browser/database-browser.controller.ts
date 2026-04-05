import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MinRole } from '../common/decorators/roles.decorator';
import { DatabaseBrowserService } from './database-browser.service';

@Controller('projects/:projectId/database')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseBrowserController {
  constructor(private dbService: DatabaseBrowserService) {}

  @Get('overview') @MinRole('VIEWER')
  getOverview(@Param('projectId') projectId: string) {
    return this.dbService.getOverview(projectId);
  }

  @Get('tables') @MinRole('VIEWER')
  getTables(@Param('projectId') projectId: string) {
    return this.dbService.getTables(projectId);
  }

  @Get('tables/:table') @MinRole('VIEWER')
  getTable(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.dbService.getTableData(projectId, table, {
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
      sort,
      order,
    });
  }

  @Get('tables/:table/structure') @MinRole('VIEWER')
  getTableStructure(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
  ) {
    return this.dbService.getTableStructure(projectId, table);
  }

  @Post('tables/:table/rows') @MinRole('DEVELOPER')
  insertRow(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
    @Body() body: { data: Record<string, any> },
  ) {
    return this.dbService.insertRow(projectId, table, body.data);
  }

  @Patch('tables/:table/rows') @MinRole('DEVELOPER')
  updateRow(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
    @Body() body: { primaryKeys: Record<string, any>; column: string; value: any },
  ) {
    return this.dbService.updateRow(projectId, table, body.primaryKeys, body.column, body.value);
  }

  @Delete('tables/:table/rows') @MinRole('DEVELOPER')
  deleteRows(
    @Param('projectId') projectId: string,
    @Param('table') table: string,
    @Body() body: { rows: Record<string, any>[] },
  ) {
    return this.dbService.deleteRows(projectId, table, body.rows);
  }

  @Post('query') @MinRole('DEVELOPER')
  executeQuery(
    @Param('projectId') projectId: string,
    @Body('sql') sql: string,
  ) {
    return this.dbService.executeQuery(projectId, sql);
  }
}
